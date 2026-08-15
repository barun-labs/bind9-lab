# Backend slice 4 — deploy engine (containerlab + push config + reload)

**Goal:** turn a validated object model + topology into a real deployment: validate-before-deploy
gate → write clab.yml + per-node configs → `containerlab deploy` → push configs → `rndc reload` →
per-server result. Host interaction is confined to ONE injected runner so it is unit-testable and so
the orchestrator (not a worker) drives the single real deploy against a THROWAWAY lab name that never
touches the running `anycast-dns` (`dns`) lab.

**Loop: FULL three-agent** (deploy is the riskiest surface).

## Unit A — deploy engine (logic, mock-runner tests)
Files: `backend/src/server/deployEngine.ts`, `backend/test/deployEngine.test.ts`.
- `type Runner = (bashScript: string) => Promise<{code:number,stdout:string,stderr:string}>`.
- `interface DeployResult { validated: {serverId:string, ok:boolean, errors:string[]}[]; plan?: string[];
   aborted?: string; deployed?: {serverId:string, ok:boolean, output:string}[] }`.
- `async function deploy(model, topology, opts: { run: Runner; labDir: string; dryRun?: boolean }): Promise<DeployResult>`:
  1. Pre-flight: for each server, `generateServerConfig` (slice 1) → `validateConfig` (slice 1, via the
     SAME run). Collect `validated`. If ANY `!ok` → return `{validated, aborted:'pre-flight failed'}`
     and DO NOT deploy.
  2. If `dryRun` → return `{validated, plan}` where plan is the ordered list of shell steps that WOULD
     run (write files, `containerlab deploy -t ...`, `docker exec ... rndc reload`). No deploy executed.
  3. Else build ONE script (executed via `run`) that: mkdir labDir; write the clab.yml
     (`generateClabTopology`) and every server's config files; `containerlab deploy -t <labDir>/topo.clab.yml
     --reconfigure`; then per BIND server `docker exec <lab>-<node> rndc reload` (or start named);
     capture per-node output. Return `{validated, deployed}`.
- Tests with a MOCK run that records calls:
  - a model whose config is invalid (e.g. CNAME at apex) → `aborted` set, and the mock run is NEVER
    called with a `containerlab deploy` command (the gate holds).
  - dryRun on a valid model → `validated` all ok, `plan` lists deploy + reload, no deploy call.
  - the built deploy script references the throwaway lab name from `topology.name`, never `dns`.

## Real end-to-end (orchestrator only, NOT a worker)
After Unit A passes QA, the orchestrator runs ONE real deploy on clab-mini: a throwaway 2-node topology
(distinct lab name, e.g. `bind9mgr-demo`), push a generated zone, `rndc reload`, `dig` to verify
resolution, then `containerlab destroy` to tear it down. The running `anycast-dns` lab is read-only
throughout. This doubles as slice 5 (verify).
