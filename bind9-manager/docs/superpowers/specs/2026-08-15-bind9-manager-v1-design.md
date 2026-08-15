# Bind9-Manager v1 — design

Bind9-Manager is a web console for the BIND9 anycast lab that lives in this repo
(`../anycast-dns/`). It gives an operator a BlueCat-shaped way to see and edit DNS
objects — Configurations, Views, Zones, Records, Servers — instead of hand-editing
`named.conf` and zone files.

This document specifies **v1 only**: a frontend-only prototype driven by fixture data,
covering the application shell, the flagship Records screen, and a Settings → API Keys
screen. It is the first slice of a much larger design that already exists as an imported
bundle under `../design/` (14 build phases, full entity model, three flagship mockups).
Everything past this slice is designed but not built here.

## What v1 is, and is not

**In:** the three-layer chrome and full routing skeleton (Phase 0); the Records table with
add/edit/disable, type-aware side panel, live zone-file-line preview, and dangling-target
check (Phase 1); a Settings → API Keys screen (list / create-shows-token-once / delete).

**Out:** any real backend, any lab wiring, any deploy machinery, and the other twelve
phases (Review & Deploy, Configurations management, Servers detail, ACLs, health, query
tool, and the rest). No authentication is enforced in v1 — the API Keys screen is UI over
fixture data, it mints a fake token, it guards nothing.

**Why this boundary:** it is the smallest build that renders the imported design faithfully
and proves the component + token + routing foundation, with zero backend risk. The hard,
stateful part — the pending change-set and the deploy engine — is deferred to its own
sub-project.

## Stack

React 18, Vite, TypeScript, react-router. Plain React state and context for the little
session state v1 has; no Redux. The imported mockups (`../design/*.dc.html`) render through
a React runtime (`support.js`), so the design is already React-shaped; the portable truth is
`../design/docs/tokens.css` and the Industry design-system stylesheet
(`../design/_ds/*/styles.css`). Both are ported verbatim. The `.dc.html` files are
throwaway prototypes marked do-not-edit — they are the visual and data-binding reference,
not shipped code.

## Architecture and data flow

One direction: components → `apiAdapter.ts` → an in-memory copy of `fixtures.json`.

The adapter's function signatures and response envelope mirror the imported
`../design/docs/api-contract.md` exactly (`{data, page, size, total}` for lists, the
`{error:{code,message,field}}` error shape, the `page`/`size`/`sort`/one-param-per-filter
convention). Every adapter function is async and returns a Promise. Edits mutate the
in-memory copy so add / edit / disable re-render live; nothing persists to disk.

This is the swap seam: when the real backend sub-project exists, only the *bodies* of
`apiAdapter.ts` change — from reading the fixture copy to `fetch('/api/v1/...')`. Nothing
above the adapter is aware which one it is talking to.

## The data-shape precedence rule (important)

The mockups carry two conflicting notions of a record. Their inline *sample* data is flat
(`rdata: 'ns1.lab.lun.net.'` as a string, `status: 'synced'`, numeric ids). The canonical
model in `../design/docs/entities.md` and `fixtures.json` is structured (`rdata` is a typed
object keyed on record type, `syncState` is an enum, ids are string ULIDs).

The rule, which `../design/DESIGN.md` itself states: **the mockup wins for visuals; the
entity model wins for data shape.** Build every type and every adapter payload to
`entities.md` / `fixtures.json`. Never copy the mockups' inline sample shape. The
reconciliation point is the type layer plus `lib/zonefile.ts`, which formats a structured
`rdata` into the display string the table and preview show.

Copying the flat mockup shape would bake the wrong data model into the whole app. This is
the single largest correctness risk in v1.

## Project structure

Lives beside the imported bundle, so `design/` stays pristine as the reference.

```
bind9-manager/
  design/                         # imported bundle — READ ONLY reference, never edited
  docs/superpowers/specs/         # this document
  app/
    index.html  vite.config.ts  tsconfig.json  package.json
    public/fixtures.json          # copied from design/docs/fixtures.json
    src/
      main.tsx  App.tsx
      styles/  tokens.css  ds.styles.css   # ported verbatim from design/
      router.tsx                  # every routes.md path; most -> <Placeholder>
      types/entities.ts           # enums + interfaces from entities.md
      data/  apiAdapter.ts  store.ts  fixtures loading + in-memory session copy
      lib/   zonefile.ts  validate.ts  query.ts
      layout/  Chrome/  Sidebar/  Placeholder/
      routes/  ZoneRecords/  ApiKeys/
      components/  <one folder per component, per components.md>
```

