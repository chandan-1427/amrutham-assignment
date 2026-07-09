# Amrutam Telemedicine — Database Design

Postgres as source of truth. Redis for cache + ephemeral locks. Designed against the 22 Tier-1 routes and the booking saga.

---

## 1. Core Tables

### `users`
Identity + auth. One row per human, regardless of role.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| email | citext UNIQUE | case-insensitive |
| phone | varchar UNIQUE NULL | for MFA/SMS |
| password_hash | text | argon2id |
| role | enum(`patient`,`doctor`,`admin`) | drives RBAC |
| mfa_secret | text NULL, encrypted | TOTP secret, envelope-encrypted at rest |
| mfa_enabled | boolean default false | |
| status | enum(`active`,`suspended`,`deleted`) | soft delete |
| created_at, updated_at | timestamptz | |

**Why role on `users` not a separate roles table:** at this scale (patient/doctor/admin, no multi-role users), a single enum is simpler and indexable. If Amrutam later needs multi-role or fine-grained permissions, split into `roles` + `user_roles` junction — flagged as a future extension in the architecture doc, not built now.

### `profiles`
1:1 extension of `users`. Kept separate so `users` (hot, auth-path) stays narrow and cacheable.

| Column | Type | Notes |
|---|---|---|
| user_id | UUID PK, FK → users.id | |
| full_name | text | |
| dob | date NULL | |
| gender | text NULL | |
| address_json | jsonb NULL | flexible, low-query-frequency |
| language_pref | text NULL | used in doctor search matching |
| created_at, updated_at | timestamptz | |

### `doctors`
1:1 extension of `users` where `role = 'doctor'`. Separate table because doctor-specific fields are write-light, read-heavy, and heavily indexed for search — bundling into `profiles` would bloat that table for patients.

| Column | Type | Notes |
|---|---|---|
| user_id | UUID PK, FK → users.id | |
| specialty | text | indexed |
| qualifications_json | jsonb | |
| verification_status | enum(`pending`,`verified`,`rejected`) | admin-gated |
| consultation_fee | numeric(10,2) | |
| rating_avg | numeric(3,2) default 0 | denormalized, updated async |
| rating_count | int default 0 | |
| languages | text[] | GIN index for search |
| created_at, updated_at | timestamptz | |

### `availability_slots`
The contention hotspot — this is where booking concurrency happens.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| doctor_id | UUID FK → doctors.user_id | |
| start_time | timestamptz | |
| end_time | timestamptz | |
| status | enum(`available`,`held`,`booked`,`cancelled`) | |
| version | int default 0 | **optimistic locking column** |
| held_by_consultation_id | UUID NULL, FK → consultations.id | set during hold |
| held_until | timestamptz NULL | TTL for an abandoned hold |
| created_at, updated_at | timestamptz | |

Composite index: `(doctor_id, start_time, status)` — this is the single most important index in the schema; it's what `GET /availability/search` and the booking write path both hit.

### `consultations`
The center of the saga. State machine lives here.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| patient_id | UUID FK → users.id | |
| doctor_id | UUID FK → doctors.user_id | |
| slot_id | UUID FK → availability_slots.id | |
| status | enum(`pending_payment`,`confirmed`,`in_progress`,`completed`,`cancelled`,`no_show`) | |
| idempotency_key | text UNIQUE | prevents duplicate booking on retry |
| fee_charged | numeric(10,2) | snapshot at booking time, not FK'd to doctor's current fee |
| scheduled_at | timestamptz | denormalized from slot for query speed |
| created_at, updated_at | timestamptz | |

Indexes: `(patient_id, scheduled_at)`, `(doctor_id, scheduled_at)`, unique on `idempotency_key`.

**Partitioning:** `consultations` is the highest-write-volume table (100k/day → ~36M/year). Partition by **range on `created_at`, monthly**. Keeps indexes small, makes old-data archival trivial (detach + move to cold storage), and every hot query (today's bookings, this doctor's upcoming slots) naturally hits 1–2 partitions.

