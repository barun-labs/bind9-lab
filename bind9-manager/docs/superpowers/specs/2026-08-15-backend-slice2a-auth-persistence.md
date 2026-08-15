# Bind9-Manager backend, slice 2a — auth + persistence core

Makes v1.1's *mocked* auth real. This is the security foundation: a SQLite store, password
hashing, bearer sessions, API-key validation, and server-side permission enforcement, exposed
through a minimal Fastify server. The full CRUD API (configs/zones/records) is slice 2b; the
config engine is slice 1 (done). This slice enforces *who may act*, before slice 2b decides
*what they may change*.

## Decisions (locked, by the orchestrator)

- **Fastify** HTTP server, TypeScript.
- **better-sqlite3** — synchronous, single-file, mature prebuilt binaries. (Fallback if the native
  build fails on a host: Node 22's experimental `node:sqlite`. Prefer better-sqlite3.)
- **Password hashing: `node:crypto` scrypt** — stdlib, no native dependency, memory-hard. Store
  `salt` + `hash`; verify with `timingSafeEqual`.
- **Tokens** (session + API key): 32 random bytes from `crypto.randomBytes`, shown to the caller
  once, stored only as a `sha256` hash. A leaked DB never yields a usable token.
- **JSON columns** for flexible/nested fields (`roles`, `scopes`) — schema-flexible without
  migrations, per the project datastore decision.

## Data (SQLite)

```
users     (id TEXT PK, username TEXT UNIQUE, displayName TEXT, isActive INTEGER,
           roles TEXT/*JSON RoleAssignment[]*/, pwSalt TEXT, pwHash TEXT, createdAt TEXT)
sessions  (tokenHash TEXT PK, userId TEXT, createdAt TEXT, expiresAt TEXT)
api_keys  (id TEXT PK, name TEXT, ownerUserId TEXT, keyHash TEXT, scopes TEXT/*JSON*/,
           readOnly INTEGER, expiresAt TEXT NULL, lastUsedAt TEXT NULL, createdAt TEXT)
```

Seed: one admin user (username from env or a fixed dev default), password hashed at seed time.

## What it does

- `hashPassword(pw) → {salt,hash}` / `verifyPassword(pw, salt, hash) → boolean` (scrypt + timing-safe).
- **Sessions:** `login(username, pw) → {token, expiresAt}` (verify, mint, store hash);
  `resolveSession(token) → user | null` (hash-compare, reject expired); `revokeSession(token)`.
- **API keys:** `createApiKey(ownerUserId, {name,scopes,readOnly,expiresAt}) → {id, token}` (token once);
  `resolveApiKey(token) → {key, user} | null` (hash-compare, reject expired, bump lastUsedAt).
- **Auth middleware:** reads `Authorization: Bearer <token>`, resolves a session OR an api-key to an
  actor `{ user, viaApiKey?, scopes?, readOnly? }`; 401 if neither resolves.
- **Permission:** `authorize(actor, permission, configId) → boolean` — server-side, reusing the
  `can()` role logic from slice 1's `shared/`. An api-key actor is additionally clamped to its
  `scopes`/`readOnly` (a read-only key can never pass a write/deploy permission even if its owner
  could).
- **Minimal Fastify routes:** `POST /api/v1/sessions` (login → token), `DELETE /api/v1/sessions/current`
  (logout), `GET /api/v1/me` (current actor), `POST/GET/DELETE /api/v1/api-keys`. Every route except
  login runs the auth middleware; api-key management additionally requires the owner or admin.

## Out of scope for 2a

CRUD for configs/views/zones/records (slice 2b), wiring the React `apiAdapter` to this server (2b),
containerlab/deploy (slices 3–5). Rate-limiting, lockout, and refresh tokens are noted as later
hardening, not built now.

## Testing bar (this slice is the QA-pipeline's first real subject)

Surface tests are not enough. The tester (deepseek-pro) must cover, with real requests:
- wrong password → 401; correct → token that then authorizes `/me`.
- expired session token → 401; revoked session → 401; tampered/garbage bearer → 401; missing header → 401.
- api-key: valid → authorizes; expired → 401; a **read-only** key → 403 on any write/deploy permission
  even when its owner has that right; scope not granted → 403.
- permission matrix: a viewer actor → 403 on an edit-permission route; admin → 200; wrong-config scope → 403.
- password/token at rest: DB stores only hashes — a test asserts the plaintext never appears in a row.
- timing-safe compare is used (no plain `===` on secrets) — reviewer verifies in the diff.

## Constraints

- All under `bind9-manager/backend/`. Reuse slice-1 `shared/` (`can()` if promoted there, else port).
- TS strict; each task's gate = tests green + `tsc --noEmit` + `build`.
- Secrets never logged. No plaintext password/token stored or returned except the one-time token.
- Delegated down the ladder; every task runs the QA pipeline in `docs/superpowers/process/qa-pipeline.md`.
