# Network Blocks / Reverse-Zone IPAM — Design (Plane #57)

**Goal:** Give Bind9-Manager a hierarchy of IP network blocks, and make reverse DNS
(`in-addr.arpa`) maintain itself: when a forward A/AAAA record is written for an address
inside a managed network, the matching PTR record appears, updates, and disappears
automatically, deploying through the same approve-then-apply pipeline as every other change.

Scope is deliberately narrow: reverse-DNS automation, not address inventory. There is no
per-IP tracking, utilization percentage, next-free-address lookup, or host assignment. IPv6
(`ip6.arpa`) is a later slice; this one is IPv4 only.

## Why this shape

Reverse zones are already ordinary primary zones — the anycast fixture ships a hand-built
`0.20.10.in-addr.arpa` zone full of PTR records, and `renderZoneFile` renders them with no
special casing. PTR records already ride the change-set / deploy-jobs pipeline as ordinary
`RECORD` objects. So the new surface is small: a block metadata layer, a bit of IPv4 math,
and a sync step that turns forward-record writes into PTR writes. The blocks themselves never
render into `named.conf`; only the reverse zones and PTRs they cause do, and those reuse
existing machinery.

## Data model

A single `Block` entity carries the hierarchy.

```ts
// shared/entities.ts
export type BlockKind = 'BLOCK' | 'NETWORK';
export interface Block {
  id: string;                 // 'blk-' + hex, server-generated
  configurationId: string;
  name: string;
  cidr: string;               // IPv4 CIDR, e.g. '10.20.1.0/24'
  parentBlockId: string | null;
  kind: BlockKind;
  viewId?: string;            // NETWORK only: the view its reverse zones live in
}
```

A **BLOCK** is an organizational container (`10.0.0.0/8`). A **NETWORK** is a leaf subnet
(`10.20.1.0/24`) and is the only kind that drives reverse DNS. A NETWORK carries `viewId`
because a reverse zone, like any zone, belongs to a view, and the forward record's own view
does not decide where reverse DNS lives — the network does.

Storage mirrors every other entity: table `blocks (id TEXT PRIMARY KEY, configurationId TEXT
NOT NULL, data TEXT NOT NULL, FOREIGN KEY (configurationId) REFERENCES configurations(id) ON
DELETE CASCADE)` plus `idx_blocks_configId`. Blocks are planning metadata like labs — they do
**not** enter the change-set.

A second table links each managed forward record to the PTR it generated, so updates and
deletes act on exactly the right record:

```sql
CREATE TABLE reverse_ptr_links (
  configurationId TEXT NOT NULL,
  forwardRecordId TEXT PRIMARY KEY,   -- the A/AAAA record id
  ptrRecordId     TEXT NOT NULL,      -- the generated PTR record id
  ptrZoneId       TEXT NOT NULL,      -- the /24 reverse zone the PTR lives in
  FOREIGN KEY (configurationId) REFERENCES configurations(id) ON DELETE CASCADE
);
```

The link is 1:1 with the forward record: each managed A/AAAA has exactly one generated PTR.
Two forward names on one address produce two PTRs (BIND permits this), each with its own link.

## IPv4 helper (`backend/src/server/ipv4.ts`)

A small dependency-free module doing integer math on 32-bit addresses. Contract:

- `parseCidr(cidr): { network: number; prefix: number } | null` — null on malformed input.
- `cidrContainsCidr(parent, child): boolean` — child's range is a subset of parent's.
- `cidrsOverlap(a, b): boolean` — the two ranges intersect.
- `cidrContainsIp(cidr, ip): boolean`.
- `reversePtrName(ip): string` — `192.0.2.1` → `1.2.0.192.in-addr.arpa`.
- `ptrZoneName(ip): string` — `192.0.2.1` → `2.0.192.in-addr.arpa` (the containing /24 zone).

Reverse names are always /24-granular: for `a.b.c.d`, the PTR name is `d.c.b.a.in-addr.arpa`
and its zone is `c.b.a.in-addr.arpa`, regardless of the network's own prefix.

## Reverse zones — lazy and /24-granular

Defining a network does not create reverse zones. A /16 network would otherwise spawn 256
empty `in-addr.arpa` zones. Instead, a /24 reverse zone is materialized the first time a PTR
needs to land in it: sync computes `ptrZoneName(address)`, looks for that zone in the
network's `viewId`, and creates it (a normal PRIMARY zone with a default SOA) only if absent.
Zone creation is bounded by real usage.

A materialized reverse zone is an ordinary `Zone`, so it renders through `renderZoneFile` and
deploys through the existing change-set pipeline. Its creation is recorded as a `ZONE` change
so it deploys atomically with the PTRs it holds.

## Auto-sync on forward-record write

The sync runs at the **record route layer** (POST/PATCH/DELETE record), where change-set
recording already happens — not inside the `createRecord` store function, which fixtures and
`cloneConfiguration` reuse and must not trigger cascades. A `reverseSync` service exposes one
entry point invoked after a forward-record mutation is applied:

`reconcileReverseForRecord(db, record, action)` where action is `CREATE | UPDATE | DELETE`.

Behavior:

1. Only A and AAAA records are considered. (AAAA is recognized but, until the IPv6 slice, an
   AAAA address matches no IPv4 network and is a no-op — see out-of-scope.)
