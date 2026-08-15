# Backend slice 1 — config engine + validator: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A pure TS config engine that turns Bind9-Manager's object model into per-server `named.conf` + zone files, and validates them with real BIND tools in a `dnsnode:1.0` container.

**Architecture:** `bind9-manager/shared/` holds the entity types + the proven `zonefile.ts`. `bind9-manager/backend/config-engine/` generates config from a model and validates it. Everything is pure except `validate.ts`, which runs `named-checkconf`/`named-checkzone` inside a throwaway container via an injectable command runner (local `docker` in production on clab-mini; `ssh clab-mini docker` for tests run from a laptop). The `anycast-dns` lab's committed configs are the golden oracle.

**Tech Stack:** Node 20+, TypeScript strict, Vitest. No web framework, no DB in this slice.

**Spec:** `bind9-manager/docs/superpowers/specs/2026-08-15-backend-slice1-config-engine.md`

## Global Constraints

- All new code under `bind9-manager/shared/` and `bind9-manager/backend/`. Do NOT edit `bind9-manager/app/` or `bind9-manager/design/` (design is READ-ONLY).
- Reuse the proven rdata formatting — copy `app/src/lib/zonefile.ts` into `shared/zonefile.ts` verbatim (with its test); do not re-derive it.
- Target BIND 9.18 syntax; modern keywords (`type primary/secondary/forward/hint`) — BIND accepts these. Reference known-good output: `anycast-dns/configs/bc-cache1/named.conf` (forward-only cache view) and `anycast-dns/configs/bc-rmaster/named.conf` (recursive + authoritative views, master zones with also-notify).
- `validate.ts` shells to docker via an injected runner; its tests and `golden.test.ts` require clab-mini + docker + the `dnsnode:1.0` image. Pure tests (render/generate/resolve) run anywhere.
- TypeScript strict; each task's gate = own tests green + `tsc --noEmit` clean + `npm run build`. 
- Commits authored by the repo user (`barun-labs`); NO `Co-Authored-By`, NO "Generated with".
- Delegated down the ladder — agy flash 3.7 → deepseek → Sonnet. Orchestrator reviews every diff.

---

## Task 1: scaffold shared/ and backend/

**Files:**
- Create `bind9-manager/shared/{package.json,tsconfig.json}`, copy `bind9-manager/app/src/types/entities.ts` → `shared/entities.ts`, copy `bind9-manager/app/src/lib/zonefile.ts` → `shared/zonefile.ts` and `zonefile.test.ts` → `shared/zonefile.test.ts`.
- Create `bind9-manager/backend/{package.json,tsconfig.json,vitest.config.ts}` and `backend/src/config-engine/index.ts` (empty stub exporting nothing yet).

**Interfaces:** Produces the two packages. `shared` exports everything `entities.ts` and `zonefile.ts` export. `backend` depends on `shared` via a relative path import (`../../shared/…` or a path alias in tsconfig).

- [ ] **Step 1:** `cd bind9-manager && mkdir -p shared backend/src/config-engine backend/test`. In `shared/`, `npm init -y`, add TS + vitest devDeps, copy the three files. In `backend/`, `npm init -y`, add TS + vitest, a `"build": "tsc -b"`, `"typecheck": "tsc --noEmit"`, `"test": "vitest run"`.
- [ ] **Step 2:** Verify the copied `shared/zonefile.test.ts` passes: `cd bind9-manager/shared && npx vitest run`. Expected: green (same 8 tests as the app).
- [ ] **Step 3:** `cd bind9-manager/backend && npm run build` — succeeds (empty stub).
- [ ] **Step 4: Commit** — `git add bind9-manager/shared bind9-manager/backend && git commit -m "chore: scaffold shared + backend packages for the config engine"`

---

## Task 2: renderZoneFile

**Files:** Create `backend/src/config-engine/renderZoneFile.ts`, `backend/test/renderZoneFile.test.ts`.

**Interfaces:** `renderZoneFile(zone: Zone, records: ResourceRecord[]): string` — full zone file: `$TTL <soa.minimum>`, `$ORIGIN <zone.name>.`, the SOA record, then each non-disabled record via `zoneFileLine` from `shared/zonefile`. Import `Zone`, `ResourceRecord` from `shared/entities`.

- [ ] **Step 1: Failing test**

