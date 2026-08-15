# Bind9-Manager — DESIGN.md

Written spec for implementation. Pairs with `docs/tokens.css`/`tokens.json`. If this document and a mockup
disagree, the mockup wins for visuals; this document wins for structural/behavioral rules.

## 1. Chrome hierarchy — non-negotiable

Three stacked, visually distinct layers, top to bottom:

1. **Configuration strip** (30px, full width, `--color-accent-900` background, inverse text). The
   workspace switcher. Rare, heavy, unmistakable — this is the sanctioned "steel as ground, type
   reversed to paper" exception the design system reserves for section dividers.
2. **Topbar** (56px): View selector (light, accent-tinted pill, left) · search / command-palette
   trigger (center) · pending-changes pill (right, escalates in color from ghost/neutral at 0 pending
   to filled `--state-pending` once changes exist).
3. **Breadcrumb** (34px): View → Zone → Record, or the page title for pages above View scope
   (Configurations, Backups).

Configuration and View must never render as the same control, adjacent siblings, or equal visual
weight. Configuration is the outer frame; View lives inside it. This is a correctness rule, not a
preference — the brief's stated failure mode is an operator editing the wrong view inside the wrong
lab scenario without noticing.

## 2. Panel vs. modal vs. full page

- **Side panel** (440px, slides from right, `--duration-panel` / `--ease-panel`): default for
  creating/editing a single object (record, snapshot label, server service field group). Reversible —
  Cancel discards, closing via backdrop click discards. Never used for anything destructive.
- **Modal** (`.dialog`, centered, `--shadow-lg`): only for (a) irreversible or destructive
  confirmations — deleting a zone/view/server/Configuration, restoring a snapshot over live state —
  and (b) short, non-form choices — the New Configuration template picker. Destructive modals require
  typed confirmation of the object's name plus its dependent-object counts.
- **Full page**: object lists (Zones, Servers, Configurations, Snapshots), the Review & Deploy trust
  screen, and the Server Detail tabs. Anything the operator returns to repeatedly, or that has more
  than one logical section, is a page, not a panel.

## 3. Table density

