# Slice 2a — Unit C adversarial test report

**Verdict: PASS**

Independent tester. Did not write the code under test. Attacked it as an unauthenticated client
through real `app.inject()` HTTP requests against `buildApp(openDb(':memory:'))`. Code under test:
`src/server/app.ts` (uncommitted).

## Coverage

New file: `test/app.adversarial.test.ts` — 59 tests, all green.

- **Unauthenticated matrix** — every protected route (`GET /me`, `POST/GET /api-keys`,
  `DELETE /api-keys/:id`, `DELETE /sessions/current`) × every broken auth shape (no header,
  garbage bearer, `admin`, `Basic ...`, bare `Bearer`, `Bearer ` empty token, empty string) → all 401.
- **Login** — wrong password → 401 with no token in body; correct → 200 token that authorizes `/me`.
- **Session lifecycle** — `DELETE /sessions/current` revokes (subsequent `/me` → 401); expired
  session (`expiresAt` pushed to the past via store) → 401; deactivated user mid-session → 401.
- **API-key auth** — valid key → `/me` 200 with `viaApiKey:true`; expired key → 401; deleted key →
  401; key cannot create another key → 403.
- **Privilege** — read-only key → 403 where the owner session → 204 on the same key; non-owner
  non-admin → 403 / owner → 204; a write-scoped (non-readOnly) key still cannot delete another
  user's key (api key is never admin).
- **Secret leakage** — `GET /api-keys` body contains no `"token"` and no `"keyHash"`; `POST /api-keys`
  returns the token exactly once; viewer cannot list admin keys.
- **Injection / robustness** — SQL-ish username/password → 401 no crash, DB intact; missing body /
  non-string username → 401; `text/plain`, malformed JSON, 2 MB body → all 4xx, never 500; malicious
  api-key id → 404.

## Results

- Full suite: `npx vitest run` → 235 passed (13 files).
- Adversarial file alone: 59 passed.
- `npx tsc --noEmit` → exit 0.

## Defects found

None. No protected route reachable without auth, no leaked secret, no 500 on bad input, no missing 403.

## Observations (not defects, no failing test left)

- `DELETE /api/v1/sessions/current` when the bearer is an API key returns 204 but does not revoke
  the key. `req.token` is the API-key token; `revokeSession` deletes from `sessions` only, so it is a
  no-op. A client "logging out" with an API key stays authenticated. Not a privilege escalation, and
  the spec only defines this route as session logout; flagging for a later slice if key-scoped
  revocation is wanted.
- API-key `scopes` are not enforced by any 2a route. The only write-ish route (`DELETE /api-keys/:id`)
  checks `readOnly` and owner/admin, never `scopes`/`authorize(..., 'write')`. The spec's "scope not
  granted → 403" bar is therefore not observable over HTTP until slice 2b adds write routes. Not a
  hole today (the enforced readOnly + owner/admin checks cover the exposed surface), but the
  scope-clamp path in `authorize` is currently dead code from the HTTP layer's perspective.
