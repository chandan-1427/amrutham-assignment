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
| `GET /users/me` | 🔲 written, not yet tested — returns `users` core fields + joined `profile` |
| `PATCH /users/me` | 🔲 written, not yet tested — patches `profiles` only (`fullName`, `dob`, `gender`, `addressJson`, `languagePref`); email/phone/role/status are intentionally not patchable here |

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