Component convention follows `../design/docs/components.md` verbatim:
`src/components/X/X.tsx`, one folder per component, variants and states prop-driven rather
than separate files.

`router.tsx` resolves every path in `../design/docs/routes.md` (most to `<Placeholder>`),
plus one route the imported map does not carry: `/settings/api-keys` for the new API Keys
screen.

## v1 component set

Only these are built. Every other name in `components.md` is deferred, not stubbed.

- **Shell (Phase 0):** `ConfigurationSwitcher`, `ViewSwitcher`, `PendingChangesPill`
  (zero-state only in v1), `Breadcrumb`, `Sidebar`, `Placeholder`/`EmptyState`, `Button`.
- **Records (Phase 1):** `DataTable`, `RecordTypeChip`, `StatusPill`, `SidePanel`, `Input`,
  `Textarea`, `Select`, `Combobox` (target/FQDN picker), `Checkbox` (row select),
  `InlineAlert` (dangling-target), `CodeBlock` (live zone-file-line preview), `CopyButton`,
  `Tooltip`, `Toast` (undo-delete), `Skeleton`.
- **API Keys:** reuses `DataTable`, `Button`, `Modal` (create → token shown once with
  `CopyButton`), `Input`.

## Types and the rdata union

`types/entities.ts` is transcribed from `entities.md` with the exact field names. The core
type is the discriminated `rdata` union keyed on `type`:

```ts
type Rdata =
  | { type: 'A' | 'AAAA';         address: string }
  | { type: 'CNAME' | 'NS' | 'ALIAS'; target: string }
  | { type: 'MX';   priority: number; target: string }
  | { type: 'SRV';  priority: number; weight: number; port: number; target: string }
  | { type: 'TXT';  text: string }
  | { type: 'PTR';  target: string }
  | { type: 'CAA';  flags: number; tag: string; value: string };
```

Enums (`SyncState`, `RecordType`, `ZoneType`, …) are string-literal unions matching the
SCREAMING_SNAKE values in the doc. Interfaces: `ResourceRecord`, `Zone`, `View`,
`Configuration`, `ExternalHost`, plus a v1-local `ApiKey` (below).

## The pure libs (they hold the real logic and the real tests)

- `lib/zonefile.ts` — `(name, ttl, rdata) → zone-file line`, one branch per `rdata` type.
  Drives both the side-panel preview and the table's rdata column.
- `lib/validate.ts` — the Phase-1 record rules only, from
  `../design/docs/validation-rules.md`: DNS-label syntax; combined FQDN ≤ 253;
  CNAME-not-at-apex; duplicate (zone, name, type); TTL 0–2147483647 with a sub-60
  **warning**; dangling-target **warning** (target not in this zone or in External Hosts).
  Returns `{errors, warnings}`. The other rules belong to later phases.
- `lib/query.ts` — URL ⇄ table state (`type`, `status`, `q`, `page`, `size`, `sort`,
  `recordId`), so the Records screen is deep-linkable and refresh-safe.

## API surface additions (BlueCat-informed) — recorded, not built in v1

Comparing the imported `api-contract.md` against the BlueCat BAM v2 API (a mature product in
this exact domain) surfaced gaps worth recording in the contract now, to be built when the
backend sub-project starts. None of this is implemented in v1.

- **Auth as bearer API keys.** BAM authenticates with `username:apiToken` (a token minted
  from a session), schemes `basicAuthentication` + `bearerToken`. v1 direction: no login
  page; the first auth capability is minting an API key. Contract:
  `POST /api-keys {name}` → returns the token **once**; `GET /api-keys` returns metadata
  only, never the secret; `DELETE /api-keys/:id`.
- **Available-space discovery** — BAM `availableAddresses/Blocks/Networks`. Add
  `GET /blocks/:id/available?kind=address|block|network`.
- **Issues / data-checker** — BAM `GET /{collection}/{id}/issues`. This is our
  `HealthFinding` (Phase 12); promote it to `GET /issues?objectType=&objectId=`.
- **Audit trail** — BAM attaches a change-control comment to writes and exposes
  `/transactions`. Add `GET /audit` plus an optional `comment` on every mutation.
- **Server logs** — BAM server `_links` expose `logs`. Add `GET /servers/:id/logs`.
- **CSV export** — BAM `text/csv` honors `fields`. Add `?format=csv` to list endpoints.