Row height ≈ 30px (13px text, `--space-2` vertical padding). Header is sticky within its scroll
container. Any table with a "pinned header section" above it (the zone's SOA block) stacks two sticky
elements: the pinned section at `top: 0`, the table header at `top: <pinned section height>`. Bulk
action affordances appear inline in the toolbar only when `selectedCount > 0` — never a persistent
empty state.

## 4. Composition rules a developer must not violate

- Every FQDN, IP address, CIDR, TTL, serial number and RDATA value renders in `--font-mono`, with no
  exceptions — inside tables, forms, diffs, toasts, and inline body copy alike.
- No state (synced/pending/drift/error/deploying) is ever color-only. Pair with an icon, a dot plus a
  text label, or both.
- The staged-change pipeline is the only way any object reaches a server. Service config
  (§ Server Services), snapshot restores, and record edits all produce change-set entries and go
  through diff → pre-flight validate → deploy. No "quick apply" button may write to a server directly;
  the one exception is the Operations panel's `rndc`/service-control actions, which are explicitly
  immediate and must be visually isolated (their own boxed region, labeled "Operations") so it is never
  ambiguous whether a click is staged or live.
- Record type chips are monochrome (`.tag-neutral` + mono font) — never one color per type.
- Three server "off" states (Disabled in Bind9-Manager / named stopped / Node absent) get three
  distinct badges, icons and recovery actions. Never collapse them into one "offline" state.
- Passphrase-type fields (SNMP auth/priv) never render their real value in the Config Review diff —
  show `<redacted>` with a note that the real value is written on deploy.

## 5. Motion

Side panels: 180–220ms, `cubic-bezier(0.32, 0.72, 0, 1)`. Toasts: 150ms. Table rows never animate.
`prefers-reduced-motion` reduces all of the above to an opacity-only crossfade.

## 6. Tabbed object detail — one editor, many mount points

Every container object (Zone, View, Network Block, Server, Server Group, Configuration) opens to the
same shape: an **ObjectHeader** (name in the object's identifying font — monospace for zones/ACLs/
servers, `--font-body` heading weight for views/groups — type badge, status badges, a scoped
pending-change badge, action cluster on the right) followed by a **tab bar**. Tabs vary by object type
but Deployment Roles and Deployment Options are shared tabs everywhere they apply:

```
Zone            → Records | Deployment Roles | Deployment Options | Settings | History
View            → Zones   | Deployment Roles | Deployment Options | Settings | History
Network Block   → Blocks  | Deployment Roles | Deployment Options | Settings | History
Server          → Overview | Services | Deployment Roles | Config Review | History
Server Group    → Members  | Deployment Roles | Deployment Options | Settings | History
Configuration   → Overview | Deployment Options | Snapshots | Settings | History
```

**One component, many mount points.** The Deployment Roles tab and the global `/roles` rollup render
the exact same `DeploymentRolesEditor`, the object-scoped mount passing a pre-applied, lockable scope
filter (shown as a filter chip with a clear/× to widen it). Never fork this into two components — a
fork is how the tab view and the global view drift apart. Same rule for `DeploymentOptionsEditor`.

The global `/roles` and `/options` sections stay, but change job: they become **read-only rollups**
for cross-cutting questions ("every zone server X is secondary for", "everywhere recursion is
overridden") with a "jump to source" link per row into the owning object's tab. There is exactly one
place an edit happens — the object's own tab.

## 7. Deployment Options — the two-axis row

Two independent axes must both be legible on one row, without a wall of text:

- **Axis 1 — placement**: where the directive lands in BIND syntax (`options{}` → `view{}` → `zone{}`
  — innermost wins at runtime).
- **Axis 2 — management scope**: who set it in Bind9-Manager (Configuration default → Server Group →
  Server → View → Zone — most specific wins when the app computes the effective value).

Row anatomy, left to right: expand chevron · option key (mono) · effective value (mono) · a **scope
chip** (`tag-accent` "Set on this {scope}" if set at the current object, `tag-neutral` "Inherited ·
{scope}: {name}" otherwise) · a small mono **placement tag** (`options{}` / `view{}` / `zone{}`,
bordered, not filled — it is metadata, not a state) · an override/revert action. On expand: the full
inheritance chain, least → most specific, overridden values struck through, the effective line in
`--color-accent-700`. This row is the highest-value single piece of UI in the product — do not
simplify it into "value + one badge."

## 8. Access control — named ACLs

Every access-control field (`match-clients`, `allow-query`, `allow-recursion`, `allow-transfer`,
`allow-update`, `allow-notify`, `also-notify`, `blackhole`, SNMP `allowed-managers`) is an **ACL
picker**, never a free-text box: search-select an existing named ACL, or "create new" inline, plus a
link to evaluate it. ACL entries are ordered and drag-reorderable with visible position numbers —
never an unordered chip cloud. Negation (`!10.0.0.0/8`) renders as a loud, labeled state (a filled
"NOT" tag prefixing the entry), not a subtle icon, and the editor renders a plain-language sentence
under the structured list ("deny 10.0.0.0/8, then allow 10.0.0.0/16, then deny all"). A live
`acl "name" { … };` preview in `--font-mono` updates as the operator edits. See `docs/entities.md`
for the `Acl`/`AclEntry` shape and `docs/routes.md` for the evaluator route.

## 9. Consistent scoped pending indicator

Alongside the global pending pill, any list row or ObjectHeader for an object with uncommitted changes
shows a small pending badge (reuse `StatusPill` state=`pending`) — zones, servers, ACLs, Server
Groups. The operator should see where their uncommitted work is without opening Review & Deploy.

## 10. Explain-in-place

One pattern for every place the app computes something non-obvious (effective option value, ACL
verdict, sync state, health finding): an expandable "why" affordance next to the value, using the same
chevron-expand interaction as the Deployment Options chain. Don't invent a second "explain" pattern.
