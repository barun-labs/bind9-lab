# Declarative-lab tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A Labs tab that declares a DNS lab (BIND nodes + router) as containerlab intent and deploys it end-to-end via the existing engine.

**Architecture:** A `Lab` entity (SQLite JSON) pairs a `TopologyModel` with a Configuration; bind nodes reconcile to Servers so DNS roles/options attach. Backend exposes CRUD + render/import(YAML) + validate + a deploy-job that runs the existing `deploy(model, topology)` engine. The React tab authors nodes/links as a form with a round-tripping YAML view, and a Deploy button that streams job status.

**Tech Stack:** Node 20 + Fastify + better-sqlite3 + js-yaml (backend); React 18 + Vite + TS (frontend); Vitest.

**Spec:** `bind9-manager/docs/superpowers/specs/2026-08-15-declarative-lab-tab-design.md`

## Global Constraints

- All under `bind9-manager/backend` and `bind9-manager/app`. Reuse: `src/config-engine/topology.ts` (`generateClabTopology`, `validateTopology`, `NodeSpec`, `TopologyModel`), `src/server/deployEngine.ts` (`deploy`), `src/server/entityStore.ts`, `src/server/app.ts` (auth middleware + `authorize`), `src/server/db.ts` (`openDb`).
- Every mutation authorizes: lab CRUD/import/validate require `authorize(actor,'edit',configId)`; deploy requires `authorize(actor,'deploy',configId)`; reads require `'view'`. Unauth → 401, unauthorized → 403.
- Deploy targets must never be a reserved name (`dns`, `clab-*`) — the deploy engine already guards this; do not weaken it.
- TS strict; each task's gate = its tests green + `tsc --noEmit` + `npm run build`.
- Fixture-safe frontend: with `VITE_API_BASE` unset the app uses fixtures; existing suites must stay green.
- Commits authored by the repo user (`barun-labs`); no trailers. Delegated down the ladder (agy flash → deepseek → Sonnet). Security-relevant units (deploy trigger, import parser, permission gates) get the full three-agent QA loop; others get build + deepseek-pro test + orchestrator review.

---

## Task 1: Lab entity + labStore + CRUD API + node↔Server reconcile

**Files:**
- Modify: `backend/src/server/db.ts` (add `labs` table)
- Create: `backend/src/server/labStore.ts`, `backend/test/labStore.test.ts`
- Modify: `backend/src/server/app.ts` (lab CRUD routes)
- Modify: `backend/test/app.crud.test.ts` (or new `test/app.labs.test.ts`)

**Interfaces:**
- Produces: `interface Lab { id:string; name:string; configurationId:string; topology:TopologyModel; createdAt:string; updatedAt:string }` (export from labStore).
- `listLabs(db, configId): Lab[]`, `getLab(db,id): Lab|null`, `createLab(db,{name,configurationId,topology}): Lab`, `updateLab(db,id,patch): Lab`, `deleteLab(db,id): {deleted:true}`.
- `reconcileServers(db, lab): void` — for each `bind` node (a node whose `intent==='bind'`, see below), upsert a Server in `lab.configurationId`; remove Servers previously created by this lab whose node is gone.
- `NodeSpec` gains an optional `intent?: 'bind'|'router'|'bridge'` (kept alongside clab `kind`); `generateClabTopology` ignores `intent`. Add this field in `topology.ts`.

- [ ] **Step 1: Failing test** `backend/test/labStore.test.ts`

```ts
import { openDb } from '../src/server/db';
import { createLab, getLab, listLabs, updateLab, deleteLab } from '../src/server/labStore';
import * as es from '../src/server/entityStore';
const topo = (nodes:any[]) => ({ name:'mylab', mgmtSubnet:'10.70.0.0/24', nodes, links:[] });
test('create/list/get/update/delete a lab', () => {
  const db = openDb(':memory:');
  const lab = createLab(db, { name:'mylab', configurationId:'dns-lab', topology: topo([]) });
  expect(getLab(db, lab.id)!.name).toBe('mylab');
  expect(listLabs(db,'dns-lab').some(l=>l.id===lab.id)).toBe(true);
  updateLab(db, lab.id, { name:'renamed' });
  expect(getLab(db, lab.id)!.name).toBe('renamed');
  deleteLab(db, lab.id);
  expect(getLab(db, lab.id)).toBeNull();
});
test('a bind node reconciles to a Server; router/bridge do not', () => {
  const db = openDb(':memory:');
  const nodes = [
    { name:'ns1', kind:'linux', intent:'bind', image:'dnsnode:1.0', mgmtIpv4:'10.70.0.11', interfaces:[{name:'eth1',address:'10.70.0.11/24'}] },
    { name:'r1',  kind:'linux', intent:'router', image:'dnsnode:1.0', mgmtIpv4:'10.70.0.1' },
    { name:'br',  kind:'bridge', intent:'bridge' },
  ];
  const lab = createLab(db, { name:'mylab', configurationId:'dns-lab', topology: topo(nodes) });
  const servers = es.listServers ? es.listServers(db,'dns-lab') : []; // see note
  expect(servers.find((s:any)=>s.nodeName==='ns1')).toBeTruthy();
  expect(servers.find((s:any)=>s.nodeName==='r1')).toBeUndefined();
  // removing the bind node unlinks its server
  updateLab(db, lab.id, { topology: topo(nodes.filter(n=>n.name!=='ns1')) });
  const after = es.listServers ? es.listServers(db,'dns-lab') : [];
  expect(after.find((s:any)=>s.nodeName==='ns1')).toBeUndefined();
});
```