### `prescriptions`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| consultation_id | UUID FK → consultations.id | |
| doctor_id | UUID FK → doctors.user_id | denormalized for direct doctor-scoped queries |
| notes | text | clinical notes, encrypted at rest (pgcrypto or app-layer) |
| medications_json | jsonb | structured list: name, dosage, duration |
| issued_at | timestamptz | |
| created_at, updated_at | timestamptz | |

Index: `(consultation_id)` unique — one prescription per consultation in v1 (amendments are Tier 2, versioned later).

### `payments`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| consultation_id | UUID FK → consultations.id | |
| provider_ref | text UNIQUE | gateway's transaction id — dedupes webhook replays |
| amount | numeric(10,2) | |
| status | enum(`initiated`,`confirmed`,`failed`,`refunded`) | |
| idempotency_key | text UNIQUE | |
| raw_webhook_json | jsonb NULL | audit/debug trail of last gateway event |
| created_at, updated_at | timestamptz | |

Index: `(consultation_id)`, unique on `provider_ref` — this is what makes the webhook handler idempotent against gateway retries.

### `audit_logs`
Append-only, never updated.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| actor_id | UUID NULL, FK → users.id | null for system-triggered events |
| entity_type | text | e.g. `consultation`, `prescription`, `payment` |
| entity_id | UUID | |
| action | text | e.g. `created`, `state_changed`, `cancelled` |
| diff_json | jsonb NULL | before/after snapshot |
| created_at | timestamptz | |

**Partitioning:** monthly range on `created_at`, same rationale as `consultations` — append-only + compliance-retention makes this the second-fastest-growing table.

Index: `(entity_type, entity_id, created_at)` — this serves `GET /audit-logs?entity_id=...`.

---

## 2. Relationships (ER Summary)

```
users (1) ──── (1) profiles
users (1) ──── (1) doctors            [where role = 'doctor']
doctors (1) ──── (N) availability_slots
users(patient) (1) ──── (N) consultations
doctors (1) ──── (N) consultations
availability_slots (1) ──── (1) consultations   [slot_id, enforced at hold-time]
consultations (1) ──── (1) prescriptions
consultations (1) ──── (1) payments             [1:1 in v1; refunds would make it 1:N later]
users (1) ──── (N) audit_logs                   [as actor]
* (1) ──── (N) audit_logs                       [as entity, polymorphic via entity_type/entity_id]
```

---

## 3. Read vs. Write Path Design

| Path | Pattern | Optimization |
|---|---|---|
| **Doctor search** (`GET /availability/search`) | Read-heavy, high QPS | Redis cache, key = `search:{specialty}:{date}:{lang}`, TTL 60s. Cache invalidated (or just left to expire) on slot status change — staleness of ≤60s is acceptable for search, not for the actual booking write |
| **Get consultation** (`GET /consultations/:id`) | Read-heavy | Cache-aside in Redis, key = `consultation:{id}`, invalidated on any state transition write |
| **Create booking** (`POST /consultations`) | Write, must be strongly consistent | No cache. Row-level lock on the slot (see §4). This path never reads from cache — always hits Postgres directly |
| **Payment webhook** | Write, external-triggered, must be idempotent | Unique constraint on `provider_ref` does the dedup; app checks `payments` table before applying state change |
| **Admin analytics** | Read, aggregate, tolerant of staleness | Not queried live against OLTP tables at 100k/day scale — pre-aggregated via nightly job into a `daily_consultation_stats` materialized view/table. Dashboard reads from that, not from `consultations` directly |

---

## 4. Concurrency: The Slot-Booking Race

This is the one spot in the whole schema where two users can legitimately collide (both click "Book" on the same slot within milliseconds).

**Chosen approach: optimistic locking via `version` column**, not a DB-level advisory lock or `SELECT FOR UPDATE` held across the saga.

