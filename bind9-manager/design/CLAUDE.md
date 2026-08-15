# CLAUDE.md — Bind9-Manager implementation seed

Non-negotiables for whoever (human or agent) implements this app from `docs/`. If a change conflicts
with one of these, stop and flag it rather than silently deviating.

1. **Tokens over hardcoded values.** Every color, font, spacing, radius and shadow comes from
   `docs/tokens.css` / `tokens.json`. No hex value, px literal, or font-family string in component
   code. If a needed value doesn't exist yet, add it to the token files first.
2. **Component naming.** PascalCase, one component per file, path exactly as listed in
   `docs/components.md`. Don't introduce a second component for something already in that table.
3. **The monospace rule.** Every FQDN, IP address, CIDR, TTL, serial number and RDATA value renders in
   `var(--font-mono)` — in tables, forms, diffs, toasts, and inline body copy. No exceptions.
4. **The three-distinct-off-states rule.** A server can be off for three unrelated reasons —
   `DISABLED_IN_APP`, `NAMED_STOPPED`, `NODE_ABSENT` — and they render as three different badges, three
   different icons, three different recovery actions. Never collapse them into one "offline" badge.
5. **Never bypass the staged-diff pipeline.** Every object change — including a snapshot restore and
   every field under Server → Services — becomes a `ChangeSetItem` and goes through
   diff → pre-flight validate → deploy. The only exceptions are the Server Detail "Operations" panel
   actions (`rndc reload/reconfig/flush/status/dumpdb`, start/stop/restart), which are explicitly
   immediate and must be visually isolated from staged config so a click's effect (staged vs. live) is
   never ambiguous.
6. **Accessibility baseline.** WCAG 2.1 AA. Every interactive element has a visible
   `:focus-visible` ring — never ship `outline: none` without a replacement. Follow
   `docs/accessibility.md` per-component; don't invent a different pattern for a component already
   listed there.
7. **State is never color-only.** Every state indicator (sync state, admin state, deploy outcome,
   diff line) pairs its color with an icon and/or a text label.
8. **Source of truth for copy.** UI strings come from `docs/copy-inventory.md`. Don't paraphrase a
   button label, error message, or empty-state string that's already defined there.
9. **Source of truth for field names.** API and store field names come from `docs/entities.md`. Don't
   rename a field to match a different convention partway through.
10. **Passphrases never appear in a diff.** SNMP auth/priv passphrases (and any future secret field)
    show `<redacted>` in Config Review / diff views, even though the real value is written on deploy.
11. **One editor, many mount points.** `DeploymentRolesEditor` and `DeploymentOptionsEditor` are each a
    single component instance mounted both inside an object's own tab (scoped, locked filter chip) and
    at the global rollup route (unscoped, read-only + jump-to-source). Never fork them — a fork is how
    the in-context and global views silently drift apart.
12. **Access control is never free text.** Every ACL-shaped field (`match-clients`, `allow-query`,
    `allow-recursion`, `allow-transfer`, `allow-update`, `allow-notify`, `also-notify`, `blackhole`,
    SNMP `allowed-managers`) is an `AclPicker` referencing a named `Acl` object. Don't add a raw text
    input for an access-control field, ever.

Read `docs/DESIGN.md` for layout/behavioral rules, `docs/build-order.md` for implementation sequence,
and `docs/state-machines.md` before writing any status-transition logic.
