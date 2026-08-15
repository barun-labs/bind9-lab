# Containerlab Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploying a declarative lab makes its bind nodes appear in the Server tab bound to the real containers (real ID, IP, live state), and streams per-node telemetry from containerlab into the app.

**Architecture:** After a successful `containerlab deploy`, run `containerlab inspect --format json`, parse it, and merge real runtime facts onto the lab's Server rows. A telemetry module runs `containerlab inspect` + `docker stats` + `docker logs` on demand, exposed as a snapshot, an SSE stream, and a logs endpoint. All containerlab/docker commands ride the existing injected `Runner` seam.

**Tech stack:** Node 20 + Fastify + better-sqlite3 (backend/), React 18 + Vite + TS (app/). No new runtime dependency.

**Spec:** `bind9-manager/docs/superpowers/specs/2026-08-15-containerlab-integration-design.md`

## Global constraints

Every task's requirements implicitly include these — copied verbatim from the spec.

- Names that become a filesystem path, container name, or shell argument are validated `^[A-Za-z0-9_-]+$` at the write boundary; paths/container-names are derived **server-side** from the validated name, never taken from the request body.
- Every `containerlab`/`docker` command runs through the injected `Runner` (`type Runner = (bashScript: string) => Promise<{code:number,stdout:string,stderr:string}>`), never a direct `child_process` call in a handler.
- Any reconcile/telemetry test includes a **must-fail control** — an input whose correct answer is not the happy path (a bind node with an absent container must resolve to `NODE_ABSENT`).
- Telemetry, logs, and sync endpoints are gated `authorize(actor, 'view', lab.configurationId)`.
- Runtime Server fields live in the Server JSON blob — **no SQLite migration**.
- No `Co-Authored-By: Claude` / "Generated with Claude Code" trailers on commits/PRs.
- Package roots: backend `bind9-manager/backend`, frontend `bind9-manager/app`. Verify per touched package with `npx vitest run && npm run typecheck && npm run build`. No `|| true`. Do not edit `design/`.

## Reference facts (verified this session — do not re-derive)

- **Node → container name:** `clab-<topology.name>-<node.name>`.
- **Bind node predicate (reconcile side):** `node.intent === 'bind'` (matches `labStore.reconcileServers` and the validate route). Use this predicate, not `deployEngine`'s `kind:'linux'` one.
- **Server id convention:** `srv-<lab.id>-<node.name>` (set by `reconcileServers`).
- **`containerlab inspect -t <labDir>/topo.clab.yml --format json`** returns `{"<labName>":[{name,container_id,image,kind,state,status,ipv4_address,ipv6_address,owner}, ...]}`. `ipv4_address` carries a `/NN` suffix.
- **`docker stats --no-stream --format '{{json .}}'`** returns one JSON object per line: `{BlockIO,CPUPerc,Container,ID,MemPerc,MemUsage,Name,NetIO,PIDs}`.
- **`labDir`** is derived server-side as `/home/lun/<topo.name>` (deploy route already does this).
- **Server type** (`backend/src/config-engine/model.ts:5-16`) is `{ id; name?; ...; [key:string]: unknown }` stored as a JSON `data` column → new fields are additive, no migration.
- **`upsertServer(db, server)`** (`backend/src/server/entityStore.ts:434`) is INSERT…ON CONFLICT(id) DO UPDATE — the create/update fn. `listServers(db, configId)` (:417), `getServer(db, id)` (:425).
- **`SyncState`** enum values: `SYNCED | PENDING | DEPLOYING | DRIFT | ERROR | NODE_ABSENT | UNREACHABLE`.
- **Bug to fix:** `labStore.ts:95` reads `(node as any).mgmtIvp4 ?? node.mgmtIpv4` — misspelled first. Fix to `node.mgmtIpv4`.
- **Deploy result** (`deployEngine.ts:9-24`): `DeployResult { validated[]; plan?; aborted?; deployed?: {serverId,ok,output}[] }`. `deployed[].serverId` = `model.servers[].id`.
- **Runner injection:** `buildApp(db, opts)` picks `activeRunner = opts.runner ?? defaultAppRunner ?? defaultFallbackRunner`. Tests pass a fake runner. `setDefaultAppRunner()` swaps it globally.

