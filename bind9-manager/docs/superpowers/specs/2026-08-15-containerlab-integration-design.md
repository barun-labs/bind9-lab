# Containerlab Integration — Design Spec

**Date:** 2026-08-15
**Status:** Approved by delegation (owner asleep; decided by orchestrator per explicit instruction "take over me and decide everything yourself"). Owner reviews on wake.

**Goal:** When a declarative lab deploys via containerlab, its bind nodes become live Server entities in the Server tab — bound to the *real* deployed container (real ID, real IP, live state), not just the declared intent — and the operator can watch per-node telemetry (CPU/mem/net, container state, logs) stream from containerlab without leaving the app.

**Architecture:** Three cooperating additions, all riding the existing injected `Runner` seam (the same `bash -s` on the containerlab host that deploy already uses — no SSH, no new transport). (1) After a successful deploy, run `containerlab inspect --format json`, parse it, and merge the real runtime facts onto the lab's Server rows. (2) A telemetry module runs `containerlab inspect` + `docker stats` + `docker logs` on demand, exposed as a one-shot snapshot, an SSE stream, and a logs endpoint. (3) A `sync` endpoint re-runs inspect without deploying, so Server liveness tracks reality even when a lab is destroyed or crashes out of band. The frontend gets its first real Servers tab (read + live status) and a live telemetry panel.

**Tech stack:** Node 20 + Fastify + better-sqlite3 (backend), React 18 + Vite + TS (frontend). No new runtime dependency — SSE is raw Fastify reply writes; telemetry commands are plain `containerlab`/`docker` invocations through the existing `Runner`.

## Global constraints

Copied verbatim from the standing rules and the om lessons that govern this feature.

- Every name that becomes a filesystem path, a container name, or a shell argument is validated `^[A-Za-z0-9_-]+$` at the write boundary, and every filesystem/deploy/container path is derived server-side from the validated name. Never accept a path, directory, or container name from the request body. (om lesson: "shellQuote stops command injection but not path traversal — validate names, derive paths server-side.")
- Every containerlab/docker command runs through the injected `Runner`, never a direct `child_process` call in a route handler. This keeps every new unit testable with a fake runner and keeps production on the one audited `bash -s` spawner.
- Any test that asserts a reconcile/telemetry result must include a **must-fail control** — an input for which the correct answer is *not* the happy path (a bind node whose container is absent must resolve to `NODE_ABSENT`). (om lesson: "A check that cannot fail is worse than no check — prove the harness fails before trusting a pass.")
- Telemetry, logs, and sync endpoints are gated `view` on the lab's `configurationId`. Deploy stays `deploy`; lab/config edits stay `edit`. Observing a running lab is a read; it never changes desired config.
- No `Co-Authored-By: Claude` / "Generated with Claude Code" trailers on any commit or PR.
- Runtime Server fields live inside the Server JSON blob. The `Server` type is already `[key: string]: unknown` and stored as a `data` JSON column, so **no SQLite schema migration is required.**

## The gap this closes

The declarative-lab feature already turns each `intent: 'bind'` node into a Server row — but only from the *declared* topology, at lab-CRUD time, via `reconcileServers` in `labStore.ts`. That row carries the operator's *intent*: the declared `mgmtIpv4`, `syncState: 'PENDING'`, no container binding.

Deploy is a separate world. `deployEngine.deploy()` shells out `containerlab deploy … --reconfigure`, provisions data-plane addresses, reloads `named`, and returns per-server `{ ok, output }` — but it **never runs `containerlab inspect`, and never writes anything back to a Server row.** So after a real deploy the Server tab still shows the declared intent: `PENDING`, declared IP, no container ID, no liveness. The lab is running; the app doesn't know.

Two conventions must be bridged to close this. Reconcile keys Servers `srv-<labId>-<node.name>`. Containerlab names containers `clab-<topo.name>-<node.name>`. The join is: strip the `clab-<topo.name>-` prefix from an inspect entry's `name`, and match the remainder to a Server by node name within the lab.

There is also a latent bug to fix in passing: `labStore.ts:95` reads a misspelled `node.mgmtIvp4` before the real `node.mgmtIpv4`, so a declared management IP silently never reaches the Server row. The reconcile work touches this exact line.

## Part 1 — Deploy-time runtime reconcile

### What containerlab gives us

`containerlab inspect -t <labDir>/topo.clab.yml --format json` returns, per node (verified live against `bind9mgr-testlab` on clab-mini):

```json
{"<labName>":[
  {"name":"clab-<lab>-<node>","container_id":"72a05f2e501c","image":"dnsnode:1.0",
   "kind":"linux","state":"running","status":"Up 2 hours",
   "ipv4_address":"10.60.99.30/24","ipv6_address":"N/A","owner":"lun"}
]}
```

