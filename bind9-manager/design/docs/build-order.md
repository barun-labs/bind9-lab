# Build order

Phased so the app is demoable and testable incrementally. Each phase's "Definition of done" must pass
before starting the next phase's UI work (backend for later phases can be stubbed against
`fixtures.json` in the meantime).

## Phase 0 — Shell & tokens
Ship `tokens.css`, the three-layer chrome (Configuration strip, Topbar, Breadcrumb), the collapsible
sidebar, and routing skeleton for every route in `routes.md` (empty-state pages are fine).
**DoD:** every route in `routes.md` resolves to a page with the correct chrome and no console errors;
Configuration and View switching persists across a hard refresh (URL-driven).

## Phase 1 — Records table (the flagship screen)
DataTable, RecordTypeChip, StatusPill, inline quick-add row, Add/Edit side panel with type-aware
fields and live zone-file-line preview, dangling-target check against `fixtures.json` External Hosts.
**DoD:** can add/edit/disable a record of every supported type without a page reload; table stays
responsive at the `fixtures.json` record count; every identifier renders in `--font-mono`.

## Phase 2 — Review & Deploy (the trust screen)
Change-set grouping, DiffViewer (unified + split), pre-flight validation display, target-server
selection, deploy confirmation, simulated (then real) per-server progress, rollback/retry.
**DoD:** a staged record edit from Phase 1 appears here automatically; the diff for it is correct;
deploy produces a per-server result and a Deployment History entry.

## Phase 3 — Configurations
List, clone, template-based create, typed-confirm delete with automatic snapshot, compare.
**DoD:** cloning produces an independent copy with no shared state; switching the active Configuration
changes every downstream screen's data; delete is blocked without the exact typed name.

## Phase 4 — Remaining object screens
Views, Zones list, External Hosts, Network Blocks & Reverse Zones (tree, RFC 2317 handling),
Deployment Roles matrix, Deployment Options (inheritance chain).
**DoD:** each object type round-trips create → stage → appears in Review & Deploy → deploys.

## Phase 5 — Servers & Interfaces + Server Detail
Server list grouped by lab with the four containerlab lifecycle states, Server Detail tabs
(Overview/Services/Deployment Roles/Config Review/History), the Services subtabs (DNS options,
logging channels/categories, syslog, SNMP with the v2c/v3 warning treatment, the three admin-state
badges, the Operations panel).
**DoD:** the three off-states render as three distinct badges/icons/actions from real (fixture) data;
an Operations action is visibly separated from staged config and shows an immediate result.

## Phase 6 — Backup & Restore
Snapshot list, snapshot detail, restore-as-staged-diff flow, manual/scheduled snapshot creation,
adopt/import entry + parse-report review screen, export (object-model + native BIND bundle).
**DoD:** restoring a snapshot never writes directly — it always lands in Review & Deploy first; adopt
produces a parse report before any objects are created.

## Phase 7 — Command palette, keyboard shortcuts, accessibility pass
Implement `docs/keyboard-shortcuts.md` in full, audit against `docs/accessibility.md`, wire the
command palette to every object type.
**DoD:** every shortcut in the map works; axe (or equivalent) reports no critical violations on the
five busiest screens (Records, Review & Deploy, Servers, Backups, Configurations).

## Phase 8 — Kitchen sink & polish
Keep `Kitchen-Sink.dc.html` (or its framework equivalent) in sync as components stabilize; use it as
the PR review surface for any new component state.

## Phase 9 — Tabbed object detail retrofit (Addendum 2)
Introduce `ObjectHeader` + `DetailTabs`; move Deployment Roles/Options into `DeploymentRolesEditor`/
`DeploymentOptionsEditor` mounted both in-context (Zone/View/Block/Server Group tabs) and at the
global rollup routes with a locked `ScopeFilterChip`. Retrofit the Zone detail page first — it is the
screen opened most often.
**DoD:** the same editor component instance (not a copy) renders in a zone's tab and in the global
rollup, verified by scope-filter prop, not a fork; edits in one place are reflected in the other
without a page reload.

## Phase 10 — Server Groups
List/detail, multi-membership, deploy-to-group with member-by-member progress and rollup state, the
disagreement/drift empty states.
**DoD:** a group with a BIND-version mismatch renders the disagreement state, not an averaged "ok".

## Phase 11 — Named ACLs + evaluator
ACL list/editor (ordered, negatable, live preview, plain-language sentence), migrate every
access-control field to `AclPicker`, `DependencyPanel` wired to ACL delete/edit, then the evaluator
(simple + full-chain modes).
**DoD:** the chain-mode evaluator correctly names the first blocking rule for a constructed
client-IP/server/view scenario in the fixture data.

## Phase 12 — Health, query tool, search-by-value
Zone health rules engine + Health screen + per-zone mute; Query panel (single + compare) wired from
palette/zone/server/post-deploy; global search extended to IP/CIDR reference lookup.
**DoD:** disabling `recursion` misconfig (any + recursion yes) surfaces as a CRITICAL finding in the
fixture data; a query against two servers in compare mode visibly diffs a mismatched answer.

## Phase 13 — Remaining v1 functionality
TSIG keys, SOA serial policy + per-server serial comparison, PTR co-management, fast/parsed record
entry, bulk operations (delete/disable/TTL/find-replace/CSV), record templates, dry-run deploy,
per-object history, object tree nav, pinned/recents, saved filters, density toggle, print/export.
**DoD:** each ships behind the `docs/validation-rules.md` and `docs/copy-inventory.md` entries added
for it — no ad hoc copy or validation invented mid-implementation.

## v2 seams (design only, no build)
Response Policy Zones, DNSSEC key management, deploy scheduling — see `docs/entities.md` for the
reserved shapes and the empty-state requirement.
