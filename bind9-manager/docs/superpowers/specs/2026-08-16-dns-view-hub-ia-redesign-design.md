# DNS View Hub — IA & Inheritance Redesign

**Goal:** Make a DNS View the primary navigation hub. Zones, records, external hosts, deployment
options, and deployment roles live *inside* a view, and a view's deployment settings cascade to its
zones with per-zone override or disable.

## What this is

Today the app's left nav is a flat list of configuration-scoped screens: Views, Zones, External
Hosts, Deployment Roles, Deployment Options, Servers, and so on. A view is just one entry among many,
and "which view am I in" is a topbar dropdown that sets a `?view=` query param.

This redesign reorganizes the information architecture around the view. The main menu leads with
**DNS Views**. Opening a view shows tabbed sections — Zones, External Hosts, Deployment Options,
Deployment Roles — and opening a zone shows its records plus its own options and roles. Deployment
settings set at the view level flow down to every zone in the view; a zone can inherit, override with
its own value, or disable the setting entirely.

## The key finding that shapes everything

The backend render engine **already** resolves scoped options and roles. `config-engine/model.ts`
defines `DeploymentOption { scopeType: CONFIGURATION | SERVER_GROUP | SERVER | VIEW | ZONE, scopeId,
key, value }` and `DeploymentRole { serverId, zoneId, role }`, and `config-engine/resolve.ts`
implements `resolveOption(model, scope, key)` with nearest-scope-wins precedence
(ZONE → VIEW → SERVER → SERVER_GROUP → CONFIGURATION). `generateNamedConf.ts` reads most BIND clauses
through `resolveOption`. The inheritance the user asked for is, at render time, already built.

Two facts make it inert in production:

- `buildConfigModel` in `entityStore.ts` hardcodes `roles: []` and `options: []`. No data flows into
  the engine — only the test fixtures (`anycastModel.ts`, `testlabModel.ts`) populate them.
- There are no `deployment_options` / `deployment_roles` tables, no CRUD, and no UI.

So this redesign is mostly **surfacing and wiring an engine that already exists**, not building an
inheritance system from scratch. That de-risks the hardest part.

## Decisions

Confirmed with the user:

- **Deployment Option = inline settings per scope.** A view and a zone each have a panel of BIND
  option fields (match-clients, allow-query, allow-transfer, allow-update, recursion, forwarders,
  dnssec-validation, …). No reusable named option object. Internally these are rows in the existing
  `DeploymentOption` model at `scopeType: VIEW` or `ZONE`.
- **Inheritance is inherit / override / disable, per option, at the zone.** A zone inherits the view
  value, replaces it with its own, or suppresses it so no clause is emitted.
- **External Hosts stay configuration-scoped.** Inside a view, list the external hosts that the
  view's records actually reference (a derived link). One host can serve several views without
  duplication. No schema change to `ExternalHost`.

Derived from the code:

- **`match-clients` moves into the options system.** It is read directly off `View.matchClients`
  today (`generateNamedConf.ts:163`), the one option bypassing `resolveOption`. The redesign stores it
  as a `VIEW`-scope option (`key: 'match-clients'`) so it inherits and overrides like everything else.
- **Roles gain a view scope.** Today `DeploymentRole` is keyed by `(serverId, zoneId)` only. To let a
  view-level role assignment cascade to its zones, role rows also carry an optional view scope, and a
  zone can override or disable an inherited role — the same three-state model as options.

## Information architecture & routing

Routing moves from flat to nested. Configuration-scoped screens that are *not* per-view (Servers,
Labs, ACLs, Snapshots, Config Review, Review & Deploy, TSIG Keys) stay where they are.

Before (flat):

```
/config/:configId/views
/config/:configId/zones          /config/:configId/zones/:zoneId/records
/config/:configId/external-hosts
/config/:configId/roles          (Placeholder)
/config/:configId/options        (Placeholder)
```

After (view is the hub):

```
/config/:configId/views                              — view list (main menu)
/config/:configId/views/:viewId                      — view hub, default tab: Zones
/config/:configId/views/:viewId/zones
/config/:configId/views/:viewId/external-hosts
/config/:configId/views/:viewId/options              — view-level Deployment Options
/config/:configId/views/:viewId/roles                — view-level Deployment Roles
/config/:configId/views/:viewId/zones/:zoneId        — zone hub, default tab: Records
/config/:configId/views/:viewId/zones/:zoneId/records
/config/:configId/views/:viewId/zones/:zoneId/options — zone options (inherit/override/disable)
/config/:configId/views/:viewId/zones/:zoneId/roles   — zone roles (inherit/override/disable)
```

