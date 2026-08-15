# Slice 2b Unit C — Independent Test Pass

## Verdict

**PASS** — no defects found.

## Scope

Independent adversarial test of the real-backend path added in Slice 2b, on top of
the author's own happy-path suites. Source under test (uncommitted): `src/data/http.ts`,
`src/data/apiAdapter.ts`, `src/auth/AuthProvider.tsx`. None modified.

New file: `bind9-manager/app/src/data/apiAdapter.http.adversarial.test.ts` (7 tests).

## What was verified

- **Default is fixtures.** With `VITE_API_BASE` unset (no `.env` present), `isApiEnabled()`
  is false. `listZones`, `listConfigurations`, and `createRecord` never call `fetch`;
  reads come from `fixtures.json`, writes mutate the local store.
- **Enabled path request shape.** `listZones` GETs `<base>/api/v1/configurations/<configId>/zones`
  with `Authorization: Bearer <token>` and returns the `{data,page,size,total}` envelope
  (screens consume `envelope.data`). `createRecord` POSTs the right URL with a JSON body,
  auto-set `Content-Type: application/json`, and the bearer header. Also covered the
  full-absolute-base (`http://localhost:8080`) and the base-ends-in-`/api` dedup edge.
- **Error mapping.** Non-2xx with `{error:{message}}` throws `HttpError` carrying
  `status` and the `error` payload; a network reject (`TypeError`) propagates as a
  rejection, never `undefined`.
- **Auth.** Enabled `login` POSTs `/api/v1/sessions`, stores the token, and later
  adapter calls carry the bearer; `logout` DELETEs `/api/v1/sessions/current`, clears
  the token, and the next call carries no `Authorization` header.

## Full suite

`npx vitest run`: 15 files, **74 passed**, 0 failed.

## Notes

- No failing test left behind — no real defect observed.
- The author's existing suites (`apiAdapter.http.test.ts`, `AuthProvider.http.test.tsx`)
  already locked the happy-path shapes; this pass adds the fixture-default boundary,
  error/network-rejection propagation, and the token lifecycle across the http boundary.
