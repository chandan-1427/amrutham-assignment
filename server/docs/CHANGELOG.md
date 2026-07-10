# Amrutam Backend — Progress Log

## Status: Auth & Identity (4/22 Tier-1 routes) — implemented, tested, working
## Status: User Profile (2/22 Tier-1 routes) — implemented, not yet tested

Stack: Hono, Node, TypeScript (NodeNext/ESM), Supabase Postgres, Drizzle ORM, jose, argon2

---

## What's done

### Database
- Drizzle schema for `users`, `profiles`, `refresh_tokens` (`src/db/schema.ts`)
- `refresh_tokens` is **not** in the original DB design doc — added because the
  project's own JWT rules require revocable refresh tokens, and there was
  nowhere to store them. Stores a SHA-256 hash of the token, not the raw value.
- `email` uniqueness enforced via a unique index on `lower(email)` rather than
  the `citext` extension — avoids enabling an extra Postgres extension for the
  same guarantee.
- `dob` → `date`, `addressJson` → `jsonb` (corrected from an initial `text`
  placeholder during review).
- Drizzle relation (`usersRelations`) added for the `users.profile` `with`
  query used by `GET /users/me`.
- Migrations generated via `drizzle-kit generate`, applied via a custom
  `src/db/migrate.ts` script (`pnpm db:migrate`). Config lives at
  `src/drizzle.config.ts` (moved from root per project preference), invoked
  with `--config=src/drizzle.config.ts`, paths resolved with
  `fileURLToPath`/`path.resolve` rather than bare relative strings, since bare
  relative paths in drizzle-kit config resolve against cwd and are unreliable
  on Windows when the config isn't at the project root.

### Auth library code
- `src/lib/password.ts` — argon2id hashing, OWASP baseline cost params.
- `src/lib/tokens.ts` — access tokens are short-lived JWTs (HS256, 15 min,
  `sub` + `role` claims only). MFA challenge tokens are a separate 5-min JWT
  with a `purpose: 'mfa'` claim, so a login-stage token can't be replayed as
  an access token. Refresh tokens are **opaque random strings** (32 bytes,
  hex), not JWTs — only their SHA-256 hash is persisted, so a DB read doesn't
  hand out a usable token.
- `src/lib/mfa.ts` — AES-256-GCM envelope encryption for `mfa_secret` at
  rest; TOTP verification via `otplib` v13's `TOTP` class
  (`totp.verify(code, { secret })`, async, returns `{ valid, delta? }` —
  the API changed significantly from v12's `authenticator` singleton, which
  is fully removed in v13).
- `src/lib/errors.ts` — single `AppError` class, handled centrally in
  `app.onError()`. No per-route try/catch/custom-JSON.
- `src/config/env.ts` — Zod-validated env, fails fast on missing/invalid vars
  at startup. Loads `.env` via `import 'dotenv/config'` at the top of this
  module (the single place `process.env` is read), so no other file needs its
  own dotenv import.

### Auth & Identity routes (Tier 1) — `src/routes/auth/index.ts`
| Route | Status |
|---|---|
| `POST /auth/register` | ✅ tested — creates `patient` role user + profile row, hashes password, 409 on duplicate email |
| `POST /auth/login` | ✅ tested — verifies password, returns MFA challenge token + `mfaRequired` flag, 401 on bad credentials |
| `POST /auth/mfa/verify` | ✅ tested — TOTP check only enforced if `mfaEnabled` is true; issues access + refresh token pair |
| `POST /auth/refresh-token` | ✅ tested — rotates on use, old token hash marked `revokedAt`, reuse of a rotated token correctly 401s |

**Known limitation (by design, not oversight):** no route in Tier 1 enrolls
MFA (sets `mfa_secret` / `mfa_enabled`), so every account currently skips the
TOTP check at `mfa/verify`. Flagged for the README as a scoping note, same
pattern as the doc's own Tier 2 scoping call-outs.

### User Profile routes (Tier 1) — `src/routes/users/index.ts`
| Route | Status |
|---|---|
| `GET /users/me` | ✅ tested — returns user + joined profile, 401 with no/invalid token |
| `PATCH /users/me` | ✅ tested — updates profile fields, 400 on empty body, 400 on invalid dob format |

### Doctor Availability & Search (Tier 1) — `src/routes/doctors/index.ts`, `src/routes/availability/index.ts`
| Route | Status |
|---|---|
| `POST /doctors/:id/availability` | ✅ tested — doctor-only, ownership-checked (token sub must match :id param), 403 for wrong doctor or patient role, 400 on endTime before startTime |
| `GET /availability/search` | ✅ tested — filters by specialty/date/language/maxPrice, no auth required per route map, no Redis cache yet (deferred per decision) |

**Scope notes:**
- No overlap checking on slot creation — a doctor can create overlapping slots. Not in the original spec; flagged rather than silently added.
- `maxPrice` filter treated as a ceiling (patient budget), not a range — DB doc only said "price" generically.
- `POST /doctors` (creating a doctor record) is Tier 2 / not implemented. Test doctor accounts are provisioned via `src/db/seed.ts` (`pnpm db:seed <email>`), a dev-only script, not a route.

### Consultations (Booking Saga) & Payments (Tier 1)
`src/routes/consultations/index.ts`, `src/routes/payments/index.ts`