The topo file is written to `<labDir>/topo.clab.yml` by the deploy script and is guaranteed to exist immediately after a successful deploy, so inspecting by `-t <file>` is deterministic and needs no lab-name flag guesswork. `labDir` is already derived server-side as `/home/lun/<topo.name>` in the deploy route.

### Flow

1. `deployEngine.deploy()` runs the deploy script as today. On a non-dry-run, non-aborted run where the script exits 0, it makes **one additional `Runner` call**: `containerlab inspect -t <labDir>/topo.clab.yml --format json`. It parses the JSON into `RuntimeNode[]` and returns them on a new `DeployResult.runtime` field. Parse failure or a non-zero inspect is non-fatal: `runtime` is omitted and `runtimeError` carries the reason (deploy already succeeded; a failed inspect must not fail the deploy).
2. `deployJobs.startDeployJob()`, on `SUCCEEDED`, calls a new `reconcileServersRuntime(db, lab, result)`. This is the only new DB-writing function. For each `intent: 'bind'` node in `lab.topology`:
   - Find its inspect entry by stripping `clab-<topo.name>-` from each `RuntimeNode.name` and matching the node name.
   - Find its Server row `srv-<lab.id>-<node.name>` (created earlier by `reconcileServers`).
   - Merge runtime facts onto the Server JSON via `upsertServer`: `containerId`, `runtimeAddress` (inspect `ipv4_address` with `/NN` stripped), `runtimeState` (raw inspect `state`, e.g. `"running"`), `lastDeployedAt` (job timestamp), and a derived `syncState`.
3. **Derived `syncState` per bind node:**
   - Container present in inspect AND deploy `deployed[]` entry for it `ok: true` → `SYNCED`.
   - Container present but its deploy entry `ok: false` (e.g. `rndc reload` failed) → `ERROR`.
   - Bind node has **no** matching inspect entry (expected container absent) → `NODE_ABSENT`.
   - Inspect itself failed to run/parse → Servers left at their prior `syncState`, and the job carries `runtimeError` so the UI can show "liveness unknown".

`runtimeAddress` is stored **alongside**, not over, the declared `mgmtAddress`. Keeping both is what makes deploy-time drift visible: declared `10.60.99.21` vs runtime `10.60.99.30` is a fact the operator should see, not one we silently overwrite.

### Why this hook point

`deployEngine.deploy` owns the `Runner` and `labDir`, so it is the natural place to *gather* inspect JSON — but it takes no `db` and must stay a pure-ish function (model + topology + runner → result). `deployJobs.startDeployJob` owns the `db` and already runs at deploy completion, so it is the natural place to *write*. Splitting gather (engine) from write (jobs) keeps each unit single-purpose and independently testable with a fake runner.

## Part 2 — Telemetry streaming

Two live data sources, both through the `Runner`:

- **Liveness/state:** `containerlab inspect -t <labDir>/topo.clab.yml --format json` → per-node `state`, `status`, `ipv4_address`.
- **Resource usage:** `docker stats --no-stream --format '{{json .}}'` → per-container `CPUPerc`, `MemPerc`, `MemUsage`, `NetIO`, `BlockIO`, `PIDs` (verified live shape on clab-mini).

A `telemetry.ts` module composes these into a per-node snapshot, joining docker-stats rows to nodes by the same `clab-<topo.name>-<node.name>` container name. `docker stats` is filtered to just this lab's containers by passing the derived container names as explicit arguments, so one lab's telemetry never spawns a stats read over every container on the host.

### Endpoints (all gated `view` on the lab's `configurationId`)

- `GET /api/v1/labs/:id/telemetry` — one-shot snapshot: runs inspect + docker stats once, returns `{ nodes: TelemetryNode[], at, runtimeError? }`.
- `GET /api/v1/labs/:id/telemetry/stream` — Server-Sent Events. The handler writes SSE headers on the raw reply, then re-runs the snapshot on a server-side interval (default 2.5s) and writes `data: <json>\n\n` each tick. It clears the interval on `req.raw.on('close')`. No new dependency; `EventSource` on the client handles reconnect. **Ponytail ceiling:** one interval per open connection — fine for a single-operator lab tool; add a shared poll-and-fan-out broker only if concurrent viewers exceed a handful.
- `GET /api/v1/labs/:id/nodes/:node/logs?tail=N` — on-demand `docker logs --tail <N> clab-<topo.name>-<node>`. `:node` is charset-validated **and** confirmed to be an actual node in the lab's topology before the container name is derived server-side. `N` is clamped to a sane ceiling (e.g. 1000).

SSE, not WebSocket: the flow is one-way server→client, so SSE needs no new dependency and no bidirectional machinery, and browser `EventSource` reconnects on its own. This is the platform-native rung of the ladder.

### `TelemetryNode` shape

