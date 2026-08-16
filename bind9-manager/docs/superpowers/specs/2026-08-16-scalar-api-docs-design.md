# Scalar API Docs + API Contract Testing — Design (Plane #60, #61)

**Status:** self-approved under the autonomous "complete the backlog" directive.
Combined because both share one OpenAPI generator.

## Goal

- #60: an interactive API reference for the `/api/v1` surface, rendered with
  Scalar, served by the backend and separate from the Zensical `/docs` site.
- #61: API-level contract testing that keeps the OpenAPI description honest —
  every registered route appears, structure is valid — so code and docs cannot
  drift.

## Constraint

No new runtime dependency for OpenAPI generation. The Fastify routes here are
hand-written without JSON schemas, so `@fastify/swagger` would auto-generate almost
nothing. Generate the OpenAPI document from Fastify's own route table via the
`onRoute` hook instead. Scalar's UI is loaded as a standalone script (see below).

## OpenAPI generation (backend, no dep)

In `buildApp`, register `app.addHook('onRoute', (r) => routes.push({ method, url,
schema }))` at the very top, before any route is added, into a module/closure array.
Add `GET /api/openapi.json` that builds an OpenAPI 3.0 document from the collected
routes:

- `info`: title "Bind9-Manager API", version from backend/package.json.
- `paths`: one entry per collected route. Convert Fastify `:param` segments to
  OpenAPI `{param}`; emit a `parameters` list for each path param. Derive a `tags`
  entry from the first meaningful resource segment (e.g.
  `/api/v1/configurations/{configId}/zones` → tag `zones`). Emit a generic
  `responses: { '200': { description } }` (and `4xx` where obvious) — a browsable,
  categorized reference, not a full schema contract.
- Exclude the doc routes themselves, `/health`, and static-file routes.

## Scalar UI (backend)

`GET /api-docs` returns a self-contained HTML page that renders Scalar pointing at
`/api/openapi.json`. Load the Scalar standalone bundle via its CDN script tag
(`https://cdn.jsdelivr.net/npm/@scalar/api-reference`); the app itself needs no
dependency and the operator's browser fetches it. (Offline/self-hosted bundling of
the Scalar asset is the documented upgrade path if the lab has no internet.)

Scalar also provides an in-browser API client (try-it) from the same page — that is
the "API client" half of #60/#61.

## Auth exemption (critical)

The API auth hook 401s everything under `/api`. Exempt `GET /api/openapi.json` and
`GET /api-docs` from auth (mirror how `/health` or the login route is exempted) so
the reference loads without a session. The document describes routes only; it
contains no secrets.

## #61 contract test (backend, Vitest, no dep)

`backend/test/api.contract.test.ts`:

- Boot `buildApp`, GET `/api/openapi.json`, assert it is structurally valid OpenAPI
  3 (`openapi` starts `3.`, `info.title`, non-empty `paths`).
- Assert **every registered `/api/v1` route** (from the app's own route table)
  appears as a path+method in the document — the drift control. A route added to
  the code but missing from the generator must fail this test (must-fail control).
- Assert Fastify `:param` → OpenAPI `{param}` conversion (no `:` left in paths).
- Optionally emit a request-collection JSON the Scalar client can import; skip if it
  adds a dependency.

## Out of scope

- Full request/response body schemas for every route (the routes have none today;
  adding them is a large, separate effort). The reference lists endpoints, methods,
  params, and tags — enough to navigate and try, honest about the rest.
- Bundling Scalar for offline use.

## Testing (must-fail controls)

- Every registered /api/v1 route is present in the OpenAPI doc (drift control:
  remove one from the generator → test fails).
- `/api/openapi.json` and `/api-docs` return 200 WITHOUT auth (must-fail: if the
  auth exemption is missing they 401).
- Generated paths contain no leftover `:` param syntax.