Old flat paths redirect to the nested equivalent using the active/first view, so bookmarks and the
existing breadcrumb logic keep working during the transition.

The topbar view dropdown becomes a quick jump between view hubs. The sidebar's Views / Zones /
External Hosts / Deployment Options / Deployment Roles entries collapse into the single **DNS Views**
entry; the config-scoped items remain.

## Entity & data model

New SQLite tables:

```
CREATE TABLE deployment_options (
  id TEXT PRIMARY KEY,
  configurationId TEXT NOT NULL,
  scopeType TEXT NOT NULL,        -- 'VIEW' | 'ZONE' (the engine allows more; UI uses these two)
  scopeId TEXT NOT NULL,          -- viewId or zoneId
  key TEXT NOT NULL,              -- 'match-clients', 'allow-query', 'recursion', …
  value TEXT,                     -- JSON-encoded; NULL when disabled
  disabled INTEGER NOT NULL DEFAULT 0,
  UNIQUE (configurationId, scopeType, scopeId, key)
);

CREATE TABLE deployment_roles (
  id TEXT PRIMARY KEY,
  configurationId TEXT NOT NULL,
  scopeType TEXT NOT NULL,        -- 'VIEW' | 'ZONE'
  scopeId TEXT NOT NULL,
  serverId TEXT NOT NULL,
  role TEXT NOT NULL,             -- ServerRole: PRIMARY | SECONDARY | FORWARDER | STUB | RECURSIVE
  disabled INTEGER NOT NULL DEFAULT 0,
  UNIQUE (configurationId, scopeType, scopeId, serverId)
);
```

`buildConfigModel` replaces `options: []` / `roles: []` with reads from these tables. Existing zone
role rows (view-scope) expand to concrete `DeploymentRole { serverId, zoneId, role }` entries for
each zone in the view when the engine builds `model.roles`, so `zonesForServer` and the renderer need
no change to their consumption shape.

Shared types (`shared/entities.ts`) gain the API-facing shapes:

```ts
export type OptionScope = 'VIEW' | 'ZONE';
export type InheritMode = 'INHERIT' | 'OVERRIDE' | 'DISABLE';

export interface DeploymentOptionRow {
  id: string; configurationId: string;
  scope: OptionScope; scopeId: string;
  key: string; value: unknown | null; disabled: boolean;
}
export interface DeploymentRoleRow {
  id: string; configurationId: string;
  scope: OptionScope; scopeId: string;
  serverId: string; role: ServerRole; disabled: boolean;
}
// The resolved view of one zone option, for the inheritance UI:
export interface EffectiveOption {
  key: string; mode: InheritMode;
  effectiveValue: unknown | null;   // what the renderer will emit (null = omitted)
  inheritedValue: unknown | null;   // the view value shown when mode = INHERIT
}
```

`View.matchClients` is removed from the entity once migrated (see below); `Zone.allowTransfer` /
`Zone.allowUpdate` follow the same path but can migrate in a later slice — until then the renderer's
`resolveOption(...) ?? zone.allowTransfer` fallbacks mean DISABLE on those two keys is not yet
honored, which the plan will call out explicitly.

## Inheritance semantics

The three-state model maps onto the existing resolver with one small change:

- **INHERIT** — no `deployment_options` row at `ZONE` scope for that key. `resolveOption` falls
  through to the `VIEW` row. This is the default and needs no storage.
- **OVERRIDE** — a `ZONE`-scope row with a value. `resolveOption` finds it first and returns it.
- **DISABLE** — a `ZONE`-scope row with `disabled = 1`. `resolveOption` finds it first and, because
  the row is disabled, returns `undefined` **without** falling through to the view. Undefined already
  means "omit this clause" at every call site, so no renderer call site changes.

The only engine change: `resolveOption` returns `found.disabled ? undefined : found.value` instead of
`found.value`, and `DeploymentOption` gains `disabled?: boolean`. One line plus a field.

A pure helper `effectiveZoneOptions(model, viewId, zoneId)` returns `EffectiveOption[]` for the UI, so
the zone options screen shows each key's mode, the value it will emit, and the inherited value behind
an INHERIT. It reuses `resolveOption`; it does not reimplement precedence.

## Deployment Roles

Roles follow the same shape as options. A view-scope role assignment ("ns1 is PRIMARY for this view")
expands to a role on every zone in the view when the model is built. A zone overrides (assign a
different server/role) or disables (this server does not serve this zone). `zonesForServer` and the
renderer keep consuming the flattened `DeploymentRole[]`, so the render path is unchanged.