```ts
interface TelemetryNode {
  nodeName: string;        // bare node name
  containerName: string;   // clab-<topo>-<node>, derived
  containerId?: string;    // from inspect
  state?: string;          // inspect state: running | exited | ...
  status?: string;         // inspect status: "Up 2 hours"
  address?: string;        // inspect ipv4, /NN stripped
  cpuPerc?: string;        // docker stats, e.g. "0.42%"
  memPerc?: string;
  memUsage?: string;       // "26.86MiB / 48.1GiB"
  netIO?: string;
  blockIO?: string;
  pids?: string;
  present: boolean;        // false when the node's container is absent from inspect
}
```

`present: false` is a first-class state, not a null hole — it is how a destroyed/crashed node surfaces in the live view and how the frontend paints `NODE_ABSENT`.

## Part 3 — Lifecycle sync

A lab can leave the running state without the app deploying anything: the operator runs `containerlab destroy` by hand, a container crashes, the host reboots. `POST /api/v1/labs/:id/sync` re-runs the Part 1 inspect-and-reconcile **without deploying** — same `reconcileServersRuntime`, minus the deploy step. Bind nodes whose containers have vanished flip to `NODE_ABSENT`; nodes that came back flip to `SYNCED`. Returns the updated Server list for the lab. Gated `view` (it observes reality and refreshes observed status; it never changes desired config).

An explicit `containerlab destroy` route (`POST /labs/:id/destroy`) that tears the lab down and flips every lab Server to `NODE_ABSENT` is a natural sibling but is **out of scope for the foundation** — `sync` already covers "I destroyed it out of band, refresh the truth." Noted as the first follow-up.

## Part 4 — Frontend: the Servers tab and live telemetry

The Server tab is currently an unbuilt `<Placeholder>`; there is no frontend `Server` type and no `listServers` adapter call. This part builds the first real one, read-only, matching the `ZoneRecords` route pattern (DataTable + StatusPill + SidePanel + ToastProvider).

- **Backend read API (new, minimal):** `GET /api/v1/configurations/:configId/servers` (list) and `GET /api/v1/configurations/:configId/servers/:serverId` (detail), gated `view`, backed by the existing `listServers`/`getServer` store functions. The Server tab cannot be real without a servers read route; none exists today. Full server CRUD (create/edit/delete) stays backlog #35.
- **`Server` frontend type + adapter:** promote the fixture shape to a typed entity; add `listServers(configId)` and `getServer(id)` to `apiAdapter`, fixture-backed by default (offline mode stays green) and hitting the new routes in real mode.
- **Servers list route:** a DataTable of the config's servers — hostname, node, declared mgmt vs runtime address, and a live `StatusPill` driven by `syncState`. `StatusPill` already supports `synced`/`pending`/`deploying`/`drift`/`error`/`node_absent`/`unreachable`, so no new pill states are needed.
- **Telemetry panel (net-new component):** on a server's detail, open the lab's SSE stream and render each node's live `state`, `cpuPerc`, `memPerc`, `memUsage`, `netIO`, and a logs viewer (calls the logs endpoint on demand). Respect `prefers-reduced-motion` — a static live-updating number, no animation, is the reduced-motion form. **Ponytail:** live numbers + a StatusPill first; a sparkline/chart is an enhancement, not the foundation — no chart dependency in this slice.

## Data model changes

No SQLite migration. New Server JSON fields (all optional, additive): `containerId`, `runtimeAddress`, `runtimeState`, `lastDeployedAt`, and a `syncState` now driven by deploy/sync rather than always `PENDING`. New `DeployResult` fields: `runtime?: RuntimeNode[]`, `runtimeError?: string`. New `DeployJob` behavior: reconcile runtime on `SUCCEEDED`. No `deploy_jobs`/`servers` table column changes.

`RuntimeNode` (parsed from inspect):

```ts
interface RuntimeNode {
  name: string;          // clab-<lab>-<node>
  containerId: string;   // from container_id
  image?: string;
  state?: string;        // running | exited | ...
  status?: string;
  ipv4Address?: string;  // raw, with /NN
}
```

## API surface (new)

| Method + path | Gate | Purpose |
|---|---|---|
| `GET /api/v1/configurations/:configId/servers` | view | List servers in a config (Server tab) |
| `GET /api/v1/configurations/:configId/servers/:serverId` | view | Server detail |
| `GET /api/v1/labs/:id/telemetry` | view | One-shot per-node telemetry snapshot |
| `GET /api/v1/labs/:id/telemetry/stream` | view | SSE live telemetry stream |
| `GET /api/v1/labs/:id/nodes/:node/logs?tail=N` | view | On-demand `docker logs` for one node |
| `POST /api/v1/labs/:id/sync` | view | Re-inspect and reconcile Server liveness without deploying |

