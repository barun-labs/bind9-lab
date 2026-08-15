# Slice 2b Unit B — adversarial test report

Verdict: **PASS** — no authorization defects found.

Test file: `bind9-manager/backend/test/app.crud.adversarial.test.ts` (20 tests, all passing).

Full backend suite: `npx vitest run` — 17 files, 318 tests passed.
Typecheck: `npx tsc --noEmit` — no errors.

## Coverage by requirement

| Requirement | Result |
|---|---|
| Unauthenticated: every CRUD route (GET + mutating) -> 401 | PASS |
| Viewer (dns-lab) cannot write: POST/PATCH records, PATCH/DELETE zones -> 403; GETs -> 200 | PASS |
| Read-only api-key (owner admin, `readOnly:true`) -> 403 on every mutation, 200 on GET | PASS |
| Scope-limited key `scopes:['read']` -> 403 on writes | PASS |
| Cross-config: editor on dns-lab touching a split-horizon zone -> 403 | PASS |
| Mutation authorizes BEFORE store: store byte-for-byte unchanged after 403 | PASS |
| No secret leak: CRUD bodies free of token/keyHash/pwHash/pwSalt/password | PASS |
| Deferred fixes: api-key `DELETE /sessions/current` -> 400; corrupt `scopes` -> no 500 | PASS |
| Robustness: malformed/missing/non-object/wrong-content-type bodies -> 4xx, never 500 | PASS |

## Notable probes that held

- **Scope clamp now fires.** In 2a the `readOnly` clamp in `authorize()` was dormant (no CRUD
  routes exercised `edit`). In 2b it fires: a read-only key minted with scopes
  `['read','write','deploy']` (every scope granted) is still blocked on all five mutations
  (`POST /records`, `PATCH /records/:id`, `DELETE /records/:id`, `PATCH /zones/:id`,
  `DELETE /zones/:id`) because `authorize()` checks `readOnly` before the scope list.
- **Per-permission scope clamp** holds both directions: a `scopes:['write']` (no `read`) key can
  `POST /records` (201) but gets 403 on `GET /zones/:id`.
- **Store unchanged after 403.** Snapshot of zone data, record data, and row counts taken before
  the 403 attempts is byte-identical after, for both viewer and read-only-key actors.
- **Cross-config has no leak.** `split-horizon` has no zones in fixtures, so the test seeds one
  directly; a dns-lab editor gets 403 on read, patch, record-create, and delete against it, while
  still getting 201 on a dns-lab zone (control proves rights are scoped, not globally denied).
- **Corrupt `scopes` column** (`INVALID_JSON{`) resolves to `[]` via `safeParseJson`; the key still
  authenticates and `GET /configurations` returns 200 (empty list), never a 500.

## Defects found

None.
