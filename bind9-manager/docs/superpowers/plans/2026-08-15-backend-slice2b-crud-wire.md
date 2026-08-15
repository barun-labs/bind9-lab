# Backend slice 2b — CRUD API + wire the frontend

**Goal:** Persist and serve the object model (configs, views, zones, records, external hosts) over the
Fastify server, enforce permissions on every mutation, wire the React app's `apiAdapter` to the real
backend, and clear the 3 deferred Unit-C nits.

**Loop policy (per the goal):** full three-agent loop only for the permission-enforcement route work
(security). Data DAO + frontend wiring → agy-flash build + deepseek-pro test + orchestrator diff-review.
Worker ladder throughout.

**Spec basis:** `design/docs/api-contract.md` (envelope `{data,page,size,total}`, error
`{error:{code,message,field}}`, filters one-param-each, `sort=field:asc`).

---

## Unit A — entity store (DAO + CRUD service) — lighter loop
**Files:** `backend/src/server/entityStore.ts`, `backend/test/entityStore.test.ts`. Extend `db.ts`
schema with tables `configurations, views, zones, records, external_hosts` (identity+FK columns +
JSON column for nested fields: `soa`, `rdata`, `counts`, `matchClients`). Seed the store from
`design/docs/fixtures.json` on first open of a fresh DB so there is data to serve.
**Interfaces:** `listConfigurations(db)`, `listViews(db,configId)`, `listZones(db,configId,filters)`,
`getZone(db,id)`, `listRecords(db,zoneId,{type?,status?,q?,page,size,sort?})→ListEnvelope`,
`createRecord/updateRecord/deleteRecord`, `listExternalHosts(db,configId)`. All return the
api-contract envelope for lists. Referential integrity: deleting a zone reports dependent counts.
**QA:** deepseek-pro test pass (pagination/filter/sort correctness, FK integrity, envelope shape,
seed idempotency) + orchestrator review. No separate reviewer unless a finding warrants it.

## Unit B — CRUD routes with permission enforcement — FULL loop (security)
**Files:** extend `backend/src/server/app.ts`; `backend/test/app.crud.test.ts`. Routes per
api-contract under `/api/v1`: configurations (list/get), zones (list/get/patch/delete), records
(list/create/patch/delete), external-hosts (list). EVERY mutation runs
`authorize(req.actor, <permission>, configId)` — read routes need `view`, create/update/delete need
`edit`, and 403 otherwise; a read-only api-key is blocked on writes (this finally exercises the
scope-clamp that was dormant in 2a). Also apply the 3 deferred Unit-C fixes: `app.ts` `safeParseJson`
for scopes; `DELETE /sessions/current` returns 400 when the bearer is an api-key not a session.
**QA (full loop):** agy-flash build → deepseek-pro adversarial test (viewer→403 on write, read-only key
→403 on write, cross-config 403, unauth 401, no secret leak) ∥ cavecrew review → orchestrator decide →
fix loop (cap 2) → commit. Artifacts under `docs/qa/s2b-unitB/`.

## Unit C — wire the React app to the backend — lighter loop
**Files:** `app/src/data/apiAdapter.ts` (swap the in-memory fixture reads for `fetch('/api/v1/...')`
when `import.meta.env.VITE_API_BASE` is set; keep the fixture path as the default so existing tests
still pass), `app/src/auth/AuthProvider.tsx` (real `login` → `POST /sessions`, store the bearer),
a small `app/src/data/http.ts` client attaching the bearer. Vite dev proxy `/api` → backend.
**QA:** deepseek-pro test of the adapter's request-shaping + orchestrator review; frontend suite stays
green (fixtures default keeps unit tests offline).

## Unit D — run + gate
`backend`: `npm run build`; a `dev` script running the server. `app`: `vite build`. A top-level
`README` note on running both. Full suites green. Then slice 3 (topology → clab) follows.