```ts
import { renderZoneFile } from '../src/config-engine/renderZoneFile';
const zone:any = { name:'lab.test', soa:{ primaryNs:'ns1.lab.test.', adminEmail:'hostmaster.lab.test.', serial:2026081401, refresh:3600, retry:900, expire:604800, minimum:300 } };
const recs:any = [
  { name:'@', type:'NS', ttl:3600, rdata:{ target:'ns1.lab.test.' }, disabled:false },
  { name:'www', type:'A', ttl:300, rdata:{ address:'10.10.10.10' }, disabled:false },
  { name:'old', type:'A', ttl:300, rdata:{ address:'10.0.0.9' }, disabled:true },
];
test('emits headers, SOA, and non-disabled records', () => {
  const out = renderZoneFile(zone, recs);
  expect(out).toMatch(/\$ORIGIN lab\.test\./);
  expect(out).toMatch(/\$TTL 300/);
  expect(out).toMatch(/IN\s+SOA\s+ns1\.lab\.test\./);
  expect(out).toMatch(/2026081401/);            // serial
  expect(out).toContain('www');                 // A record present
  expect(out).not.toContain('old');             // disabled omitted
});
```

- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement.** SOA line: `@ IN SOA <primaryNs> <adminEmail> ( serial refresh retry expire minimum )`. Then each record via `zoneFileLine(name, ttl, type, rdata)`.
- [ ] **Step 4: Run — pass.** Then `npm run typecheck`.
- [ ] **Step 5: Commit** — `git commit -m "feat: renderZoneFile — SOA + records via shared zonefile"`

---

## Task 3: resolve.ts (roles + option inheritance)

**Files:** Create `backend/src/config-engine/resolve.ts`, `backend/test/resolve.test.ts`.

**Interfaces:**
- `resolveOption(model, {serverId, viewId?, zoneId?}, key): value | undefined` — walk scope precedence zone → view → server → server-group → config; nearest set wins.
- `zonesForServer(model, serverId): { zone: Zone, role: ServerRole, view: View }[]` — join the DeploymentRole matrix to the server's views/zones.
- `model` is a `ConfigModel` type you define in `backend/src/config-engine/model.ts`: `{ configuration, views, zones, records, servers, roles, options, externalHosts, acls? }` (arrays of the entity types from `shared/entities`).

- [ ] **Step 1: Failing tests**

```ts
import { resolveOption, zonesForServer } from '../src/config-engine/resolve';
// a model where recursion is set at config scope true, overridden at a view scope false
// assert resolveOption returns the view value when viewId given, config value otherwise
// a roles matrix: server S is PRIMARY for zone Z -> zonesForServer(model,'S') includes {zone:Z, role:'PRIMARY'}
```
Write concrete fixtures inline; assert nearest-scope-wins and the roles join.

- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement** the scope walk and the roles→zones join.
- [ ] **Step 4: Run — pass; typecheck.**
- [ ] **Step 5: Commit** — `git commit -m "feat: option inheritance + roles-to-zones resolution"`

---

## Task 4: generateNamedConf

**Files:** Create `backend/src/config-engine/generateNamedConf.ts`, `backend/test/generateNamedConf.test.ts`.

**Interfaces:** `generateNamedConf(model: ConfigModel, serverId: string): string` — emits, matching the known-good structure in `anycast-dns/configs/*/named.conf`:
- `options { directory "/var/bind"; listen-on { any; }; listen-on-v6 { none; }; dnssec-validation <resolved>; ... }`
- `logging { ... }` (the default_log channel block, copy the reference)
- `include "/etc/bind/rndc.key"; controls { inet 127.0.0.1 allow { localhost; } keys { "rndc-key"; }; };`
- one `view "<name>" { match-clients { ... }; allow-*; recursion <resolved>; forwarders { ... }; forward <policy>; <zones> }` per view in `order`, with each zone stanza by role: PRIMARY→`type primary; file "/etc/bind/zones/db.<zone>"; allow-transfer {…}; also-notify {…};`, SECONDARY→`type secondary; primaries {…};`, FORWARDER→`type forward; forwarders {…}; forward only;`, hint→`type hint; file "/etc/bind/db.root";`.

- [ ] **Step 1: Failing tests** — build a small model with a forward-only cache view and assert the output contains `forward only;`, the `forwarders { … }` list, and `match-clients`; build a model with a PRIMARY zone and assert `type primary;` + the `file` path. Reference exact shape from `anycast-dns/configs/bc-cache1/named.conf` and `bc-rmaster/named.conf`.
- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement** using `resolveOption`/`zonesForServer` from Task 3.
- [ ] **Step 4: Run — pass; typecheck.**
- [ ] **Step 5: Commit** — `git commit -m "feat: generateNamedConf — options, views, zones from the model"`

