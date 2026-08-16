import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import type { Snapshot } from '../../../shared/entities';
import type { ConfigModel } from '../config-engine/model';
import { getBaselineModel } from './changeSetStore';

// Authoritative captured-tables list (Plane #59 spec). Table-driven so nothing
// is silently missed and a future table is one list entry.
//
// Scope:
//   'config' — SELECT * WHERE configurationId = ?
//   'parent' — SELECT * WHERE <parentColumn> IN (SELECT id FROM <parentTable> WHERE configurationId = ?)
//
// Order is significant for restore: parents before children (insert order);
// the delete phase runs the same list in reverse so children go before parents.
interface TableSpec {
  name: string;
  scope: 'config' | 'parent';
  parentColumn?: string;
  parentTable?: string;
}

const TABLE_SPECS: TableSpec[] = [
  { name: 'views', scope: 'config' },
  { name: 'zones', scope: 'config' },
  { name: 'rpz_policies', scope: 'config' },
  { name: 'external_hosts', scope: 'config' },
  { name: 'servers', scope: 'config' },
  { name: 'acls', scope: 'config' },
  { name: 'server_groups', scope: 'config' },
  { name: 'blocks', scope: 'config' },
  { name: 'tsig_keys', scope: 'config' },
  { name: 'record_templates', scope: 'config' },
  { name: 'deployment_options', scope: 'config' },
  { name: 'deployment_roles', scope: 'config' },
  { name: 'records', scope: 'parent', parentColumn: 'zoneId', parentTable: 'zones' },
  { name: 'rpz_rules', scope: 'parent', parentColumn: 'policyId', parentTable: 'rpz_policies' },
  { name: 'reverse_ptr_links', scope: 'config' },
];

type SnapshotSource = 'CURRENT' | 'BASELINE';
type TableRow = Record<string, unknown>;
type Tables = Record<string, TableRow[]>;

interface SnapshotBlob {
  label: string;
  createdAt: string;
  source: SnapshotSource;
  tables: Tables;
}

interface SnapshotDbRow {
  id: string;
  configurationId: string;
  data: string;
  createdAt: string;
  label: string;
}

function selectSql(spec: TableSpec): string {
  if (spec.scope === 'config') {
    return `SELECT * FROM ${spec.name} WHERE configurationId = ?`;
  }
  return `SELECT * FROM ${spec.name} WHERE ${spec.parentColumn} IN (SELECT id FROM ${spec.parentTable} WHERE configurationId = ?)`;
}

function deleteSql(spec: TableSpec): string {
  if (spec.scope === 'config') {
    return `DELETE FROM ${spec.name} WHERE configurationId = ?`;
  }
  return `DELETE FROM ${spec.name} WHERE ${spec.parentColumn} IN (SELECT id FROM ${spec.parentTable} WHERE configurationId = ?)`;
}

function emptyTables(): Tables {
  const tables: Tables = {};
  for (const spec of TABLE_SPECS) tables[spec.name] = [];
  return tables;
}

// Raw-select every captured table verbatim: the `data` blob (and any secret it
// holds) is stored as-is, never parsed, so a restore is a functional twin.
function captureRows(db: Database.Database, configId: string): Tables {
  const tables = emptyTables();
  for (const spec of TABLE_SPECS) {
    tables[spec.name] = db.prepare(selectSql(spec)).all(configId) as TableRow[];
  }
  return tables;
}

// Serialize the deployed baseline model into the same tables shape. The model
// is a rendered subset: server_groups, blocks, tsig_keys (secrets), and
// record_templates are not part of it, and server trust secrets are stripped,
// so those tables are empty in an adopted snapshot. Synthesized match-clients
// options (no id) are skipped — they are re-synthesized from views on the next
// buildConfigModel.
function serializeBaseline(model: ConfigModel, configId: string): Tables {
  const tables = emptyTables();
  tables.views = model.views.map((v) => ({ id: v.id, configurationId: v.configurationId, data: JSON.stringify(v) }));
  tables.zones = model.zones.map((z) => ({ id: z.id, configurationId: z.configurationId, viewId: z.viewId, data: JSON.stringify(z) }));
  tables.records = model.records.map((r) => ({ id: r.id, zoneId: r.zoneId, data: JSON.stringify(r) }));
  tables.servers = model.servers.map((s) => ({ id: s.id, configurationId: configId, data: JSON.stringify(s) }));
  tables.acls = (model.acls ?? []).map((a) => ({ id: a.id, configurationId: a.configurationId, data: JSON.stringify(a) }));
  tables.external_hosts = (model.externalHosts ?? []).map((h) => ({ id: h.id, configurationId: h.configurationId, data: JSON.stringify(h) }));
  tables.rpz_policies = (model.rpzPolicies ?? []).map((p) => ({ id: p.id, configurationId: p.configurationId, data: JSON.stringify(p) }));
  tables.rpz_rules = (model.rpzRules ?? []).map((r) => ({ id: r.id, policyId: r.policyId, data: JSON.stringify(r) }));
  tables.deployment_options = model.options
    .filter((o) => typeof o.id === 'string')
    .map((o) => ({
      id: o.id,
      configurationId: configId,
      scopeType: o.scopeType,
      scopeId: o.scopeId,
      key: o.key,
      value: JSON.stringify(o.value),
      disabled: o.disabled ? 1 : 0,
    }));
  tables.deployment_roles = (model.roleRows ?? []).map((r) => ({
    id: r.id,
    configurationId: r.configurationId,
    scopeType: r.scope,
    scopeId: r.scopeId,
    serverId: r.serverId,
    role: r.role,
    disabled: r.disabled ? 1 : 0,
  }));
  return tables;
}

