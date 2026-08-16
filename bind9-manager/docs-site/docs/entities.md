# Entities & Data Model

The object model is defined in `shared/entities.ts` (plus the `Server` shape in
`backend/src/config-engine/model.ts`). This page lists each entity, what it means, and the fields
that matter. The exact shapes are the source of truth; this is the map, not the territory.

## How objects are stored

Most entity tables share one layout: `(id TEXT PRIMARY KEY, configurationId TEXT, data TEXT)`. The
full object is serialized as JSON into `data`; `id` and `configurationId` are denormalized columns
so foreign keys and index lookups work. Records differ slightly — they key on `zoneId` instead of
`configurationId` and join through their zone to find their configuration.

`configurationId` is what scopes everything. A view, zone, record, ACL, server, and lab all belong
to one configuration, and every route checks the actor's permission on that configuration before
touching the object. The `deployed_baselines` table stores, per configuration, a snapshot of the
last successfully deployed `ConfigModel` — that snapshot is what the change set diffs against.

## IDs are generated server-side

The server assigns IDs when objects are created. Views, zones, ACLs, servers, and labs get random
hex suffixes (`view-…`, `zone-…`, `acl-…`, `srv-…`, `lab-…`). The one nuance is records: a record
uses a monotonic `rec-N` counter, and will accept a client-supplied `id` if the request carries one.
For everything else, an `id` in a create payload is ignored — the server's value wins, which is part
of the safety model described in [Isolation & Security](isolation-security.md).

## The entities

### Configuration

The top-level container for one DNS environment. It has a name, an optional description, an
`isActive` flag, and timestamps for creation, update, and last deploy. Its `counts` object
(`views`, `zones`, `records`, `servers`) is recomputed live from the entity tables on every read —
the stored value is a seed-time snapshot that goes stale, so `computeConfigCounts` counts rows
instead of trusting it.

### View

A BIND view: a named, ordered partition of the namespace. It has a `name`, an `order` (views render
in ascending order), and `matchClients` (the ACL list that decides which queries land in the view).
`zoneCount` tracks how many zones live in it.

### Zone

A DNS zone inside a view. Fields: `name`, `type` (`PRIMARY`, `SECONDARY`, `FORWARD`, `STUB`), the
`soa` record (primary NS, admin email, serial, and the refresh/retry/expire/minimum timers),
optional `allowTransfer`/`allowUpdate` lists, and a `recordCount`.

### ResourceRecord

One record in a zone. It has a `name`, a `type` (`A`, `AAAA`, `CNAME`, `MX`, `TXT`, `SRV`, `NS`,
`PTR`, `CAA`, `ALIAS`), a `ttl`, and `rdata` — a type-specific object, for example
`{ "priority": 10, "target": "mail.example." }` for an MX record. A record can be `disabled`
(skipped when rendering zone files) and carries a `syncState` plus an optional `issue` string for
deploy diagnostics.

### ExternalHost

A hostname the configuration references but does not own — an upstream resolver or an external
authoritative server. It stores the `fqdn` and a `referenceCount` so the UI can show which objects
point at it.

### Acl and AclEntry

A named ACL is a reusable access-control list. An `Acl` has a `name`, an `entries` array, and a
`usedByCount`. Each `AclEntry` is one element: an `order`, a `type` (`ADDRESS`, `CIDR`, `ACL_NAME`,
`KEY_NAME`, `ANY`, `NONE`, `LOCALHOST`, `LOCALNETS`), a `value` (the address/CIDR/referenced ACL/key
name, or null for the bare types), and a `negated` flag. ACLs are what the config-engine turns into
`{ 10.0.0.0/8; ... };` lists inside `match-clients` and `allow-*` statements.

### Server

A BIND server. In `model.ts` a `Server` has an `id`, an optional `name` and `serverGroupId`, and the
fields that tie it to a lab: `labName`, `nodeName`, and `serviceInterfaces` (the listen/data-plane
addresses). The REST layer also stores `hostname`, `mgmtAddress`, `image`, `adminState`, and
`syncState` on it. Lab-reconciled servers get IDs of the form `srv-<lab.id>-<node.name>`.

### Lab and topology

A `Lab` (in `labStore.ts`) binds a configuration to a containerlab topology. It has a `name`, the
`configurationId`, and a `topology` object — `TopologyModel` with a `name`, optional `mgmtNetwork`
and `mgmtSubnet`, a list of `nodes`, and `links`. Each node has a `kind` (`linux` or `bridge`) and an
`intent` (`bind`, `router`, or `bridge`); a node with `intent: 'bind'` is the one the config-engine
renders BIND config for. The lab also tracks `lifecycleState` (`NEVER_DEPLOYED`, `DEPLOYED`,
`DESTROYED`) and last-deploy/last-destroy timestamps.

### ChangeSetItem

One pending change, computed — not stored — by diffing the live `ConfigModel` against the
last-deployed baseline. Each item has a deterministic, stable id (`cs-<objectType>-<objectId>`), an
`action` (`CREATE`, `UPDATE`, `DELETE`, `DISABLE`, `ENABLE`), an `objectType`/`objectId`/`objectLabel`,
a `groupKey` used for UI grouping, and a `diff` with `before`/`after` snapshots.

### ChangeSetDeployJob

The record of one Review & Deploy run. It stores the configuration, the `changeSetItemIds` and
`targetServerIds` it was asked to deploy, a `status` (`QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`,
`PARTIAL`, `CANCELLED`), the `preflight` results, per-server `serverResults` with outcomes and
stderr, and a `warningAck` flag.

## The change-set types and state machines

The pending-change-set and deploy-job lifecycles are documented as state machines in
`design/docs/state-machines.md`, quoted in full on [Deploy & Change Sets](deploy-and-changeset.md).