---

## Task 1: Runtime inspect-gather in the deploy engine

**Files:**
- Modify: `bind9-manager/backend/src/server/deployEngine.ts`
- Test: `bind9-manager/backend/test/deployEngine.runtime.test.ts` (new)

**Interfaces:**
- Produces: `interface RuntimeNode { name: string; containerId: string; image?: string; state?: string; status?: string; ipv4Address?: string; }`; extends `DeployResult` with `runtime?: RuntimeNode[]` and `runtimeError?: string`; exports `parseInspect(stdout: string): RuntimeNode[]`.
- Consumes: existing `Runner`, `DeployOptions { run; labDir; dryRun? }`.

- [ ] **Step 1: Write the failing test for `parseInspect`**

```ts
import { describe, it, expect } from 'vitest';
import { parseInspect } from '../src/server/deployEngine';

describe('parseInspect', () => {
  it('flattens the lab-keyed inspect JSON into RuntimeNode[]', () => {
    const stdout = JSON.stringify({
      'bind9mgr-testlab': [
        { name: 'clab-bind9mgr-testlab-auth', container_id: '72a05f2e501c',
          image: 'dnsnode:1.0', kind: 'linux', state: 'running',
          status: 'Up 2 hours', ipv4_address: '10.60.99.30/24', ipv6_address: 'N/A', owner: 'lun' },
      ],
    });
    const nodes = parseInspect(stdout);
    expect(nodes).toEqual([
      { name: 'clab-bind9mgr-testlab-auth', containerId: '72a05f2e501c',
        image: 'dnsnode:1.0', state: 'running', status: 'Up 2 hours', ipv4Address: '10.60.99.30/24' },
    ]);
  });

  it('returns [] on empty or unparseable input', () => {
    expect(parseInspect('')).toEqual([]);
    expect(parseInspect('not json')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `cd bind9-manager/backend && npx vitest run test/deployEngine.runtime.test.ts` → FAIL (`parseInspect` not exported).

- [ ] **Step 3: Implement `parseInspect` and `RuntimeNode`** in `deployEngine.ts`. `parseInspect` JSON-parses, takes all values (arrays keyed by lab name), flattens, maps snake_case → the `RuntimeNode` fields, and returns `[]` on any throw or non-object. Add `runtime?` / `runtimeError?` to the `DeployResult` interface.

- [ ] **Step 4: Write the failing test for inspect-gather in `deploy()`** — a fake runner whose first call (deploy script) returns `{code:0,...}` and whose second call (containerlab inspect) returns the JSON above; assert `deploy(model, topology, {run, labDir})` resolves with `result.runtime` populated. Add a case where the inspect call returns `{code:1}` → `result.runtime` undefined and `result.runtimeError` set, and `result` is otherwise a success (deploy not aborted).

```ts
// sketch — match the existing deployEngine.test.ts harness/model builders
const calls: string[] = [];
const run = async (script: string) => {
  calls.push(script);
  if (script.includes('containerlab inspect')) return { code: 0, stdout: INSPECT_JSON, stderr: '' };
  return { code: 0, stdout: DEPLOY_STDOUT_WITH_MARKERS, stderr: '' };
};
const result = await deploy(model, topology, { run, labDir: '/home/lun/t' });
expect(result.runtime?.[0].containerId).toBe('72a05f2e501c');
```

- [ ] **Step 5: Run it, verify it fails.**

- [ ] **Step 6: Implement inspect-gather in `deploy()`** — after the deploy script runs and the run is not `dryRun` and not `aborted` and the script exited 0, make one more `opts.run(\`containerlab inspect -t ${opts.labDir}/topo.clab.yml --format json\`)`. On `code===0`, `result.runtime = parseInspect(stdout)`. On non-zero or a thrown error, set `result.runtimeError` and leave `runtime` undefined. **A failed inspect must never turn a successful deploy into a failure.**

- [ ] **Step 7: Run the full backend suite** — `cd bind9-manager/backend && npx vitest run && npm run typecheck && npm run build`. All green.

- [ ] **Step 8: Commit** — `feat(deploy): gather containerlab inspect runtime after deploy`.

---

## Task 2: `reconcileServersRuntime` + wire into deploy jobs (THREE-AGENT QA)

This is the security/deploy-critical unit. After the worker builds it, run the adversarial-test + review loop before committing.

**Files:**
- Modify: `bind9-manager/backend/src/server/labStore.ts` (add `reconcileServersRuntime`; fix the `mgmtIvp4` typo at line 95)
- Modify: `bind9-manager/backend/src/server/deployJobs.ts` (call it on `SUCCEEDED`)
- Test: `bind9-manager/backend/test/reconcileRuntime.test.ts` (new)

**Interfaces:**
- Produces: `export function reconcileServersRuntime(db: Database.Database, lab: Lab, result: DeployResult, now?: string): void`.
- Consumes: `DeployResult` (`runtime?`, `runtimeError?`, `deployed?`) from Task 1; `upsertServer`, `getServer` from `entityStore`; `Lab`, bind-node predicate `node.intent === 'bind'`.

- [ ] **Step 1: Write the failing tests** (all four scenarios — the must-fail control is mandatory):

```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { createLab, reconcileServersRuntime } from '../src/server/labStore';
import { getServer } from '../src/server/entityStore';

function bindNode(name: string, ip: string) {
  return { name, kind: 'linux' as const, intent: 'bind' as const, image: 'dnsnode:1.0', mgmtIpv4: ip,
           binds: [`configs/${name}/named.conf:/etc/bind/named.conf`], interfaces: [] };
}
function inspectEntry(lab: string, node: string, id: string, ip: string, state = 'running') {
  return { name: `clab-${lab}-${node}`, containerId: id, state, status: 'Up 1 minute', ipv4Address: `${ip}/24` };
}

describe('reconcileServersRuntime', () => {
  it('binds a running bind node to its real container and marks SYNCED', () => {
    const db = openDb(':memory:');
    const lab = createLab(db, { name: 'lab1', configurationId: 'dns-lab',
      topology: { name: 'lab1', nodes: [bindNode('auth', '10.0.0.30')], links: [] } });
    const result = { validated: [], deployed: [{ serverId: 'auth', ok: true, output: '' }],
      runtime: [inspectEntry('lab1', 'auth', 'abc123', '10.0.0.30')] };
    reconcileServersRuntime(db, lab, result as any);
    const srv = getServer(db, 'srv-' + lab.id + '-auth') as any;
    expect(srv.containerId).toBe('abc123');
    expect(srv.runtimeAddress).toBe('10.0.0.30');
    expect(srv.syncState).toBe('SYNCED');
    expect(srv.lastDeployedAt).toBeTruthy();
  });

  it('MUST-FAIL CONTROL: a bind node absent from inspect becomes NODE_ABSENT', () => {
    const db = openDb(':memory:');
    const lab = createLab(db, { name: 'lab2', configurationId: 'dns-lab',
      topology: { name: 'lab2', nodes: [bindNode('auth', '10.0.0.30'), bindNode('cache', '10.0.0.31')], links: [] } });
    const result = { validated: [], deployed: [{ serverId: 'auth', ok: true, output: '' }],
      runtime: [inspectEntry('lab2', 'auth', 'abc123', '10.0.0.30')] }; // cache absent
    reconcileServersRuntime(db, lab, result as any);
    expect((getServer(db, 'srv-' + lab.id + '-cache') as any).syncState).toBe('NODE_ABSENT');
    expect((getServer(db, 'srv-' + lab.id + '-auth') as any).syncState).toBe('SYNCED');
  });

  it('a container present but with a failed deploy entry becomes ERROR', () => {
    const db = openDb(':memory:');
    const lab = createLab(db, { name: 'lab3', configurationId: 'dns-lab',
      topology: { name: 'lab3', nodes: [bindNode('auth', '10.0.0.30')], links: [] } });
    const result = { validated: [], deployed: [{ serverId: 'auth', ok: false, output: 'rndc failed' }],
      runtime: [inspectEntry('lab3', 'auth', 'abc123', '10.0.0.30')] };
    reconcileServersRuntime(db, lab, result as any);
    expect((getServer(db, 'srv-' + lab.id + '-auth') as any).syncState).toBe('ERROR');
  });

  it('leaves syncState untouched when inspect itself failed', () => {
    const db = openDb(':memory:');
    const lab = createLab(db, { name: 'lab4', configurationId: 'dns-lab',
      topology: { name: 'lab4', nodes: [bindNode('auth', '10.0.0.30')], links: [] } });
    const before = (getServer(db, 'srv-' + lab.id + '-auth') as any).syncState; // 'PENDING'
    reconcileServersRuntime(db, lab, { validated: [], runtimeError: 'inspect exited 1' } as any);
    expect((getServer(db, 'srv-' + lab.id + '-auth') as any).syncState).toBe(before);
  });
});
```

- [ ] **Step 2: Run, verify failure** — `npx vitest run test/reconcileRuntime.test.ts` → FAIL (`reconcileServersRuntime` not exported).

- [ ] **Step 3: Implement `reconcileServersRuntime`.** For each `node` in `lab.topology.nodes` where `node.intent === 'bind'`:
  - If `result.runtimeError` and no `result.runtime` → return early without touching any Server (liveness unknown).
  - Build `containerName = 'clab-' + lab.topology.name + '-' + node.name`; find the matching `RuntimeNode` by `r.name === containerName`.
  - Load the existing Server `srv-<lab.id>-<node.name>` via `getServer`. (It exists — `reconcileServers` created it at lab CRUD.)
  - Derive `syncState`: no runtime match → `NODE_ABSENT`; matched AND its `deployed[]` entry (keyed by `node.name` as `serverId`) `ok:false` → `ERROR`; matched and ok (or no deployed entry but present and running) → `SYNCED`.
  - `upsertServer` the merged row: spread the existing server, then set `containerId`, `runtimeAddress` (matched `ipv4Address` with `/NN` stripped), `runtimeState` (matched `state`), `syncState`, `lastDeployedAt = now ?? new Date().toISOString()`. Preserve `configurationId`.
  - **Do not overwrite `mgmtAddress`** — keep declared and runtime distinct.

- [ ] **Step 4: Fix the `mgmtIvp4` typo** in `reconcileServers` (`labStore.ts:95`): `const mgmtAddress = node.mgmtIpv4;`. Confirm the existing labStore tests still pass.

- [ ] **Step 5: Run, verify pass.**

- [ ] **Step 6: Wire into `deployJobs.startDeployJob`** — in the completion IIFE, after `result` is computed and status set to `SUCCEEDED` (not aborted), call `reconcileServersRuntime(db, lab, result)`. Guard it in a try/catch that logs but does not flip the job to FAILED (reconcile is best-effort; the deploy already succeeded).

- [ ] **Step 7: Extend `deployJobs.test.ts`** — a fake runner returning deploy markers + inspect JSON drives a job to `SUCCEEDED` AND leaves the lab's Server row `SYNCED` with a `containerId`.

- [ ] **Step 8: Full backend suite green** — `npx vitest run && npm run typecheck && npm run build`.

- [ ] **Step 9: THREE-AGENT QA** — dispatch an adversarial tester (deepseek-pro) to attack `reconcileServersRuntime` (id-join edge cases: a node name that is a prefix of another, a `router` node accidentally matched, an inspect entry for a container from a *different* lab sharing a node name) and a reviewer (cavecrew-reviewer) on the diff. Orchestrator resolves findings, then commits.

- [ ] **Step 10: Commit** — `feat(deploy): reconcile bind nodes to real containers on deploy (QA-passed)`.

---

## Task 3: Servers read API

**Files:**
- Modify: `bind9-manager/backend/src/server/app.ts` (two routes)
- Test: `bind9-manager/backend/test/app.servers.test.ts` (new)

**Interfaces:**
- Produces: `GET /api/v1/configurations/:configId/servers` → `Server[]`; `GET /api/v1/configurations/:configId/servers/:serverId` → `Server | 404`. Both gated `authorize(actor, 'view', configId)`.
- Consumes: `listServers(db, configId)`, `getServer(db, id)`.

- [ ] **Step 1: Write failing tests** — a seeded config with servers returns them from the list route with a valid token; a `view`-less actor gets 403; an unknown `serverId` gets 404; a `serverId` from a *different* config is not returned (scope check). Mirror the auth/token setup in the existing `app.labs.*.test.ts` files.

- [ ] **Step 2: Run, verify failure.**

- [ ] **Step 3: Implement both routes** next to the existing lab routes in `app.ts`, following the exact `authorize` + error-shape pattern of the neighboring `GET /labs` and `GET /labs/:id` handlers. The detail route loads via `getServer` and 404s if the server's `configurationId` !== the path `configId`.

- [ ] **Step 4: Run, verify pass; full suite green.**

- [ ] **Step 5: Commit** — `feat(api): read-only servers list + detail routes`.

---

## Task 4: Telemetry module + snapshot/stream/logs/sync routes (THREE-AGENT QA)

**Files:**
- Create: `bind9-manager/backend/src/server/telemetry.ts`
- Modify: `bind9-manager/backend/src/server/app.ts` (four routes)
- Test: `bind9-manager/backend/test/telemetry.test.ts`, `bind9-manager/backend/test/app.telemetry.test.ts` (new)

**Interfaces:**
- Produces: `interface TelemetryNode { nodeName; containerName; containerId?; state?; status?; address?; cpuPerc?; memPerc?; memUsage?; netIO?; blockIO?; pids?; present: boolean }`; `async function snapshot(lab: Lab, run: Runner, labDir: string): Promise<{ nodes: TelemetryNode[]; at: string; runtimeError?: string }>`; `parseDockerStats(stdout: string): Record<string, any>` keyed by container name.
- Consumes: `parseInspect` from `deployEngine` (Task 1); `Runner`; `Lab`.

- [ ] **Step 1: Write failing test for `parseDockerStats` + `snapshot`** — a fake runner returning inspect JSON (auth running, cache **absent**) and docker-stats NDJSON for the auth container; assert `snapshot` yields `auth` with `present:true` + `cpuPerc`, and `cache` with `present:false`. Assert a stats row for a container **not** in the lab is ignored.

```ts
const run = async (script: string) => {
  if (script.includes('containerlab inspect')) return { code: 0, stdout: INSPECT_JSON, stderr: '' };
  if (script.includes('docker stats')) return { code: 0, stdout: STATS_NDJSON, stderr: '' };
  return { code: 0, stdout: '', stderr: '' };
};
const snap = await snapshot(lab, run, '/home/lun/lab1');
```

- [ ] **Step 2: Run, verify failure.**

- [ ] **Step 3: Implement `telemetry.ts`.** `snapshot` runs `containerlab inspect -t <labDir>/topo.clab.yml --format json` (reuse `parseInspect`) and `docker stats --no-stream --format '{{json .}}' <containerNames...>` where the container names are derived server-side from `lab.topology.name` + each bind node name. Join by container name. A bind node with no inspect entry → `present:false`. `parseDockerStats` splits NDJSON lines, JSON-parses each, keys by `.Name`. Non-lab containers are dropped by only iterating the lab's own node list. On inspect failure, return `{ nodes: [...present:false], at, runtimeError }`.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Write failing route tests** (`app.telemetry.test.ts`) — snapshot route returns nodes with a `view` token and 403 without; logs route rejects a `:node` not in the lab topology (400) and a `:node` with bad charset (400), and returns text for a valid node with a fake runner; `sync` route reconciles (drives an absent node's Server to `NODE_ABSENT`). For SSE, assert the handler sets `content-type: text/event-stream` and writes at least one `data:` frame (use fastify `inject` or a short-lived real listen; if inject can't stream, assert header + first frame via a mocked reply that captures writes).

- [ ] **Step 6: Run, verify failure.**

- [ ] **Step 7: Implement the four routes** in `app.ts`, all `authorize(actor, 'view', lab.configurationId)`:
  - `GET /labs/:id/telemetry` → `snapshot(...)`.
  - `GET /labs/:id/telemetry/stream` → set SSE headers on `reply.raw`, write a frame immediately, then `setInterval` re-run `snapshot` every 2500ms writing `data: <json>\n\n`; `req.raw.on('close', () => clearInterval(t))`; `return reply` hijacked (Fastify: call `reply.hijack()` before writing to raw).
  - `GET /labs/:id/nodes/:node/logs` — validate `:node` against `^[A-Za-z0-9_-]+$` **and** membership in `lab.topology.nodes`; clamp `tail` to ≤1000; `run('docker logs --tail <N> clab-<topo>-<node>')`; return stdout as `text/plain`.
  - `POST /labs/:id/sync` — run inspect (no deploy), build a `DeployResult`-shaped `{ validated: [], runtime }`, call `reconcileServersRuntime(db, lab, that)`, return the updated `listServers` filtered to this lab.

- [ ] **Step 8: Run, verify pass; full suite green.**

- [ ] **Step 9: THREE-AGENT QA** — adversarial tester attacks the logs/sync routes for injection and path traversal (a `:node` like `auth;rm`, `../`, a container name from another lab); reviewer on the diff. Resolve, then commit.

- [ ] **Step 10: Commit** — `feat(telemetry): containerlab inspect+stats snapshot, SSE stream, logs, sync (QA-passed)`.

---

## Task 5: Frontend Servers tab (list + live status)

**Files:**
- Create: `bind9-manager/app/src/routes/Servers/Servers.tsx`, `Servers.test.tsx`
- Modify: `bind9-manager/app/src/data/apiAdapter.ts` (add `listServers`, `getServer`), `app/src/types/entities.ts` (add `Server` type), `app/src/router.tsx` (replace the `/servers` Placeholder), `app/src/layout/Sidebar/Sidebar.tsx` (Servers already in nav? confirm; wire it to the real route).

**Interfaces:**
- Consumes: new backend routes from Task 3; fixture Server shape (`app/public/fixtures.json`).
- Produces: a `Server` frontend type; `listServers(configId): Promise<Server[]>`, `getServer(id): Promise<Server|null>` (fixture-backed default, real when `VITE_API_BASE` set).

- [ ] **Step 1: Write the failing test** — mock the adapter; `Servers` renders one row per server with hostname, node, and a `StatusPill` whose state matches `syncState` (e.g. a `NODE_ABSENT` server shows the `node_absent` pill). Keep the full app suite green offline.

- [ ] **Step 2: Run, verify failure.**

- [ ] **Step 3: Add the `Server` type + adapter fns** — promote the fixture shape (`id, configurationId, hostname, labName, nodeName, mgmtAddress, runtimeAddress?, containerId?, serviceInterfaces[], adminState, syncState, runtimeState?, bindVersion?, lastDeployedAt?`). `listServers`/`getServer` branch on `isApiEnabled()` exactly like the existing lab adapter fns.

- [ ] **Step 4: Build `Servers.tsx`** copying the `ZoneRecords` route structure (DataTable + per-row StatusPill + ToastProvider). Columns: hostname, node, declared mgmt / runtime address, `StatusPill` from `syncState`. Map `syncState` → pill state (`SYNCED`→`synced`, `PENDING`→`pending`, `DEPLOYING`→`deploying`, `DRIFT`→`drift`, `ERROR`→`error`, `NODE_ABSENT`→`node_absent`, `UNREACHABLE`→`unreachable`).

- [ ] **Step 5: Wire the route** — replace the `/config/:configId/servers` Placeholder in `router.tsx` with `<Servers/>`; confirm the Sidebar entry points there.

- [ ] **Step 6: Run, verify pass** — `cd bind9-manager/app && npx vitest run && npm run typecheck && npm run build`.

- [ ] **Step 7: Commit** — `feat(app): real Servers tab — list + live sync-state pills`.

---

## Task 6: Frontend telemetry panel (live SSE view + logs)

**Files:**
- Create: `bind9-manager/app/src/routes/Servers/TelemetryPanel.tsx`, `TelemetryPanel.test.tsx`
- Modify: `app/src/data/apiAdapter.ts` (add `openTelemetryStream(labId, onFrame)` wrapping `EventSource`, and `getNodeLogs(labId, node, tail)`), `Servers.tsx` (open the panel from a row / detail)

**Interfaces:**
- Consumes: `GET /labs/:id/telemetry/stream` (SSE), `GET /labs/:id/nodes/:node/logs`.
- Produces: a live per-node telemetry view.

- [ ] **Step 1: Write the failing test** — mock the stream adapter to emit one frame; assert the panel renders a node's `cpuPerc`/`memUsage`/`state`. Respect `prefers-reduced-motion` (no assertion needed beyond "renders a static number").

- [ ] **Step 2: Run, verify failure.**

- [ ] **Step 3: Add `openTelemetryStream` + `getNodeLogs`** to the adapter. In real mode, `openTelemetryStream` news up an `EventSource` on `${apiBase}/labs/${id}/telemetry/stream` (with the bearer token via query or header per the existing http pattern) and calls `onFrame(JSON.parse(e.data))`; returns a close fn. In fixture mode, it emits a canned frame on a timer so the panel demos offline.

- [ ] **Step 4: Build `TelemetryPanel.tsx`** — on mount open the stream, render a table of nodes with live `state` (StatusPill), `cpuPerc`, `memPerc`, `memUsage`, `netIO`; a "Logs" button per node calls `getNodeLogs` and shows output in a `CodeBlock`. Close the stream on unmount. Honor `prefers-reduced-motion` (no animated transitions).

- [ ] **Step 5: Wire it into `Servers.tsx`** — a row action or detail SidePanel opens the panel for the server's lab.

- [ ] **Step 6: Run, verify pass; full app suite green.**

- [ ] **Step 7: Commit** — `feat(app): live containerlab telemetry panel (SSE) + per-node logs`.

---

## Self-review

- **Spec coverage:** Part 1 (deploy reconcile) → Tasks 1–2. Part 2 (telemetry) → Task 4. Part 3 (sync) → Task 4 (`sync` route). Part 4 (frontend + servers read API) → Tasks 3, 5, 6. All spec sections have a task.
- **Type consistency:** `RuntimeNode` defined in Task 1, consumed in Tasks 2 and 4. `reconcileServersRuntime` signature defined in Task 2, called in Task 4's `sync` route. `TelemetryNode` defined and used in Task 4. `Server` frontend type defined in Task 5, extended-consumed in Task 6. `syncState`→pill mapping identical in spec and Task 5.
- **Must-fail control:** Task 2 Step 1 (NODE_ABSENT) and Task 4 Step 1 (absent node `present:false`) both present.
- **No placeholders:** every code step carries real code or an exact command.

## Execution

Build order is Task 1 → 6. Tasks 2 and 4 get the three-agent QA loop (security/deploy-critical). Each task ends green and is committed independently. Tasks 1–3 deliver the owner's literal ask (deploy → bind nodes in the Server tab, bound to real containers). Tasks 4–6 deliver the telemetry stream and the UI to watch it.