## External Hosts inside a view

No schema change. A derived endpoint (or a client-side computation over already-loaded records)
answers "which external hosts does this view reference": for each record in the view's zones whose
rdata target is an external-host FQDN, collect the host. The view's External Hosts tab lists those,
each showing its total reference count. The External Hosts detail view gains a "referenced by views"
list computed the same way.

## Change-set & deploy integration

`ChangeSetObjectType` today is `VIEW | ZONE | RECORD | ACL | SERVER`. Editing an option or role must
show as a pending change and deploy, so it grows `OPTION | ROLE`. `changeSet.ts` diffs the new tables
against the deployed baseline by row id (`cs-OPTION-<id>`, `cs-ROLE-<id>`), and the deployed baseline
snapshot (`deployed_baselines`) includes options and roles. Without this, option/role edits would
silently never deploy.

## Renderer impact & the golden-config guarantee

The load-bearing invariant: **with the new tables empty and `match-clients` migrated, the generated
`named.conf` for existing data is byte-for-byte identical to today.** The engine already reads through
`resolveOption`; feeding it real rows only changes output where a user has set a row. A golden-output
test over the current fixtures gates every backend slice: if generated config changes for unchanged
input, the slice is wrong.

## Frontend

- **View hub** (`views/:viewId`) — a tabbed shell (Zones / External Hosts / Deployment Options /
  Deployment Roles), reusing the existing tab pattern from the Labs editor.
- **Zone hub** (`…/zones/:zoneId`) — tabs Records / Deployment Options / Deployment Roles, with the
  existing `ZoneRecords` screen slotted into the Records tab.
- **Deployment Options panel** — a form of known BIND keys. At view scope, each key is set or unset.
  At zone scope, each key has a three-way control: Inherit (shows the view value, read-only) /
  Override (reveals the value editor) / Disable. The control is one small component reused per key.
- **Sidebar** — collapse the per-view entries into **DNS Views**; keep config-scoped entries.

## Security

Reuse the established rules: names that become identifiers are charset-validated at the write
boundary; option `value` payloads (ACL lists, forwarder IPs) validate against the same address/CIDR
and DNS-name checks the ACL and zone editors already use; ids are server-generated; the deploy target
allowlist is unchanged. No option value is ever interpolated into a shell or filesystem path — the
renderer emits it into a config file that BIND parses.

## Testing

- Pure `resolveOption` disabled-sentinel test, with a must-fail control (a disabled zone row must
  suppress the view value, not fall through to it).
- `effectiveZoneOptions` returns the correct mode and values for inherit / override / disable.
- Golden `named.conf` output unchanged for the current fixtures with empty option/role tables, and
  unchanged after the `match-clients` migration.
- Change-set includes an option edit and a role edit; deploy clears them from the pending set.
- Frontend: the three-state control round-trips inherit/override/disable; the view hub renders each
  tab; old flat routes redirect.

## Build order (slices for the plan)

1. Tables + entityStore CRUD + `buildConfigModel` wiring + `resolveOption` disabled sentinel. Golden
   output unchanged. (Backend, security-relevant: option-value validation.)
2. Migrate `View.matchClients` → `VIEW`-scope `match-clients` option; renderer reads it via
   `resolveOption`; data migration; golden output unchanged.
3. Change-set + deploy integration for `OPTION` / `ROLE`.
4. Deployment Options API + `effectiveZoneOptions` helper.
5. Deployment Roles API (view + zone scope, flattening).
6. Frontend IA: nested routing, view hub, tabs, sidebar collapse, redirects.
7. Frontend: zone hub, three-state inheritance control, external-hosts-referencing-views.

## Open questions & out of scope

- **Config- and server-scope options.** The engine supports `CONFIGURATION`, `SERVER_GROUP`, and
  `SERVER` scopes. This redesign edits only `VIEW` and `ZONE`. Config-global options (e.g.
  `dnssec-validation no`, `directory`) are a natural later slice; the tables already allow them.
- **`Zone.allowTransfer` / `Zone.allowUpdate` fallbacks.** Until these entity fields migrate into the
  options system, DISABLE on those two keys is not honored (the renderer falls back to the entity
  field). Slice this migration after the core lands, or accept the limitation and document it.
- **Which BIND keys the panel exposes.** The initial set: match-clients (view only), allow-query,
  allow-query-cache, allow-recursion, recursion, allow-transfer, allow-update, forwarders, forward,
  also-notify, dnssec-validation. Driven by what `generateNamedConf.ts` already resolves; more can be
  added without schema change.
