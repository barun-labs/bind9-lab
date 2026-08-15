# Bind9-Manager backend, slice 1 — config engine + validator

The backend turns Bind9-Manager's object model into real BIND9 configuration and validates
it before anything is deployed. This slice is the first of five (config engine → API +
persistence + auth → topology → clab designer → deploy engine → verify). It builds only the
**pure config engine and validator**: object model in, `named.conf` + zone files out,
validated with the real BIND tools. No database, no HTTP server, no containerlab, no live
nodes — those are later slices.

The reference implementation already exists in this repo: `anycast-dns/` is a working,
verified containerlab BIND9 lab whose `configs/*/named.conf` and zone files are known-good.
The engine's job is to *generate* configuration equivalent to those, from the object model
instead of hand-written heredocs. The known-good configs are the golden-test oracle.

## Decisions (locked)

- **Node + TypeScript.** Shares the entity types with the React app.
- **Runs on clab-mini** (has docker + containerlab + the `dnsnode:1.0` image).
- **Datastore: SQLite with JSON columns** — decided for the project, but *not used in this
  slice* (the engine is pure). Locked concretely in slice 2's spec.
- **First slice: this one.**

## Layout

```
bind9-manager/
  shared/                      # imported by backend now; app unified into it later
    package.json  tsconfig.json
    entities.ts                # the entity types (copied from app/src/types; app unifies later)
    zonefile.ts                # rdata -> zone-file line (promoted from app/src/lib, the tested version)
    zonefile.test.ts
  backend/
    package.json  tsconfig.json  vitest.config.ts
    src/
      config-engine/
        renderZoneFile.ts      # zone -> full zone file text (SOA + records)
        generateNamedConf.ts   # server + model -> named.conf text
        resolve.ts             # roles matrix + option inheritance -> per-server view of the model
        validate.ts            # run named-checkconf/-checkzone in a dnsnode container
        index.ts               # generateServerConfig(model, serverId) -> { files } ; validateConfig(files)
      fixtures/anycastModel.ts  # the anycast-dns lab expressed as an object model (golden oracle input)
    test/
      renderZoneFile.test.ts  generateNamedConf.test.ts  resolve.test.ts
      validate.test.ts  golden.test.ts
```

`shared/` gets its own copy of `zonefile.ts`/`entities.ts` for now (the app keeps its copy so
it stays green). Unifying the app onto `shared/` is a small follow-up task in a later slice —
not this one. The duplication is flagged so it does not rot.

## What the engine does

**`generateServerConfig(model, serverId) → { [path: string]: string }`** — returns the file
map a single server should run: `named.conf` plus one `zones/db.<zone>` per zone the server is
authoritative for. Deterministic text, no I/O.

- **Roles drive zone stanzas.** The `DeploymentRole` matrix (server × zone → PRIMARY /
  SECONDARY / FORWARDER / STUB / RECURSIVE) decides what each zone stanza looks like on this
  server: PRIMARY → `type primary; file "…";`, SECONDARY → `type secondary; primaries { … };`,
  FORWARDER → `type forward; forwarders { … }; forward only;`, etc.
- **Options inheritance resolves to concrete values.** A `DeploymentOption` at
  config/server-group/server/view/zone scope resolves down the chain (nearest scope wins) into
  the emitted `options{}` / `view{}` / `zone{}` blocks: `recursion`, `allow-query`,
  `allow-recursion`, `allow-transfer`, `forwarders`, `forward` policy, `dnssec-validation`,
  etc. `resolve.ts` computes the effective value per (server, scope, key).
- **Views and ACLs.** A server's views emit in `order` with `match-clients { … }` from the
  view's ACLs; zones nest under their view. First-match-wins ordering is preserved.
- **Zone files** come from `renderZoneFile(zone, records)` — SOA record, `$TTL`, `$ORIGIN`,
  then each record via the shared `zonefile.ts` `zoneFileLine`. Disabled records are omitted.

**`validateConfig(files) → { checkconf: Result, checkzone: Result[] }`** — writes the file map
to a temp dir and runs, **inside a throwaway `dnsnode:1.0` container**
(`docker run --rm -v <tmp>:/etc/bind dnsnode:1.0 named-checkconf -z /etc/bind/named.conf`, and
`named-checkzone <zone> <file>` per zone), returning structured `{ ok, warnings[], errors[] }`
with the real BIND messages. Reusing the lab's own image means the validator runs the exact
BIND version (9.18) the lab deploys. This is the "validate before deploy" gate slices 4–5 call.

## Correctness: the golden test

`fixtures/anycastModel.ts` expresses the `anycast-dns` lab as an object model (the servers,
views, zones, records, roles, options that produce its known-good configs). `golden.test.ts`:

1. For every server, `generateServerConfig` → `validateConfig` → **`named-checkconf` passes**
   with no errors. This is the primary proof: generated config is valid BIND.
2. Semantic equivalence: the generated `named.conf` parses to the same effective policy as the
   committed `anycast-dns/configs/<node>/named.conf` (compare resolved directives — forwarders,
   view match-clients, zone types — not byte-for-byte, since whitespace/ordering differ).

Negative controls (mandatory — a validator that cannot fail proves nothing): a model with a
CNAME at the zone apex, and one with a syntactically bad forwarder, must each make
`validateConfig` return `ok:false` with the corresponding BIND error.

## Out of scope for slice 1

The SQLite store, the Fastify HTTP server, auth enforcement, containerlab topology generation,
`containerlab deploy`, pushing configs to live nodes, `rndc reload`, and post-deploy `dig`
verification. Each is a later slice with its own spec.

## Constraints

- Pure functions except `validate.ts` (which shells to docker). No network, no DB.
- `validate.ts` and its tests require clab-mini with docker and the `dnsnode:1.0` image; they
  are the one part not runnable on a bare laptop.
- TypeScript strict; `tsc --noEmit` clean; `vitest run` green; a `build` script must pass.
- Reuse the proven `zonefile.ts` logic — do not re-derive rdata formatting.
- Implementation delegated down the ladder (agy flash 3.7 → deepseek → Sonnet); orchestrator
  reviews every diff. Every task's gate includes `build`, not just typecheck.