2. Find the NETWORK in the same configuration whose CIDR contains the address. None → do
   nothing (addresses outside every managed network are the user's to manage by hand).
3. On CREATE: materialize the /24 reverse zone in the network's `viewId` if needed, create a
   PTR (`name = reversePtrName(address)`, `rdata = { type: 'PTR', target: <forward FQDN> }`),
   and write a `reverse_ptr_links` row.
4. On UPDATE: if the address is unchanged and a link exists, update the existing PTR's target
   in place. Otherwise treat it as remove-then-add: delete any linked PTR (its now-possibly-empty
   old zone is left in place — see limitations) and drop the link, then run the CREATE logic for
   the current address. The CREATE logic no-ops when the new address falls outside every network,
   which is exactly how an address moving out of managed range loses its PTR.
5. On DELETE: look up the link, delete the PTR record, drop the link row.

Every PTR and reverse-zone mutation is recorded in the change-set exactly as a hand-made
record/zone change would be, so reverse DNS deploys through approve-then-apply and is never
pushed silently.

## API

Under `/api/v1/configurations/:configId/blocks`, all `edit`-gated, mirroring the existing
entity-CRUD envelope (`{error:{code,message}}`, server-generated ids, 201/200):

- `GET` list, `GET /:blockId` (404 on scope mismatch).
- `POST` create — validate `cidr` (IPv4 + prefix 0–32 → 422 `INVALID_CIDR`); validate the
  hierarchy (below → 422 `INVALID_HIERARCHY`); a NETWORK requires a `viewId` that exists in
  the configuration (422 `INVALID_VIEW`).
- `PATCH /:blockId` — re-validate on any changed field; changing a CIDR re-checks containment.
- `DELETE /:blockId` — refuse if the block has children (422 `HAS_CHILDREN`); deleting a
  NETWORK leaves already-generated reverse zones and PTRs in place (they are real DNS data).
- `POST /:blockId/reconcile` — backfill. Auto-sync only fires on future forward writes, so
  reconcile walks existing A/AAAA records whose address falls in this NETWORK and generates
  any missing PTRs (idempotent: skips addresses already linked). `edit`-gated.

Hierarchy validation on create/patch: child CIDR strictly inside `parentBlockId`'s CIDR; no
overlap with sibling blocks under the same parent; a NETWORK may not be a parent; a root block
(no parent) may not overlap another root in the configuration.

## Security and constraints

- Block CRUD and reconcile are `edit`-gated on the configuration, like every other entity.
- `cidr` is format-validated at the write boundary. Generated reverse-zone and PTR names are
  computed from parsed integers, so they are always `[0-9.]+in-addr.arpa` — injection-safe by
  construction, never derived from raw user strings.
- PTR targets are the forward record's FQDN, already validated when that record was created.
- Ids are server-generated (`blk-` + hex); any client-supplied id is ignored.
- Generated reverse zones and PTRs enter the change-set and deploy through the existing
  approve-then-apply pipeline — no new deploy path, nothing bypasses review.
- Blocks cascade-delete with their configuration via the foreign key.

## Testing

- `ipv4.ts` unit tests: `cidrContainsCidr`, `cidrsOverlap`, `cidrContainsIp`, `reversePtrName`,
  `ptrZoneName`, each with a must-fail control (an assertion that is false on correct code —
  e.g. a non-contained CIDR returns false, a malformed CIDR parses to null).
- Block CRUD: create/list/get/patch/delete; hierarchy-rejection cases (child not inside parent,
  sibling overlap, NETWORK given a child, root overlap) each returning 422 `INVALID_HIERARCHY`;
  bad CIDR → 422 `INVALID_CIDR`; NETWORK without a valid view → 422 `INVALID_VIEW`.
- Auto-sync: create an A in a managed NETWORK → a PTR appears in the correct, lazily-created
  `c.b.a.in-addr.arpa` zone in the network's view, with the forward FQDN as target; update the
  A's address → the PTR moves to the new /24; delete the A → the PTR and its link are gone;
  **create an A outside every network → no PTR and no reverse zone** (must-fail control that
  the automation does not over-fire).
- Reconcile: seed A records in range before creating the NETWORK, call reconcile, assert the
  missing PTRs are backfilled and a second reconcile is a no-op (idempotent).
- Change-set: assert the generated PTR (and any lazily-created reverse zone) appear as items in
  the configuration's change-set so they deploy through the pipeline.

## Out of scope (deliberate)

- **Address inventory** — no per-IP allocation, utilization, next-free, or host assignment.
- **IPv6 / `ip6.arpa`** — the AAAA path is recognized but matches no IPv4 network for now; the
  nibble-reverse expansion and large-prefix guards are a separate follow-up slice.
- **RFC 2317 classless delegation** for sub-/24 networks — reverse zones are always /24; a
  network smaller than /24 still uses its containing /24 reverse zone.
- **Empty-zone cleanup** — a reverse zone left empty after its last PTR moves or is deleted is
  not auto-removed; an admin can delete it by hand. Auto-pruning is a possible later refinement.
- **Hand-edited generated PTRs** — a manual edit to a generated PTR is overwritten on the next
  sync of its source record. The link table treats the generated PTR as owned by the automation.
