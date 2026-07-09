# Amrutam Telemedicine Backend — Route Map

This document defines the final route scope for the assignment.

- **Tier 1 (Implement fully)** — coded, tested, secured, observable. ~22 routes.
- **Tier 2 (Document only)** — defined in the OpenAPI spec with request/response schemas, not implemented. Noted explicitly in the README as a scoping decision.

Legend: 🔒 = auth required · 🔑 = idempotency key required · 👑 = admin/role-restricted

---

## Tier 1 — Fully Implemented (22 routes)

### Auth & Identity
| Method | Route | Notes |
|---|---|---|
| POST | `/auth/register` | Password hashed, user created, verification email queued async |
| POST | `/auth/login` | Returns MFA challenge |
| POST | `/auth/mfa/verify` | Issues JWT + refresh token on success |
| POST | `/auth/refresh-token` | Rotates refresh token |

### User Profile
| Method | Route | Notes |
|---|---|---|
| GET | `/users/me` 🔒 | RBAC-scoped read |
| PATCH | `/users/me` 🔒 | Validated write |

### Doctor Availability & Search
| Method | Route | Notes |
|---|---|---|
| POST | `/doctors/:id/availability` 🔒 | Doctor-only write |
| GET | `/availability/search` | Filters: specialty, date, price, language; cached |

### Consultations (Booking Saga)
| Method | Route | Notes |
|---|---|---|
| POST | `/consultations` 🔒🔑 | **Saga trigger**: hold slot → create consultation (`PENDING_PAYMENT`) → create payment intent |
| GET | `/consultations/:id` 🔒 | Owner/doctor/admin only; read-through cache |
| GET | `/consultations` 🔒 | Paginated, filterable by role (patient/doctor) |
| POST | `/consultations/:id/start` 🔒 | Doctor-only; `CONFIRMED` → `IN_PROGRESS` |
| POST | `/consultations/:id/complete` 🔒 | Doctor-only; `IN_PROGRESS` → `COMPLETED` |
| POST | `/consultations/:id/cancel` 🔒🔑 | **Saga compensation**: release slot, refund, `CANCELLED` |
| POST | `/consultations/:id/no-show` 🔒 | Doctor-only edge case |

### Prescriptions
| Method | Route | Notes |
|---|---|---|
| POST | `/consultations/:id/prescriptions` 🔒 | Doctor-only, tied to `COMPLETED`/`IN_PROGRESS` consultation |
| GET | `/prescriptions/:id` 🔒 | Patient/doctor only |

### Payments
| Method | Route | Notes |
|---|---|---|
| POST | `/payments/intent` 🔒🔑 | Idempotent create |
| POST | `/payments/webhook` | Signature-verified, async, drives saga continuation |

### Compliance & Audit
| Method | Route | Notes |
|---|---|---|
| GET | `/audit-logs` 🔒👑 | Filterable by entity/date/actor |

### Admin Analytics
| Method | Route | Notes |
|---|---|---|
| GET | `/admin/analytics/consultations` 🔒👑 | Aggregate volume/trend query |

### Ops / Observability
| Method | Route | Notes |
|---|---|---|
| GET | `/healthz` | Liveness probe |
| GET | `/readyz` | Readiness probe (DB/Redis check) |
| GET | `/metrics` | Prometheus scrape endpoint |

---

## Tier 2 — Documented Only in OpenAPI Spec (not implemented)

These are defined with full schemas so the API contract is complete, but excluded from the coded implementation given the time box. Called out explicitly in the README.

| Area | Routes |
|---|---|
| Auth | `POST /auth/logout`, `POST /auth/password/forgot`, `POST /auth/password/reset`, `POST /auth/email/verify`, `POST /auth/oauth/:provider/callback` |
| Users | `DELETE /users/me`, `GET /users/:id`, `POST /users/:id/roles`, `GET /users/:id/audit-trail` |
| Doctors | `POST /doctors`, `GET /doctors/:id`, `PATCH /doctors/:id`, `GET /doctors`, `POST /doctors/:id/verify` |
| Availability | `GET /doctors/:id/availability`, `PATCH /availability/:slotId`, `DELETE /availability/:slotId`, `POST /availability/bulk` |
| Search | `GET /search/suggestions`, `GET /specialties` |
| Consultations | `PATCH /consultations/:id/reschedule`, `GET /consultations/:id/timeline` |
| Prescriptions | `GET /prescriptions/:id/pdf`, `PATCH /prescriptions/:id`, `GET /patients/:id/prescriptions` |
| Payments | `POST /payments/:id/confirm`, `POST /payments/:id/refund`, `GET /payments/:id`, `GET /consultations/:id/invoice` |
| Compliance | `GET /audit-logs/:entityId`, `POST /consent` |
| Admin | `GET /admin/analytics/doctors`, `GET /admin/analytics/revenue`, `GET /admin/system/health`, `GET /admin/users/flagged` |

---

## Scoping Rationale (for README)

> Given a 4–5 day hand-built implementation window, this project prioritizes **depth over breadth**: the 22 Tier 1 routes fully implement every required system capability (auth, RBAC, MFA, booking saga, idempotency, payments webhook, prescriptions, audit trail, analytics, observability) end-to-end with tests. All remaining product-surface routes (profile management extras, doctor onboarding CRUD, reschedule, refunds, etc.) are fully specified in the OpenAPI schema but not implemented, to protect the correctness and test coverage of the core flows.