---

## Task 5: generateServerConfig + validate (docker dnsnode)

**Files:** Modify `backend/src/config-engine/index.ts`; create `backend/src/config-engine/validate.ts`, `backend/test/validate.test.ts`.

**Interfaces:**
- `generateServerConfig(model, serverId): Record<string,string>` — `{ 'named.conf': generateNamedConf(...), 'zones/db.<zone>': renderZoneFile(...) , ... }` for each PRIMARY zone on that server.
- `validateConfig(files: Record<string,string>, run?: (argv: string[]) => Promise<{code:number,stdout:string,stderr:string}>): Promise<{ ok: boolean; warnings: string[]; errors: string[] }>` — writes `files` to a temp dir, then via `run` executes `docker run --rm -v <tmp>:/etc/bind dnsnode:1.0 named-checkconf -z /etc/bind/named.conf` and a `named-checkzone` per zone; parses output into warnings/errors. `run` defaults to spawning `docker` locally; tests pass a runner that prefixes `ssh clab-mini` so validation happens on the host with the image.

- [ ] **Step 1: Failing test** (requires clab-mini) — generate a valid tiny config, `validateConfig(files, sshDockerRunner)` → `ok:true`, no errors. The runner: `(argv)=>spawn('ssh',['clab-mini',...argv])` but note the temp dir must exist ON clab-mini — so for the test, write files to a temp path under `clab-mini:/tmp/...` via the runner, or run the whole docker command over ssh with the tmp created on clab-mini. Implement `validate.ts` so the file-writing and docker run both go through `run` (i.e. `run` executes a small shell snippet that mkdtemps, writes files, runs checkconf) — keep the host boundary in one place.
- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement.** Keep all host interaction inside `run`; parse `named-checkconf` exit code + stderr (BIND prints errors to stderr, `OK`/zone-loaded to stdout).
- [ ] **Step 4: Run — pass** against clab-mini; typecheck.
- [ ] **Step 5: Commit** — `git commit -m "feat: generateServerConfig + validateConfig via dnsnode container"`

---

## Task 6: anycast golden test + negative controls

**Files:** Create `backend/src/fixtures/anycastModel.ts`, `backend/test/golden.test.ts`.

**Interfaces:** `anycastModel: ConfigModel` — the `anycast-dns` lab as an object model: its servers (bc-cache1/2, bc-rmaster, bc-rslave1/2, ex-dns, root, cmp-auth), views (cache/recursive/authoritative), zones (`lab.test`, `sub.lab.test`, reverse, `.` hint/root), records, the roles matrix, and the options that reproduce the committed configs.

- [ ] **Step 1:** Build `anycastModel` by reading `anycast-dns/configs/*/named.conf` and `anycast-dns/dns-deploy.sh` and expressing the same intent as objects. Keep it faithful to the known-good lab.
- [ ] **Step 2: Golden test** (requires clab-mini):

```ts
// for each server in anycastModel.servers:
//   const files = generateServerConfig(anycastModel, server.id)
//   const res = await validateConfig(files, sshDockerRunner)
//   expect(res.ok).toBe(true); expect(res.errors).toEqual([])
```

- [ ] **Step 3: Negative controls** — a model variant with a CNAME at apex, and one with a malformed forwarder, each `validateConfig` → `ok:false` with a matching error string. A validator that cannot fail proves nothing.
- [ ] **Step 4: Run — all pass; typecheck.**
- [ ] **Step 5: Commit** — `git commit -m "feat: anycast golden model + validation tests with negative controls"`

---

## Task 7: slice-1 gate

- [ ] **Step 1:** `cd bind9-manager/backend && npm run typecheck && npm run test && npm run build` — all clean/green/successful (validate/golden tests run against clab-mini). Also `cd bind9-manager/shared && npx vitest run`.
- [ ] **Step 2: Commit** any residue; report the slice done.

## Self-review notes

- **Spec coverage:** renderZoneFile (T2), generateNamedConf + roles + options (T3/T4), generateServerConfig + validateConfig (T5), golden + negatives (T6), scaffold/shared reuse (T1), gate (T7). Every spec function maps to a task.
- **Host boundary:** all docker/ssh interaction is confined to `validate.ts`'s injected `run`; pure tasks (T2–T4) need no infra; T5/T6 need clab-mini.
- **Type consistency:** `ConfigModel`, `generateServerConfig`, `validateConfig`, `resolveOption`, `zonesForServer`, `renderZoneFile`, `generateNamedConf` defined and consumed consistently across tasks.
