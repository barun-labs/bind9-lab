# DDI API Parity — Gap Analysis (Plane #31)

**Goal:** Bring the Bind9-Manager API up to the surface a DDI product (BlueCat BAM) exposes for DNS
management, by finding the endpoints we lack and closing the well-scoped ones.

## How the gaps were found

The BlueCat BAM API could not be enumerated live this pass — BAM is read-only and its `/api/v2/sessions`
login is the user's to run, and no `$BAM_TOKEN` was set. So the comparison is grounded in *our own
code*: every Placeholder screen in `app/src/router.tsx` is a feature with a UI stub and no backing API,
and the route list from `app.ts` shows which entities have partial (read-only or list-only) coverage.
Cross-referenced against BlueCat's DDI object model (Configuration → View → Zone → Record, plus
Deployment Roles/Options, IPAM blocks/networks, TSIG keys, RPZ, server groups, snapshots).

## Where we already have parity

Full CRUD exists for: views, zones, records, servers, ACLs (with evaluate), labs, api-keys, sessions,
and read paths for search and health. Change-set + deploy-jobs (with retry and status) cover selective
deployment. These are not gaps.

## Gaps, by effort

**Well-scoped — mirror an existing CRUD pattern, no new design needed:**

- **External Hosts write.** Today GET only (`/configurations/:configId/external-hosts`). Add
  POST / PATCH / DELETE, mirroring the view CRUD pattern and its validation. External hosts are
  config-scoped FQDNs referenced by records.
- **Configuration CRUD.** Today list + get only. Add create, rename/patch, clone, delete. Clone is the
  high-value one (BAM's "duplicate configuration") — copy views/zones/records/servers into a new config.
- **Server Groups CRUD.** `groups` is a Placeholder; the model already has `Server.serverGroupId` and
  `resolveOption` honors `SERVER_GROUP` scope, so the entity is half-wired. Add the table + CRUD.
- **TSIG Keys CRUD.** `keys` is a Placeholder. Keys are referenced by ACL `KEY_NAME` entries and
  zone `allow-transfer` / `allow-update`. Add table + CRUD + secret generation server-side.
- **Record Templates.** `templates` is a Placeholder. A named set of records applied to a zone.
- **Users management.** A `/settings/users` screen exists but there is no `/api/v1/users` CRUD — only
  api-keys, sessions, and me. Add user create/patch/deactivate/role-assignment (admin only).

**Needs its own design spec before implementation — larger subsystems:**

- **Network Blocks / reverse-zone IPAM.** `blocks` is a Placeholder. This is BlueCat's core: IP4/IP6
  blocks and networks, and auto-generation of reverse (`in-addr.arpa` / `ip6.arpa`) zones and PTRs
  from forward A/AAAA records. Substantial; own spec.
- **Response Policy Zones (RPZ).** `rpz` is a Placeholder. RPZ rules + the `response-policy` clause in
  the view. Own spec.
- **Snapshots / backups.** `backups` is a Placeholder (with an "adopt from server" sub-stub). Capture
  and restore a configuration's state, and adopt config off a live server. Own spec.

**Owned elsewhere — do not duplicate:**

- **Deployment Roles** and **Deployment Options** APIs are part of the DNS View hub redesign
  (Plane #42 / `2026-08-16-dns-view-hub-ia-redesign-design.md`). The `roles` and `options`
  Placeholders are closed there.

## Recommended order

Do the well-scoped CRUD gaps first (each is a small, testable slice mirroring existing code):
External Hosts write → TSIG Keys → Server Groups → Configuration CRUD (incl. clone) → Record
Templates → Users API. Then spec the three larger subsystems (IPAM, RPZ, snapshots) individually.

## Constraints (unchanged, apply to every endpoint)

Ids are server-generated; names that become identifiers or filesystem paths are charset-validated at
the write boundary; secrets (TSIG keys, user passwords) are generated/hashed server-side and never
returned after creation; admin-only routes gate on the RBAC `admin` permission; every write path is
covered by the change-set/deploy pipeline where it affects generated config.