```sql
UPDATE availability_slots
SET status = 'held', held_by_consultation_id = :cid, held_until = now() + interval '10 minutes', version = version + 1
WHERE id = :slot_id AND status = 'available' AND version = :expected_version;
-- 0 rows updated → someone else got there first → return 409 Conflict
```

Why optimistic over pessimistic: holding a transactional lock for the duration of a payment round-trip (potentially seconds) would serialize all bookings on a popular doctor's slots and tank write latency under the <500ms p95 target. Optimistic locking keeps the lock window to a single fast UPDATE.

**Held-slot cleanup:** a background job (or a check on next read) releases slots where `status='held' AND held_until < now()` back to `available` — this is the compensating action for abandoned/failed payment flows, not just the explicit `/cancel` route.

---

## 5. Transactions & the Saga

`POST /consultations` is not one DB transaction — it spans an external payment call, so it can't be. It's an **orchestrated saga**:

1. `BEGIN` → optimistic-lock the slot (`held`) → insert `consultations` row (`pending_payment`) → `COMMIT`
2. Call payment gateway (external, async via webhook)
3. On webhook success: `BEGIN` → slot → `booked`, consultation → `confirmed`, insert `payments` row → `COMMIT`
4. On webhook failure/timeout: `BEGIN` → slot → `available` (compensation), consultation → `cancelled` → `COMMIT`

Each step is its own local ACID transaction; the saga coordinator (application-level, not a DB feature) is what strings them together and handles compensation. This is why `idempotency_key` exists on both `consultations` and `payments` — steps 1 and 3 can each be safely retried without double-booking or double-charging.

---

## 6. Lookups / Reference Data

Small, rarely-written tables, fully cacheable in-memory or Redis with long TTL (hours):

- `specialties` (id, name) — used by search filters and doctor onboarding
- `languages` (id, code, name) — used by doctor profile and search

These don't need to be normalized foreign keys on `doctors` necessarily (a `text[]` on `doctors.languages` is fine at this scale), but having the lookup table backs the `/specialties` endpoint and keeps the search filter UI in sync with valid values.

---

## 7. Encryption & Data Classification (ties to security checklist)

| Data | Classification | Handling |
|---|---|---|
| `password_hash`, `mfa_secret` | Secret | argon2id / envelope-encrypted, never logged |
| `prescriptions.notes`, `medications_json` | PHI (sensitive) | encrypted at rest (pgcrypto or app-layer AES-GCM), access logged to `audit_logs` on every read |
| `profiles.dob`, `address_json` | PII | encrypted at rest, RBAC-restricted |
| `payments.raw_webhook_json` | Sensitive (financial) | encrypted, retained per compliance window, then purged |
| `audit_logs` | Compliance record | append-only, no update/delete grants at the DB role level |

---

## 8. Indexing Summary (the ones that matter for p95 targets)

```sql
CREATE UNIQUE INDEX ON users (email);
CREATE INDEX ON doctors USING GIN (languages);
CREATE INDEX ON doctors (specialty);
CREATE INDEX ON availability_slots (doctor_id, start_time, status);
CREATE UNIQUE INDEX ON consultations (idempotency_key);
CREATE INDEX ON consultations (patient_id, scheduled_at);
CREATE INDEX ON consultations (doctor_id, scheduled_at);
CREATE UNIQUE INDEX ON payments (provider_ref);
CREATE UNIQUE INDEX ON payments (idempotency_key);
CREATE INDEX ON audit_logs (entity_type, entity_id, created_at);
```

---

## 9. Backup & DR (ties to architecture doc §9)

- **Postgres:** continuous WAL archiving + daily base backup → point-in-time recovery. RPO target ~5 min, RTO target ~30 min for the primary consultations/payments data.
- **Partitioned tables** (`consultations`, `audit_logs`): old partitions (>90 days) can be backed up once and detached to cold storage, shrinking the working-set backup size without losing data.
- **Redis:** treated as pure cache, not source of truth — no backup needed, safe to flush and let it repopulate on cache miss.