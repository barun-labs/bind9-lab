# UI copy inventory

Every string below is the exact, final wording. The implementation must not invent alternate phrasing.

## Navigation (sidebar)
Views · Zones · External Hosts · Network Blocks · Deployment Roles · Deployment Options ·
Servers & Interfaces · Config Review

## Chrome
- Configuration strip label: "Configuration"
- Configuration strip link: "Manage configurations"
- Configuration strip back-link (from Configurations page): "← Back to active configuration"
- Search placeholder: "Search zones, records, servers, IPs…"
- Command palette hint pill: "⌘K"
- Pending pill (>0): "{n} pending changes"
- Pending pill (0): "Up to date"
- Breadcrumb current-item pattern: "Zones ▸ {zoneName} ▸ Records"

## Buttons
"Add record" · "Edit SOA" · "Import" · "Export" · "Disable" · "Delete" · "Cancel" ·
"Save (stages change)" · "New Configuration" · "Compare selected" · "Activate" · "Retry" ·
"Rollback" · "Rolled back — undo" · "Review again" · "Deploy to {n} servers" · "Deploying…" ·
"Deployed" · "View in Deployment History" · "Delete Configuration"

## Table headers (Records)
Name · Type · TTL · RDATA · Status

## Placeholders
- Quick-add name: "name"
- Record address (A): "10.20.30.x" · (AAAA): "2001:db8::x"
- Target (CNAME/NS/ALIAS): "target.lab.lun.net"
- Mail server (MX): "mx1.lab.lun.net"
- SRV target: "sip1.lab.lun.net"
- Configuration delete confirm: "{configName}"

## Status labels
"Synced" · "New · pending" · "Edited · pending" · "Disabled · pending" · "Deploying…" ·
"Deployed" · "Unreachable" · "Drift detected"

## Helper / inline text
- Preview label: "Preview — what will be written"
- Dangling-target warning: "Target not found in this zone or in External Hosts. Deploying will
  create a dangling reference."
- Deploy-ack checkbox: "I've reviewed the checkzone warning on {zoneName} and want to deploy anyway"
- Deploy hint (disabled): "Acknowledge the pre-flight warning to enable deploy."
- Zone header summary: "{n} records · {synced} of {total} servers synced"
- Copy affordance title attr: "Click to copy"
- Compare checkbox title attr: "Select for comparison"

## Configurations screen
- Page title: "Configurations"
- Subtitle: "Each Configuration is a fully isolated DNS world — views, zones, records, blocks and
  servers don't cross between them. Exactly one is active at a time."
- Active badge: "Active"
- New Configuration modal title: "New Configuration"
- New Configuration modal subtitle: "Start from a template, or blank. Templates only seed objects
  inside the new Configuration — nothing is deployed."
- Template names/descriptions: "Blank" — "Nothing pre-built. Start from an empty Configuration." ·
  "Single authoritative primary" — "One view, one primary zone, one server." · "Primary + secondary
  with zone transfer" — "A primary and a secondary server with AXFR configured between them." ·
  "Split-horizon (internal / external)" — "Two views serving different answers for the same zone
  name." · "Recursive resolver with forwarders" — "A caching server with no authoritative zones,
  forwarding upstream." · "Authoritative + reverse zones from a /16" — "A forward zone plus the
  matching reverse zone tree for a /16 block."
- Delete confirm title: "Delete {configName}?"
- Delete confirm body: "This removes {views} views, {zones} zones, {records} records and {servers}
  servers. A snapshot is taken automatically before the delete, so it can be restored from Backup &
  Restore. Type the Configuration name to confirm."
- Compare modal title: "Compare Configurations"

## Review & Deploy screen
- Page title: "Review & Deploy"
- Subtitle: "{n} pending changes across {m} zones, view {view}. Nothing below has been written to a
  server yet."
- Section titles: "Change set" · "Pre-flight validation" · "Target servers"
- Diff toggle: "Unified" / "Split"
- Pre-flight group labels: "named-checkconf · per server" · "named-checkzone · per changed zone"
- Result panel titles: "Deploying…" / "Deploy result"
- Done summary pattern: "{success} of {total} servers deployed successfully — {failed} unreachable"

## Empty states (pattern — fill the object name in)
- Title: "No {objects} yet"
- Body: "Nothing has been created here. {Primary action} to get started." (never a decorative
  illustration — text and the primary action button only)

## Errors / confirmations
See `docs/validation-rules.md` for the full table — that table is this inventory's source for every
validation message; do not duplicate/rephrase it elsewhere.

## Toasts
- Undo delete: "Record deleted." with action "Undo"
- Copy confirmed: "Copied" (2s, on the CopyButton itself, not a toast)
- Syslog test: "Test message sent." / "Test failed: {detail}"

## Addendum 2 additions

- Detail tabs (shared across object types): "Records" / "Zones" / "Blocks" / "Members" · "Deployment
  Roles" · "Deployment Options" · "Overview" · "Services" · "Config Review" · "Settings" · "History"
- Scope filter chip: "Scoped to {objectName}" with a "×" to clear ("Show all")
- Options row action labels: "Override here" / "Revert to inherited"
- Options row scope labels: "Set on this {scope}" / "Inherited · {scope}: {name}"
- ACL editor: "Add entry" · "Deny" / "Allow" toggle per entry · negation tag: "NOT" · sentence prefix:
  "This ACL will: " · live preview label: "Preview — the rendered acl block"
- ACL evaluator: page title "ACL Evaluator" · mode toggle "Check against one ACL" / "Check a client
  against a server and view" · result labels: "Match" / "No match" · "Decided by entry #{n}: {entry}"
  · chain trace heading: "Evaluation trace"
- Dependency panel heading: "Used by" · row pattern: "{count} {objectType}" (link) · blast-radius
  intro (on delete/edit of a referenced object): "Changing this affects:"
- Server Groups: "New group" · "Add members" · rollup labels: "All servers in sync" / "{n} of {m} in
  sync" / "Members disagree" (disagreement state — never phrased as healthy)
- TSIG keys: "Generate key" · "Reveal secret" / "Hide secret" · "Rotate key" · rotation confirm: "Old
  key stays valid until nothing references it after redeploy."
- Health: "Zone Health" · severity labels "Critical" / "Warning" / "Info" · "Mute this rule for
  {zoneName}" · muted-list heading: "Muted for this zone"
- Query tool: "Query" · flag labels "+norecurse" "+trace" "+dnssec" "+tcp" · "Compare across servers"
  · post-deploy prompt: "Verify this change?" → "Run query"
- Object tree nav toggle: "Show tree" / "Hide tree"
- Saved filters: "Save this filter" · name prompt placeholder: "e.g. secondaries out of sync"
- Density toggle: "Comfortable" / "Compact"
- Lab mode strip: "{n} of {m} nodes up · lab last deployed {time}"