**Excluded on purpose:** DHCP, client classes, MAC/lease resources — BlueCat is DDI,
Bind9-Manager is DNS-only. **Deferred as v2 seams** (already reserved in `entities.md`):
RBAC / users-groups / access rights, and DNSSEC signing keys — no login page means no RBAC.

**Intentional divergence:** in BAM, zones live under views (`/views/{id}/zones`). Our
contract keeps a flat `configurations/:id/zones?view=` list, which is simpler for this UI.
Noted so it reads as a choice, not an oversight.

### ApiKey entity (v1-local)

`{ id: string, name: string, createdAt: datetime, lastUsedAt: datetime | null,
token?: string }` — `token` is present only in the immediate `POST /api-keys` response and
never again.

## Testing and the completion gate

Real logic gets real unit tests (Vitest):
- `zonefile.ts` — one assertion per `rdata` type produces the correct line.
- `validate.ts` — each rule tested **both ways**: a case that must fail and a control that
  must pass. A rule with no passing control proves nothing.
- `query.ts` — URL ⇄ state round-trips losslessly.

Two screens get React Testing Library smoke tests (behavior, not pixels):
- *Records:* add via panel → row appears; disable → row dims and `PendingChangesPill`
  increments; dangling target → `InlineAlert`; filter/sort → URL updates.
- *API Keys:* create → token shown once in a modal with copy → appears in list; reopening
  never re-shows the secret; delete removes it.

Fidelity is checked structurally against the `.dc` source and by eye against the design
product's rendering; no local headless screenshot in v1 (raw `.dc.html` needs a React host
to run).

**Gate:** `tsc --noEmit` clean, `vitest run` green, `vite build` succeeds. No backend, no
e2e in v1.

## Build execution — worker ladder

This spec and the implementation plan are orchestrator work. **All application code is
delegated down the model ladder**, never written by the orchestrator. Stop at the first
rung that handles the task:

1. **agy flash 3.7** (Antigravity CLI, Gemini; reachable only via Bash, like `dsclaude`) —
   first worker for every implementation task.
2. **deepseek** (`deepseek-v4-flash`, then `deepseek-v4-pro`) — escalate when agy is
   rate-limited or its output is inadequate.
3. **Claude Sonnet 5** (`sonnet-worker`, pinned xhigh effort) — top rung, for the hardest
   tasks only after the agy and deepseek rungs are ruled out.

The orchestrator plans, specs, dispatches, and reviews every diff; it does not implement.
The build order within v1 is Phase 0 shell → Records screen → API Keys screen, each a
worker task reviewed before the next begins.

## v1.1 — auth + RBAC (mock in the frontend)

Added after v1 shipped. This reverses the earlier "no login page" decision.

**The hard constraint:** RBAC only enforces in a backend; a frontend cannot guard an API
that does not exist. So v1.1 builds the *screens and the permission model* against fixtures
with a **mocked** current user — it gates which controls render, it enforces nothing real.
Actual enforcement (password hashing, key validation, permission checks) is the backend
sub-project. Every place enforcement will later live carries a `// mock:` marker.

**Model:** three roles — `viewer` (read), `editor` (stage changes), `admin` (manage users
and keys) — plus a separate `deploy` permission, all **scoped per Configuration**. One
permission model, two doors: a UI session and an API key both resolve to the same
`(actor → roles → scope)` check. API keys are least-privilege — scoped to a subset of the
owner's rights and optionally read-only.

**Screens:** `/login` (outside the Chrome layout); a topbar user menu with logout; a route
guard redirecting unauthenticated users to `/login`; `/settings/users` (admin) for user +
per-config role management. The existing Records and API Keys screens become role-gated.

**The authz core** is `useAuth()` → `{ currentUser, login, logout, can(permission, configId) }`.
Every gated action calls `can()`, so replacing the mock with the backend later changes one
module.

**New / extended entities** (app-owned seed; `design/fixtures.json` has no users and stays
untouched — the store adds a `users` seed in code):
- `User { id, username, displayName, isActive, roles: RoleAssignment[] }`
- `RoleAssignment { configurationId, role: 'viewer'|'editor'|'admin', canDeploy: boolean }`
- `ApiKey` gains `ownerUserId, scopes: ('read'|'write'|'deploy')[], readOnly, expiresAt`.

**Contract additions (recorded, built in the backend phase):** `POST /sessions` (login),
`DELETE /sessions/current` (logout), `GET /me`, users CRUD + `PUT /users/:id/roles`, and the
enforcement middleware resolving actor→roles→scope identically for a session or an API key.
The plan for this increment is `docs/superpowers/plans/2026-08-15-bind9-manager-v1.1-auth.md`.