Note: if `entityStore` has no `listServers`/server-write helpers yet, add minimal ones in `entityStore.ts` (a `servers` table already exists from slice 2b — add `listServers(db,configId)`, `upsertServer(db,server)`, `deleteServerByNode(db,configId,nodeName)`), and include them in this task.

- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement.** `labs` table `(id PK, configurationId, data TEXT/*JSON Lab*/)`. `createLab`/`updateLab` call `reconcileServers`. `reconcileServers` maps a bind node to a Server `{ id:'srv-'+node.name, configurationId, hostname:node.name, labName:lab.name, nodeName:node.name, mgmtAddress:node.mgmtIpv4, serviceInterfaces:(node.interfaces||[]).map(i=>({address:i.address.split('/')[0],port:53})), adminState:'ENABLED', syncState:'PENDING' }`.
- [ ] **Step 4: Run — pass; typecheck.**
- [ ] **Step 5: Add CRUD routes** in `app.ts` under `/api/v1/labs` (list filtered by `?configurationId=`; get/post/patch/delete), each `authorize('edit'|'view', configId)`. Add `test/app.labs.test.ts`: admin creates a lab (201) and lists it; a viewer → 403 on POST; unauth → 401.
- [ ] **Step 6: Run route tests + full backend suite; typecheck; build.**
- [ ] **Step 7: Commit** — `git commit -m "feat: Lab entity + labStore + CRUD + node-to-Server reconcile"`

---

## Task 2: render / yaml / import round-trip + validate

**Files:** Modify `backend/src/server/app.ts`; create `backend/test/app.labs.render.test.ts`.

**Interfaces:**
- Consumes: `generateClabTopology`, `validateTopology` (topology.ts); `generateServerConfig`, `validateConfig` (config-engine); the Configuration→ConfigModel builder (add `buildConfigModel(db, configId): ConfigModel` in `entityStore.ts` if absent — assemble configuration/views/zones/records/servers/roles/options from the store).
- Produces routes:
  - `POST /api/v1/labs/:id/render` → `{ yaml: string }` (`generateClabTopology(lab.topology)`).
  - `GET /api/v1/labs/:id/yaml` → same `text/yaml`.
  - `POST /api/v1/labs/import` body `{ name, configurationId, yaml }` → parse with `js-yaml.load`, map clab nodes/links → `TopologyModel` (node `kind:'bridge'`→intent bridge, else intent inferred `bind` unless name matches a router heuristic — default all linux nodes to intent `bind`, mark those with `ipForward` or name containing `router`/`r1` as `router`; document the heuristic), `validateTopology` → if problems, 422 `{error}`; else `createLab`. Returns the Lab.
  - `POST /api/v1/labs/:id/validate` → `{ topology: string[], perServer: {serverId,ok,errors}[] }` using `validateTopology(lab.topology)` and, for each bind node's Server, `validateConfig(generateServerConfig(buildConfigModel(db,configId), serverId), runner)`.

- [ ] **Step 1: Failing tests** `test/app.labs.render.test.ts`

```ts
// with an admin bearer + a lab created via the API:
// POST /labs/:id/render -> 200, body.yaml contains 'topology:' and the node names
// POST /labs/import {yaml: <a small valid clab.yml string>} -> 201, returns a lab whose topology has the parsed nodes
// import with malformed yaml -> 422 with an error
// POST /labs/:id/validate -> 200 with topology:[] for a clean lab
// a viewer bearer -> 403 on import/validate
```

- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement** the four handlers. For `validateConfig`, use the same ssh/local runner the deploy path uses (inject a runner returning `{code:0,stdout:'OK',stderr:''}` in unit tests).
- [ ] **Step 4: Run — pass; full suite; typecheck; build.**
- [ ] **Step 5: Commit** — `git commit -m "feat: lab render/yaml/import round-trip + validate endpoints"`

---

## Task 3: deploy-job endpoint (wire the deploy engine) — FULL QA loop

**Files:** Create `backend/src/server/deployJobs.ts`, `backend/test/deployJobs.test.ts`; modify `app.ts`.