| Route | Status |
|---|---|
| `POST /consultations` | ✅ tested — saga trigger, optimistic lock on slot, idempotent on retry (bug found + fixed: replay path now returns same `{consultation, payment}` shape as first call) |
| `GET /consultations/:id` | ✅ tested |
| `GET /consultations` | ✅ tested — role-scoped correctly for patient and doctor |
| `POST /consultations/:id/start` | ✅ tested — state guard confirmed (409 on invalid transition) |
| `POST /consultations/:id/complete` | ✅ tested |
| `POST /consultations/:id/no-show` | ✅ tested |
| `POST /consultations/:id/cancel` | ✅ tested — cancels a confirmed booking, releases slot back to available, 409 on cancelling an already-completed consultation |
| `POST /payments/intent` | ✅ tested |
| `POST /payments/webhook` | ✅ tested — both confirm and fail paths, HMAC signature verified |

**Bug fixed:** idempotent-replay branch of `POST /consultations` returned a bare
consultation object instead of the `{consultation, payment}` wrapper the
first-time path returns — callers retrying with the same `Idempotency-Key`
got an inconsistent response shape. Fixed by looking up the associated
payment on replay too.

**Bug fixed (2nd instance of same pattern):** `POST /payments/intent` allowed
creating a second `payments` row for a consultation that already had one
(e.g. one created internally by the booking saga) — no uniqueness check on
`consultation_id` existed at either the app or DB layer. Fixed by:
1. Checking for an existing payment by `consultationId` before insert,
   returning the existing one instead of creating a duplicate.
2. Adding a DB-level `UNIQUE` index on `payments.consultation_id` so the
   1:1 invariant (per the DB doc's ER summary) holds even under a race,
   not just when the app-layer check happens to run first.
3. Both early-return branches wrapped in the same `{payment, checkoutUrl}`
   shape as the fresh-creation path — same shape-consistency bug as the
   consultations idempotency fix earlier in this session.

One duplicate row from testing this bug was manually cleaned up before the
unique index could be applied (see git history / this log — not a schema
concern, just leftover test data).

**Also fixed:** `requireUuidParam` helper added (`src/lib/params.ts`) —
malformed UUID path params were previously falling through to Postgres and
surfacing as a raw 500 (`invalid input syntax for type uuid`) instead of a
clean 400. Applied to all `:id` params in `consultations` and `doctors` routes.

**Scope/simplification notes:**
- No monthly partitioning on `consultations`/`payments`/`audit_logs` as the
  DB doc specifies — deferred, flagged for README as a known simplification
  given test-scale data.
- Stub payment gateway (`src/lib/payment-gateway.ts`) — no real network call;
  HMAC-signed webhook loop is real and exercised via `pnpm webhook:simulate`.
- Cancel-route idempotency relies on state-machine idempotency (re-cancelling
  a cancelled consultation is a no-op returning the same result), not a
  second stored idempotency key.

### Prescriptions (Tier 1) — `src/routes/consultations/index.ts` (POST), `src/routes/prescriptions/index.ts` (GET)
| Route | Status |
|---|---|
| `POST /consultations/:id/prescriptions` | ✅ tested — doctor-only, requires in_progress/completed status, 409 on duplicate (one prescription per consultation per DB doc), 403 for patient attempting to write |
| `GET /prescriptions/:id` | ✅ tested — patient/doctor only (party check), 403 for third party, decrypted content verified to round-trip exactly against what was submitted |

**PHI encryption:** `notes` and `medications` stored as AES-256-GCM encrypted
text (`src/lib/encryption.ts`), not `jsonb` as sketched in the DB doc —
encrypted bytes aren't valid JSON, so `medications_json` became
`medications_encrypted text`. Encryption logic extracted from the earlier
MFA-secret implementation into a shared module rather than duplicated;
`mfa.ts` refactored to use it (no behavior change). New `PHI_ENCRYPTION_KEY`
env var, separate from `MFA_ENCRYPTION_KEY` — different sensitivity domains,
independently rotatable.

**Deferred:** DB doc §7 requires PHI access to be logged to `audit_logs` on
every read. `audit_logs` doesn't exist yet (next batch) — a `TODO` marks the
spot in `GET /prescriptions/:id` where that call belongs once it does.

### Middleware
- `src/middleware/auth.ts` — `requireAuth`. Single responsibility: extract
  `Bearer` token, verify signature/expiry via `jose`, attach `{ id, role }`
  to context as `user`, or throw 401. No role/ownership logic inside — that
  stays in the route handlers per project convention.

---

## Environment setup

Required in `.env` (project root):
```
DATABASE_URL=postgresql://...
JWT_SECRET=<48-byte hex>
MFA_ENCRYPTION_KEY=<32-byte hex>
```

Generate secrets on Windows (no OpenSSL dependency):
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # MFA_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_SECRET
```

Migrations:
```powershell
pnpm db:generate
pnpm db:migrate
```

---

## Environment/tooling notes worth remembering

- Project uses `NodeNext` module resolution + `"type": "module"` — all
  relative imports must use explicit `.js` extensions even though the source
  files are `.ts`.
- CJS packages under `NodeNext` sometimes need namespace imports
  (`import * as x from 'pkg'`) instead of default imports depending on how
  their type declarations are shaped — hit this with `otplib`.
- PowerShell's `curl` alias is `Invoke-WebRequest`, not real curl — use
  `Invoke-RestMethod` for JSON APIs, and `Format-List` instead of the default
  table view when a response has enough fields to get truncated.

---

## Next up
- Test `GET /users/me` and `PATCH /users/me`
- Then: Doctor Availability & Search routes