Deploy (`POST /labs/:id/deploy`) and deploy-job read (`GET /deploy-jobs/:id`) are unchanged in signature; deploy now additionally reconciles runtime on success.

## Security

- **Command construction:** container names and file paths are derived server-side from the validated `topo.name` and node names. The logs endpoint validates `:node` against the charset *and* against the lab's actual node list before deriving `clab-<topo>-<node>`. Request bodies never supply a path, directory, or container name.
- **Runner-only:** every `containerlab`/`docker` call goes through the injected `Runner`, so production runs on the one audited `bash -s` spawner and tests run on a fake.
- **Authorization:** all observe endpoints gated `view` on the lab's `configurationId`; the SSE handler authorizes once at connect and closes the stream on disconnect. API keys inherit the existing `authorize` scope mapping (`view`→read), so a read-only key can observe but not deploy or edit.
- **No secret exposure:** telemetry and logs surface container state and resource counters, not credentials. `docker logs` output is returned as-is to a `view`-authorized caller — the same trust boundary as the deploy output they already see.

## Testing strategy

Every new unit ships with a test using a **fake `Runner`** returning canned inspect/stats/logs strings — the same dependency-injection pattern the existing `deployEngine`/`deployJobs` tests use.

- **`reconcileServersRuntime`** — the security/deploy-critical unit, gets the full three-agent QA loop (build → adversarial test + review → orchestrator commits). Tests:
  - Happy path: a bind node whose container is `running` and whose deploy entry is `ok` → Server `syncState: 'SYNCED'`, `containerId` and `runtimeAddress` populated from inspect.
  - **Must-fail control:** a bind node present in the topology whose container is **absent** from the inspect JSON → Server `syncState: 'NODE_ABSENT'`. This proves the reconcile can produce a non-happy verdict; without it, a reconcile that blindly marks everything `SYNCED` would pass.
  - Deploy-failed node: container present but deploy entry `ok: false` → `ERROR`.
  - Inspect-failed: `runtime` absent + `runtimeError` set → Servers keep prior `syncState`, no false `SYNCED`.
  - ID-join correctness: an inspect entry `clab-<topo>-<node>` maps to Server `srv-<labId>-<node>`; a `router`/`bridge` inspect entry with no bind Server is ignored.
  - The `mgmtIvp4` typo fix: a declared `mgmtIpv4` reaches the Server `mgmtAddress`.
- **`telemetry.ts` snapshot** — joins inspect + docker stats by container name; a node absent from inspect yields `present: false`; a stats row for a non-lab container is ignored.
- **Telemetry/logs/sync routes** — `view` gate returns 403 without permission; logs endpoint rejects a `:node` not in the topology and a `:node` failing the charset; SSE writes at least one `data:` frame then cleans up its interval on close.
- **Frontend** — Servers list renders rows with the right `StatusPill` state per `syncState`; the telemetry panel renders a live frame from a mocked stream; offline fixture mode keeps the full app suite green.

## Out of scope (follow-ups, noted not built)

- `POST /labs/:id/destroy` (containerlab teardown + flip Servers to `NODE_ABSENT`).
- Server create/edit/delete CRUD in the GUI (backlog #35).
- Historical telemetry / charts / sparklines (foundation ships live numbers only).
- A shared telemetry poll-broker for many concurrent viewers (per-connection interval until measured need).
- BIND statistics-channels scraping (`services.dns.statisticsChannels`, e.g. 127.0.0.1:8053) as a second telemetry source — richer DNS-level metrics, but containerlab/docker telemetry is the "easier to work with" source the owner pointed at, so it lands first.

## Build order

1. **Backend — deploy-time runtime reconcile** (Part 1): `RuntimeNode` + inspect-gather in `deployEngine.deploy` → `DeployResult.runtime`; `reconcileServersRuntime` + wire into `deployJobs`; fix the `mgmtIvp4` typo. Three-agent QA (must-fail NODE_ABSENT control mandatory).
2. **Backend — servers read API** (Part 4a): `GET …/servers` + `…/servers/:serverId`.
3. **Backend — telemetry** (Part 2 + Part 3): `telemetry.ts` snapshot; telemetry/stream/logs/sync routes. Three-agent QA (shells out through the Runner).
4. **Frontend — Servers tab** (Part 4b): `Server` type + adapter + Servers list route + real nav entry (replace the Placeholder).
5. **Frontend — telemetry panel** (Part 4c): SSE-driven live per-node view + logs viewer.

Each slice ends green (`vitest run && npm run typecheck && npm run build` for the package touched) and is committed independently. Slices 1–2 make the owner's literal ask true — deploy a lab, its bind nodes appear in the Server tab bound to the real containers. Slices 3–5 deliver the telemetry the owner asked for and the tab to view it in.
