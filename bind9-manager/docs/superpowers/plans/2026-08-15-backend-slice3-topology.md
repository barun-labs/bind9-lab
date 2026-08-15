# Backend slice 3 — topology → clab.yml

**Goal:** a pure generator that turns a TopologyModel (nodes + links + mgmt) into a valid containerlab
`*.clab.yml`, so the UI can design a topology and produce a deployable file. Reference:
`anycast-dns/dns.clab.yml`. Lighter loop (agy build + deepseek-pro test + orchestrator review) — not
security-critical.

## Unit A — generator + anycast fixture + golden test
Files: `backend/src/config-engine/topology.ts`, `backend/src/fixtures/anycastTopology.ts`,
`backend/test/topology.test.ts`. Dep: `js-yaml` (+ `@types/js-yaml`).

Types (export): `NodeSpec { name; kind:'linux'|'bridge'; image?; mgmtIpv4?; binds?: string[] }`,
`LinkSpec { endpoints:[string,string] }`, `TopologyModel { name; mgmtNetwork?; mgmtSubnet?;
nodes: NodeSpec[]; links: LinkSpec[] }`.

`generateClabTopology(topo): string` — emit YAML via `js-yaml.dump` matching containerlab:
`name`, `mgmt:{network, ipv4-subnet}`, `topology:{ nodes:{<name>:{kind,image?,mgmt-ipv4?,binds?}},
links:[{endpoints:[a,b]}] }`. Bridge nodes emit `kind: bridge` with no image.

`anycastTopology: TopologyModel` — faithful to `anycast-dns/dns.clab.yml` (all nodes incl. the
host bridges, all links, mgmt 10.233.4.0/24, image dnsnode:1.0, binds per node).

Golden/structural test: `generateClabTopology(anycastTopology)` → parse back with js-yaml →
- every node present with the right kind; every linux node has `image`; bridges have none.
- every link endpoint references a defined node; endpoint count matches the fixture.
- mgmt subnet + network correct.
- a NEGATIVE control: a TopologyModel with a link to an undefined node → a `validateTopology(topo)`
  helper returns an error (add `validateTopology(topo): string[]` returning problems; empty = ok).

Verify: `cd bind9-manager/backend && npx vitest run test/topology.test.ts && npm run typecheck && npm run build && npx vitest run`.