function toMeta(row: SnapshotDbRow, blob: SnapshotBlob): Snapshot {
  const counts: Record<string, number> = {};
  for (const [name, rows] of Object.entries(blob.tables)) {
    counts[name] = rows.length;
  }
  return {
    id: row.id,
    configurationId: row.configurationId,
    label: row.label,
    createdAt: row.createdAt,
    source: blob.source,
    counts,
  };
}

// Column names are taken from the stored row's own keys, so re-INSERT is
// verbatim (all columns) for every table without a per-table column list.
function insertRows(db: Database.Database, table: string, rows: TableRow[]): void {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]);
  const placeholders = cols.map(() => '?').join(', ');
  const stmt = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`);
  for (const row of rows) {
    stmt.run(...cols.map((c) => row[c]));
  }
}

export function captureSnapshot(
  db: Database.Database,
  configId: string,
  input: { label: string; source: SnapshotSource },
): Snapshot {
  const createdAt = new Date().toISOString();
  const id = 'snap-' + randomBytes(6).toString('hex');

  let tables: Tables;
  if (input.source === 'BASELINE') {
    const model = getBaselineModel(db, configId);
    // No deployed baseline: capture an empty snapshot rather than throwing —
    // the snapshot still records the fact that nothing had been deployed.
    tables = model ? serializeBaseline(model, configId) : emptyTables();
  } else {
    tables = captureRows(db, configId);
  }

  const blob: SnapshotBlob = { label: input.label, createdAt, source: input.source, tables };
  db.prepare(
    'INSERT INTO snapshots (id, configurationId, data, createdAt, label) VALUES (?, ?, ?, ?, ?)',
  ).run(id, configId, JSON.stringify(blob), createdAt, input.label);

  return toMeta({ id, configurationId: configId, data: '', createdAt, label: input.label }, blob);
}

export function listSnapshots(db: Database.Database, configId: string): Snapshot[] {
  const rows = db.prepare(
    'SELECT id, configurationId, data, createdAt, label FROM snapshots WHERE configurationId = ? ORDER BY createdAt DESC',
  ).all(configId) as SnapshotDbRow[];
  return rows.map((r) => toMeta(r, JSON.parse(r.data) as SnapshotBlob));
}

export function getSnapshotMeta(db: Database.Database, id: string): Snapshot | null {
  const row = db.prepare(
    'SELECT id, configurationId, data, createdAt, label FROM snapshots WHERE id = ?',
  ).get(id) as SnapshotDbRow | undefined;
  if (!row) return null;
  return toMeta(row, JSON.parse(row.data) as SnapshotBlob);
}

export function restoreSnapshot(db: Database.Database, id: string): { restored: true } | null {
  const row = db.prepare('SELECT configurationId, data FROM snapshots WHERE id = ?').get(id) as
    | { configurationId: string; data: string }
    | undefined;
  if (!row) return null;

  const blob = JSON.parse(row.data) as SnapshotBlob;
  const configId = row.configurationId;

  // One transaction: delete the config's rows (children first), then re-INSERT
  // the stored rows verbatim (parents first). A mid-restore failure rolls the
  // whole thing back — the config's live definition is never left half-replaced.
  const tx = db.transaction(() => {
    for (const spec of [...TABLE_SPECS].reverse()) {
      db.prepare(deleteSql(spec)).run(configId);
    }
    for (const spec of TABLE_SPECS) {
      insertRows(db, spec.name, blob.tables[spec.name] ?? []);
    }
  });
  tx();

  return { restored: true };
}

export function deleteSnapshot(db: Database.Database, id: string): { deleted: true } | null {
  const info = db.prepare('DELETE FROM snapshots WHERE id = ?').run(id);
  return info.changes > 0 ? { deleted: true } : null;
}
