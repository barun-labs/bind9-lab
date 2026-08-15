# Backend slice 2a — auth + persistence: Implementation Plan

> Executed through the QA pipeline in `docs/superpowers/process/qa-pipeline.md`: each UNIT below is
> Built (agy flash), then independently Tested (deepseek-v4-pro) and Reviewed (cavecrew-reviewer) in
> parallel, then the orchestrator decides accept/fix/escalate before committing.

**Goal:** Real auth + persistence — SQLite store, scrypt password hashing, bearer sessions, API-key
validation, server-side permission enforcement, behind a minimal Fastify server.

**Spec:** `bind9-manager/docs/superpowers/specs/2026-08-15-backend-slice2a-auth-persistence.md`

## Global Constraints
- All under `bind9-manager/backend/`. Reuse `shared/`. TS strict.
- Each unit's gate = its tests green + `tsc --noEmit` + `npm run build`, AND a clean QA-pipeline pass.
- Secrets: store only hashes; return a token exactly once; `timingSafeEqual` for all secret compares;
  never log secrets.
- Commits authored by `barun-labs`; no trailers. Delegated down the ladder.

---

## Unit A — persistence + crypto + auth store

**Files:** `backend/src/server/db.ts` (open better-sqlite3, create schema, seed admin),
`backend/src/server/crypto.ts` (scrypt hash/verify, randomToken, sha256), `backend/src/server/authStore.ts`
(user DAO; sessions login/resolve/revoke; api-keys create/resolve). Tests: `backend/test/authStore.test.ts`,
`backend/test/crypto.test.ts`.

**Interfaces (produced, consumed by B and C):**
- `openDb(path=':memory:') → Database` — creates tables `users`, `sessions`, `api_keys`; seeds one admin.
- `hashPassword(pw) → {salt,hash}`; `verifyPassword(pw,salt,hash) → boolean`; `randomToken() → string`;
  `sha256(s) → string`.
- `login(db, username, pw) → {token, expiresAt} | null`; `resolveSession(db, token) → User | null`;
  `revokeSession(db, token) → void`.
- `createApiKey(db, ownerUserId, {name,scopes,readOnly,expiresAt}) → {id, token}`;
  `resolveApiKey(db, token) → {key: ApiKeyRow, user: User} | null` (rejects expired, bumps lastUsedAt).

**Build steps (builder):** add deps `fastify better-sqlite3` + types; implement the three modules;
write happy-path + a few edge tests (wrong password, expired session, hash≠plaintext). Session TTL
e.g. 8h; api-key expiry honored; all secret compares timing-safe.

**Then run the QA pipeline on Unit A.** Tester must add: expired/garbage/tampered token paths, DB
stores no plaintext, timing-safe usage, api-key expiry + lastUsedAt bump, duplicate username rejected.

---

## Unit B — authorize (permissions + scope clamp)

**Files:** `shared/can.ts` (+ `shared/can.test.ts`) copied from `app/src/auth/can.ts` (note the dup to
unify later); `backend/src/server/authorize.ts`; `backend/test/authorize.test.ts`.

**Interfaces:**
- `type Actor = { user: User; viaApiKey?: ApiKeyRow }`.
- `authorize(actor, permission: Permission, configId: string) → boolean` — `can(actor.user, permission,
  configId)` AND, when `viaApiKey`, clamp: a `readOnly` key fails `edit`/`deploy`; a key whose `scopes`
  don't include the mapped scope (view→read, edit→write, deploy→deploy, admin→(never via key)) fails.

**Build:** implement; test the role matrix (from slice-1 `can`) plus every clamp path.

**Then run the QA pipeline on Unit B.** Tester must prove: read-only key blocked on write even when the
owner is admin; scope-missing blocked; admin permission never granted through an api-key; wrong-config
scope blocked.

---

## Unit C — Fastify app + middleware + routes

**Files:** `backend/src/server/app.ts` (build the Fastify instance, auth middleware, routes),
`backend/src/server/index.ts` (listen), `backend/test/app.test.ts` (integration via `app.inject()`).

**Interfaces:**
- `buildApp(db) → FastifyInstance`.
- Middleware: resolve `Authorization: Bearer <token>` via `resolveSession`/`resolveApiKey` → `req.actor`;
  401 if neither. Applied to every route except `POST /api/v1/sessions`.
- Routes: `POST /api/v1/sessions` (login→token), `DELETE /api/v1/sessions/current`, `GET /api/v1/me`,
  `POST/GET/DELETE /api/v1/api-keys` (create returns token once; GET never returns a secret; delete
  requires owner or `authorize(actor,'admin',*)`).

**Build:** wire it; integration-test the happy path + a couple of 401s.

**Then run the QA pipeline on Unit C** — this is the security-critical HTTP surface. Tester must run the
full bypass matrix from the spec's testing bar against real injected requests: no-auth 401, garbage 401,
expired 401, revoked 401, read-only-key 403 on write, scope 403, viewer 403 / admin 200, and assert GET
/api-keys never leaks a secret.

---

## Unit D — slice gate
Orchestrator: full `backend` suite green + `build`, all three units' `decision.md` = accept. Report the
slice done and the QA-pipeline assessment.