**Interfaces:**
- `interface DeployJob { id:string; labId:string; status:'QUEUED'|'RUNNING'|'SUCCEEDED'|'FAILED'; result?:DeployResult; error?:string; createdAt:string }`.
- `startDeployJob(db, lab, {run, labDir}): DeployJob` — creates a QUEUED job, runs `deploy(buildConfigModel(db,lab.configurationId), lab.topology, {run,labDir})` (async), stores the `DeployResult`, flips status. `getDeployJob(db,id): DeployJob|null`.
- Routes: `POST /api/v1/labs/:id/deploy` (auth `'deploy'`) → `{ jobId }`; `GET /api/v1/deploy-jobs/:id` (auth `'view'`) → the job.

- [ ] **Step 1: Failing tests** (MOCK runner) — `POST /deploy` as a user WITHOUT deploy perm → 403 and no job/engine call; as an admin (has deploy) → 201 `{jobId}`, then `GET /deploy-jobs/:jobId` eventually `SUCCEEDED` with per-server results; a lab whose config is invalid → job `FAILED` with the pre-flight `aborted` reason (engine gate holds — no containerlab command in the mock's recorded scripts).
- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement.** Persist jobs in a `deploy_jobs` table (or in-memory map keyed by id — a table is fine). The engine call uses the injected `run` (in production the ssh/local runner; in tests a mock).
- [ ] **Step 4: Run — pass; full suite; typecheck; build.**
- [ ] **Step 5: Commit** — `git commit -m "feat: deploy-job endpoint wiring the deploy engine (deploy from the UI)"`
- [ ] **QA: full three-agent loop** (this is the deploy trigger). Tester proves: no-deploy-perm → 403 and engine never runs; pre-flight gate holds through the job; reserved-name lab refused; no secret leak in the job response.

---

## Task 4: Labs list + editor UI (nodes/links form + YAML tab + preview)

**Files:** Create `app/src/routes/Labs/Labs.tsx`, `app/src/routes/Labs/LabEditor.tsx`, tests; modify `app/src/router.tsx` (routes `/config/:configId/labs`, `/config/:configId/labs/:labId`), `app/src/layout/Sidebar/Sidebar.tsx` (Labs entry), `app/src/data/apiAdapter.ts` (+`listLabs/getLab/createLab/updateLab/deleteLab/renderLab/importLab/validateLab`, fixture-backed default).

**Interfaces:** consumes the Task 1–2 endpoints via `apiAdapter`.

- [ ] **Step 1: Build** the Labs list (a `DataTable` of the config's labs + New Lab) and `LabEditor`: a node form (name, `kind`/`intent` select bind/router/bridge, image, mgmtIpv4, interfaces), a link list, a **YAML tab** (`CodeBlock`, editable) with "regenerate from form" and "parse YAML to form", and a `clab.yml` preview showing `validateLab` feedback.
- [ ] **Step 2: Tests** (`LabEditor.test.tsx`): adding a node then viewing the YAML tab shows that node in the generated YAML; pasting a small clab.yml and "parse to form" populates the node list; fixture default keeps the suite offline.
- [ ] **Step 3: Run app suite; typecheck; build.**
- [ ] **Step 4: Commit** — `git commit -m "feat: Labs tab — list + editor (form + YAML round-trip + preview)"`

---

## Task 5: Deploy button + job-status progress

**Files:** Modify `LabEditor.tsx` (Deploy button + progress panel); create `app/src/routes/Labs/DeployProgress.tsx`, test.

**Interfaces:** consumes `POST /labs/:id/deploy` + `GET /deploy-jobs/:id` via `apiAdapter` (`deployLab(id)→{jobId}`, `getDeployJob(id)`).

- [ ] **Step 1: Build** the Deploy button: calls `validateLab` first (blocks on topology/config errors, showing them), then `deployLab`, then polls `getDeployJob` and renders a per-server progress list (`StatusPill`: QUEUED→RUNNING→SUCCEEDED/FAILED) with the final `DeployResult` (validated + deployed + any dig output).
- [ ] **Step 2: Tests** (mock adapter): clicking Deploy with a valid lab drives the panel to SUCCEEDED and lists per-server results; a validate failure blocks deploy and shows the errors.
- [ ] **Step 3: Run app suite; typecheck; build.**
- [ ] **Step 4: Commit** — `git commit -m "feat: Labs deploy button + job-status progress panel"`

---

## Self-review notes

- **Spec coverage:** Lab entity + reconcile (T1), render/yaml/import + validate (T2), deploy-job/deploy-from-UI (T3), tab list+editor+YAML round-trip (T4), deploy button+progress (T5) — every spec section maps to a task. The `intent` field addition and `buildConfigModel`/`listServers` helpers are called out where first needed.
- **Placeholders:** each task has concrete tests + interfaces; the import heuristic (linux→bind unless router-marked) is stated explicitly rather than left vague.
- **Type consistency:** `Lab`, `DeployJob`, `NodeSpec.intent`, `reconcileServers`, `buildConfigModel`, `startDeployJob`/`getDeployJob` are defined where introduced and consumed unchanged downstream.
