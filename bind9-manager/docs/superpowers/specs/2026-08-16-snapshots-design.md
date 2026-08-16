# Snapshots / Backups — Design (Plane #59)

**Status:** self-approved under the autonomous "complete the backlog" directive.

## Goal

Capture a configuration's full definition as a named snapshot, list/inspect
snapshots (metadata only), restore one (replace the config's live definition), and
"adopt" the last-deployed baseline as a snapshot. Replaces the `backups` frontend
Placeholder (routes `/backups`, `/backups/adopt`, `/backups/:snapshotId` exist).

## Data model

One table: `snapshots (id, configurationId, data-JSON, createdAt, label)`, id
`snap-`+hex, FK→configurations cascade. `data` = `{ label, createdAt, source,
tables: { <tableName>: Row[] } }` — the raw rows of every config-definition table.

## Captured tables (authoritative, generic/table-driven)

Capture is **table-driven**, not per-entity, so nothing is silently missed and a
future table is one list entry. Snapshot exactly these, by scope:

- configurationId-scoped (`SELECT * WHERE configurationId = ?`): `views`, `zones`,
  `external_hosts`, `servers`, `acls`, `rpz_policies`, `server_groups`, `blocks`,
  `tsig_keys`, `record_templates`, `deployment_options`, `deployment_roles`.
- parent-scoped (resolve through the config's parents):
  - `records` where `zoneId IN (config's zones)`
  - `rpz_rules` where `policyId IN (config's rpz_policies)`
  - `reverse_ptr_links` — capture the rows belonging to this config (join through
    its FK column, whatever db.ts defines; read the schema to get the column).

Explicitly EXCLUDED (not config definition): `configurations` (restore targets an
existing config, never recreates it), `labs` (containerlab runtime), `deploy_jobs`
/ `deployed_baselines` / `changeset_deploy_jobs` (deploy history/baseline —
restore changes the definition, and the normal change-set then diffs it against
the untouched baseline), and all global auth tables (`users`, `sessions`,
`api_keys`).

Rows are captured **verbatim** (raw `data` column and all key columns), so ids and
secrets (tsig secrets, server trust secrets) round-trip exactly — a restore is a
functional twin, not a regenerated copy.

## Security boundary

The blob contains secrets, so it never leaves over the API:

- `GET /snapshots` and `GET /snapshots/:id` return metadata only: id, label,
  createdAt, source, and per-table row counts. Never the raw `tables` blob.
- Restore reads the blob internally.

## Operations (all under `/configurations/:configId/snapshots`)

- `POST /` — capture. Body `{ label, source? }`. `source:'CURRENT'` (default)
  snapshots the live tables above; `source:'BASELINE'` snapshots the deployed
  baseline model (`getBaselineModel`) serialized into the same shape. Returns
  metadata.
- `GET /`, `GET /:id` — list / metadata.
- `POST /:id/restore` — replace the config's live definition with the snapshot,
  inside ONE better-sqlite3 transaction: for each captured table, `DELETE ... WHERE
  <scope>` then re-INSERT the stored rows verbatim. Edit-gated. Does NOT auto-deploy
  — the restored state flows through the normal change-set/deploy pipeline as an
  explicit next step.
- `POST /adopt` — convenience = capture with `source:'BASELINE'`, labeled "adopted
  from last deploy". The honest MVP of "adopt from a live server": it captures what
  the Manager last deployed. True foreign-server introspection is out of scope.
- `DELETE /:id` — edit-gated.

## Restore mechanics

Delete-then-insert per table inside a single `db.transaction(...)`, so a
mid-restore failure rolls the whole thing back (better-sqlite3 transactions are
synchronous). Insert order must respect FKs (parents before children: zones before
records, rpz_policies before rpz_rules). Foreign-key cascade on the config is not
triggered because the config row itself is untouched.

## Out of scope (named)

- True live-server introspection (AXFR / `rndc dumpdb` / named.conf reverse-parse).
- Cross-configuration restore, snapshot diffing, partial restore.

## Change-set / deploy

Restore mutates live entities, so `computeChangeSet` (live vs baseline) shows the
delta automatically. Snapshots are not part of generated config and never enter the
change-set.

## Testing (must-fail controls required)

- Capture then GET returns per-table counts + label but the response JSON contains
  NO secret (must-fail control: asserting a tsig/trust secret is in the API
  response must fail).
- Round-trip: capture CURRENT, add a zone + record, restore, assert the additions
  are gone and the original rows are back with identical ids.
- Restore is transactional: an injected mid-restore failure leaves the config
  unchanged (must-fail control against a non-transactional impl).
- Restore/capture/delete require edit permission → viewer 403.
- adopt captures the baseline (source BASELINE), labeled accordingly.
