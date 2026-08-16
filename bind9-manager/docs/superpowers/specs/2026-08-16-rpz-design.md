# Response Policy Zones (RPZ) — Design (Plane #58)

**Status:** self-approved under the autonomous "complete the backlog" directive.

## Goal

Let an operator define Response Policy Zones — DNS firewall rules that rewrite
answers (block, redirect, pass through) — and have the config engine emit both the
RPZ policy zone file(s) and the `response-policy { ... };` clause in the owning
view. Replaces the `rpz` frontend Placeholder with a real backend.

## Background (BIND RPZ)

An RPZ is an ordinary primary zone whose records are policy triggers encoded by
owner-name convention, referenced from a view/options by
`response-policy { zone "<name>" [policy <action>]; ... };`. A rule = a trigger
(what to match) + an action (what to do).

- **Triggers** (MVP): `QNAME` (a queried domain), `CLIENT_IP` (a client CIDR),
  `IP` (an answer-address CIDR).
- **Actions** (MVP): `NXDOMAIN`, `NODATA`, `PASSTHRU`, `DROP`, `TCP_ONLY`,
  `CNAME` (redirect to a target name).

## Data model (two new tables, mirroring the entity-store JSON idiom)

- `rpz_policies (id, configurationId, data-JSON)` where data =
  `{ viewId, name, order, defaultPolicy? }`. `name` becomes the policy zone name
  and its filename → charset-validated at the write boundary (no `..`, DNS-label
  charset). `id = 'rpz-'+hex`, server-generated. A policy belongs to exactly one
  view.
- `rpz_rules (id, policyId, data-JSON)` where data =
  `{ trigger, value, action, cname?, order }`. `id = 'rpzr-'+hex`.

Both cascade-delete with the configuration; rules cascade with their policy.

## Validation (at the write boundary)

- `trigger === 'QNAME'` → `value` is a valid domain name (label charset, ≤253).
- `trigger` ∈ {`CLIENT_IP`,`IP`} → `value` is a valid IPv4 CIDR (reuse
  `ipv4.ts parseCidr` from the IPAM feature).
- `action === 'CNAME'` → `cname` present and a valid domain; other actions →
  `cname` absent.
- Reject unknown trigger/action. Ids server-generated. Names never interpolated
  raw into generated files — encode via the owner-name builder below.

## Rendering (config-engine)

1. **Policy zone file** — each `rpz_policy` renders a primary zone file
   `zones/db.rpz.<name>` with SOA + NS(localhost) + one RR per rule. Owner-name
   encoding, built from parsed components (never raw substrings):
   - QNAME `evil.example` → owner `evil.example`
   - CLIENT_IP `10.0.0.0/24` → owner `24.0.0.0.10.rpz-client-ip`
   - IP `192.0.2.0/24` → owner `24.0.2.0.192.rpz-ip`
   Action RR on the owner:
   - NXDOMAIN → `CNAME .`
   - NODATA → `CNAME *.`
   - PASSTHRU → `CNAME rpz-passthru.`
   - DROP → `CNAME rpz-drop.`
   - TCP_ONLY → `CNAME rpz-tcp-only.`
   - CNAME(target) → `CNAME <target>.`
2. **named.conf** — declare the policy zone as an ordinary
   `zone "<name>" { type master; file "..."; };`, and in the owning view append
   `response-policy { zone "<name>" [policy <defaultPolicy>]; ... };` listing that
   view's policies in `order`. Emit the clause only when the view has ≥1 policy.
   Insertion point: `renderView` in `backend/src/config-engine/generateNamedConf.ts`
   (after the `forward`/option lines, before the zone blocks).

## Change-set / deploy

RPZ policies and rules feed the generated named.conf + zone files, so
`computeChangeSet` (which diffs the generated model vs the deployed baseline)
captures them automatically — no change-set plumbing needed, same as IPAM. Confirm
the config model assembly (`buildConfigModel`) includes RPZ so generated output
reflects it.

## API (admin/edit-gated like other write routes)

- `GET/POST /configurations/:configId/rpz-policies`, `GET/PATCH/DELETE
  .../rpz-policies/:id`
- `GET/POST .../rpz-policies/:id/rules`, `PATCH/DELETE .../rpz-rules/:id`
- List responses ordered by `order`.

## Out of scope

- NSDNAME / NSIP triggers, per-rule `policy` overrides beyond the zone default,
  RPZ `recursive-only` / `max-policy-ttl` tuning — add later if asked.
- IPv6 CIDR triggers (IPv4 first, matching the IPAM slice).

## Testing (must-fail controls required)

- QNAME rule with an invalid domain value → rejected (must-fail control).
- CLIENT_IP rule with a non-CIDR value → rejected.
- Generated owner name for a crafted value contains no shell/zone-file injection
  (built from parsed parts) — a test feeding a hostile value asserts the encoded
  owner is safe (must-fail: raw-substring encoding fails it).
- A view with zero policies emits NO `response-policy` clause; with ≥1 it emits the
  clause listing them in order.
- CNAME action requires a target; NXDOMAIN action forbids one.
