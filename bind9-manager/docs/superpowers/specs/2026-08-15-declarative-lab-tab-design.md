# Declarative-lab tab — design

Add a **Labs** tab to Bind9-Manager: declare a DNS lab (BIND nodes + router as containerlab intent) in
the UI, and deploy it via containerlab as an alternative to hand-writing `clab.yml`. It layers a UI +
persistence + deploy-wiring over machinery that already exists (the `TopologyModel` +
`generateClabTopology`, data-plane provisioning, and the deploy engine).

## Decisions (locked with the user)

- **The lab is the source of nodes.** A `bind` node creates/links a **Server** in the lab's linked
  Configuration, so the DNS roles/options set elsewhere attach to it. `router`/`bridge` nodes are
  infrastructure only (no Server, no named.conf).
- **Authoring is hybrid: form + YAML.** A guided form editor is the primary path; a YAML tab round-trips
  (import/paste a `clab.yml` → parsed to the model; edit the form → regenerated YAML). Both produce one
  `TopologyModel`.
- **Deploy runs the full loop:** validate → `containerlab deploy` → provision IPs/routes → push
  named.conf → start named → dig verify — the existing `deploy(model, topology)` engine.

## Data model

New entity **Lab** (SQLite, JSON column for the flexible topology):
`Lab { id, name, configurationId, topology: TopologyModel, createdAt, updatedAt }`.
It pairs a `TopologyModel` (nodes + links = the containerlab intent) with the Configuration whose DNS
model (Servers, DeploymentRoles, DeploymentOptions) supplies each bind node's `named.conf`.

`TopologyModel` already exists (`src/config-engine/topology.ts`) and now carries, per node: `kind`
(`linux`/`bridge` today — extended here to distinguish the intent `bind`/`router`), `image`, `mgmtIpv4`,
`interfaces`, `ipForward`, `routes`, `defaultVia`, plus `links`. The UI's node `kind` intent
(`bind`/`router`/`bridge`) maps to clab `kind: linux`/`bridge` at render time; `bind` additionally marks
the node as owning a Server.

## Backend (Node/Fastify, on clab-mini)

New `labStore` (DAO) + routes under `/api/v1`, all behind the auth middleware; mutations require
`authorize(actor,'edit',configId)`, deploy requires `authorize(actor,'deploy',configId)`:

- `GET /labs?configurationId=` · `POST /labs` · `GET /labs/:id` · `PATCH /labs/:id` · `DELETE /labs/:id`.
- `POST /labs/:id/render` → `clab.yml` text (`generateClabTopology`). `GET /labs/:id/yaml` — export.
- `POST /labs/import` — body `{ name, configurationId, yaml }`; parse with js-yaml → `TopologyModel`
  (+ `validateTopology`); create the Lab and reconcile Servers. Round-trips real containerlab files.
- `POST /labs/:id/validate` → `{ topology: string[], perServer: {serverId, ok, errors}[] }` — runs
  `validateTopology` + the engine's pre-flight `validateConfig` for each bind node (no deploy).
- `POST /labs/:id/deploy` → creates a **DeployJob**, runs `deploy(configModel, topology, {run, labDir})`
  asynchronously; returns `{ jobId }`. `GET /deploy-jobs/:id` returns status + per-server results (poll;
  SSE optional later). This is also backlog item "deploy from the UI".

**Node↔Server reconciliation** (on `POST`/`PATCH /labs`): for each `bind` node, upsert a Server in
`configurationId` — `hostname = node.name`, `labName = lab.name`, `nodeName = node.name`,
`mgmtAddress = node.mgmtIpv4`, `serviceInterfaces` from the node's data interfaces. Bind nodes removed
from the topology unlink their Server. `router`/`bridge` nodes are skipped. The reserved-name guard
(`dns`, `clab-*`) already in the deploy engine prevents targeting the production lab.

## Frontend (React)

Sidebar entry **Labs**. Routes `/config/:configId/labs` (list) and `/config/:configId/labs/:labId`
(editor).

- **List:** the Configuration's labs (name, node count, last deploy), New-Lab button.
- **Editor:**
  - **Nodes** — a form/list: add node (`name`, `kind: bind|router|bridge`, `image`, `mgmtIpv4`, data
    `interfaces[]`), edit/remove. Bind nodes show a link to their Server's roles/options.
  - **Links** — add link (endpoint A `node:iface` ↔ endpoint B).
  - **YAML tab** — the generated `clab.yml` (CodeBlock), editable; a "parse to form" action imports edits
    back to the model; an import box accepts a pasted `clab.yml`.
  - **Preview** — live `clab.yml` + `validateTopology` feedback.
  - **Deploy** — validate → deploy; a progress panel polls the deploy-job and shows each node's state
    (validating → deploying → provisioning → named → verified) with the final dig result. Reuses
    `StatusPill`, `DataTable`, `CodeBlock`, `SidePanel`.

The app stays fixture-safe: with no backend (`VITE_API_BASE` unset) the Labs tab reads seed fixtures;
with the backend it uses the real API.

## Testing

- Backend: `labStore` CRUD + reconcile (bind node creates/unlinks a Server; router skipped); `import`
  parses a real anycast-style `clab.yml` → a TopologyModel that `validateTopology` accepts; `validate`
  surfaces a bad config; `deploy` goes through the engine (mock runner in unit tests; the real deploy is
  exercised by the existing engine E2E). Permission gates: viewer → 403 on lab mutate/deploy.
- Frontend: form edits regenerate the YAML; importing YAML populates the form; deploy button drives the
  job-status panel. Fixture default keeps the suite offline.
- **Security-relevant units** (deploy trigger, import parser) get the full three-agent QA loop; the rest
  get build + deepseek-pro test + orchestrator review, per the QA pipeline.

## Decomposition (build order)

1. `Lab` entity + `labStore` + CRUD API + node↔Server reconcile.
2. render/yaml/import (YAML round-trip) + validate.
3. deploy-job endpoint wiring the engine (deploy from the UI).
4. Labs list + editor (nodes/links form + YAML tab + preview).
5. Deploy button + job-status progress panel.

## Out of scope

A visual drag-canvas editor (form + YAML covers authoring); multi-Configuration labs (a lab links one
Configuration); editing the DNS roles/options from the Labs tab (those stay in the DNS screens — the lab
just owns the boxes).
