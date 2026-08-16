import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import type {
  Configuration,
  View,
  Zone,
  ResourceRecord,
  ExternalHost,
  Acl,
  AclEntry,
  AclEntryType,
  TsigKey,
  TsigAlgorithm,
  ServerGroup,
  ListEnvelope,
  RecordType,
  SyncState,
  OptionScope,
  DeploymentOptionRow,
  DeploymentRoleRow,
} from '../../../shared/entities';
import type { Server, ServerRole, DeploymentRole, DeploymentOption, ConfigModel } from '../config-engine/model';

export interface ZoneFilters {
  view?: string;
  type?: string;
  status?: string;
  q?: string;
  page?: number;
  size?: number;
  sort?: string;
}

export interface RecordFilters {
  type?: string;
  status?: string;
  q?: string;
  page?: number;
  size?: number;
  sort?: string;
}

export interface CreateRecordInput {
  id?: string;
  name: string;
  type: RecordType;
  ttl?: number;
  rdata: Record<string, unknown>;
  disabled?: boolean;
  syncState?: SyncState;
  issue?: string | null;
}

function compareValues(a: any, b: any): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function sortItems<T extends Record<string, any>>(items: T[], sort?: string): T[] {
  if (!sort || typeof sort !== 'string') return items;
  const [field, dir = 'asc'] = sort.split(':');
  if (!field) return items;
  const isDesc = dir.toLowerCase() === 'desc';
  return [...items].sort((a, b) => {
    const res = compareValues(a[field], b[field]);
    return isDesc ? -res : res;
  });
}

/**
 * Live per-configuration object counts. The stored `counts` on a Configuration
 * is a seed-time snapshot that goes stale as objects are created/deleted, so we
 * recompute from the entity tables on every read. Records have no configId
 * column, so they are counted through their zone.
 */
function computeConfigCounts(
  db: Database.Database,
  configId: string,
): Configuration['counts'] {
  const count = (sql: string): number =>
    (db.prepare(sql).get(configId) as { c: number }).c;
  return {
    views: count('SELECT COUNT(*) AS c FROM views WHERE configurationId = ?'),
    zones: count('SELECT COUNT(*) AS c FROM zones WHERE configurationId = ?'),
    servers: count('SELECT COUNT(*) AS c FROM servers WHERE configurationId = ?'),
    records: count(
      'SELECT COUNT(*) AS c FROM records WHERE zoneId IN (SELECT id FROM zones WHERE configurationId = ?)',
    ),
  };
}

/**
 * List all configurations, each with live object counts.
 */
export function listConfigurations(db: Database.Database): Configuration[] {
  const rows = db.prepare('SELECT data FROM configurations').all() as { data: string }[];
  return rows.map((r) => {
    const config = JSON.parse(r.data) as Configuration;
    return { ...config, counts: computeConfigCounts(db, config.id) };
  });
}

/**
 * Get configuration by ID, with live object counts.
 */
export function getConfiguration(db: Database.Database, id: string): Configuration | null {
  const row = db.prepare('SELECT data FROM configurations WHERE id = ?').get(id) as { data: string } | undefined;
  if (!row) return null;
  const config = JSON.parse(row.data) as Configuration;
  return { ...config, counts: computeConfigCounts(db, id) };
}

/**
 * Create a new configuration. An explicit valid id is honored; otherwise a
 * server-generated 'cfg-' + 6 random bytes is used.
 */
export function createConfiguration(
  db: Database.Database,
  input: { name: string; id?: string }
): Configuration {
  const id =
    input.id && /^[A-Za-z0-9._-]+$/.test(input.id)
      ? input.id
      : 'cfg-' + randomBytes(6).toString('hex');
  const now = new Date().toISOString();
  const config: Configuration = {
    id,
    name: input.name,
    isActive: true,
    createdFromTemplateId: null,
    createdAt: now,
    updatedAt: now,
    counts: { views: 0, zones: 0, records: 0, servers: 0 },
  };
  db.prepare('INSERT INTO configurations (id, data) VALUES (?, ?)').run(id, JSON.stringify(config));
  return config;
}

/**
 * Update a configuration. name/isActive merge over the stored record;
 * id, createdAt and counts are immutable; updatedAt is stamped fresh.
 */
export function updateConfiguration(
  db: Database.Database,
  id: string,
  patch: { name?: string; isActive?: boolean }
): Configuration {
  const existing = getConfiguration(db, id);
  if (!existing) {
    throw new Error(`Configuration ${id} not found`);
  }
  const updated: Configuration = {
    ...existing,
    id: existing.id,
    createdAt: existing.createdAt,
    counts: existing.counts,
    name: typeof patch.name === 'string' ? patch.name : existing.name,
    isActive: patch.isActive !== undefined ? Boolean(patch.isActive) : existing.isActive,
    updatedAt: new Date().toISOString(),
  };
  db.prepare('UPDATE configurations SET data = ? WHERE id = ?').run(JSON.stringify(updated), id);
  return updated;
}

/**
 * Delete a configuration. Child rows (views/zones/records/servers/acls/
 * external_hosts/tsig_keys/server_groups/deployment_options/deployment_roles)
 * cascade via their FKs (PRAGMA foreign_keys is ON in openDb).
 */
export function deleteConfiguration(db: Database.Database, id: string): { deleted: true } {
  db.prepare('DELETE FROM configurations WHERE id = ?').run(id);
  return { deleted: true };
}

/**
 * List views for a configuration.
 */
export function listViews(db: Database.Database, configId: string): View[] {
  const rows = db.prepare('SELECT data FROM views WHERE configurationId = ?').all(configId) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as View);
}

/**
 * Get view by ID.
 */
export function getView(db: Database.Database, id: string): View | null {
  const row = db.prepare('SELECT data FROM views WHERE id = ?').get(id) as { data: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.data) as View;
}

/**
 * Create a new view for a configuration.
 */
export function createView(db: Database.Database, configId: string, input: { name: string; order?: number; matchClients?: string[] }): View {
  const view: View = {
    id: 'view-' + randomBytes(6).toString('hex'),
    configurationId: configId,
    name: input.name,
    order: typeof input.order === 'number' ? input.order : listViews(db, configId).length,
    matchClients: Array.isArray(input.matchClients) ? input.matchClients.filter((c) => typeof c === 'string') : [],
    zoneCount: 0,
  };
  db.prepare('INSERT INTO views (id, configurationId, data) VALUES (?, ?, ?)').run(view.id, configId, JSON.stringify(view));
  return view;
}

/**
 * Update an existing view.
 */
export function updateView(db: Database.Database, id: string, patch: Partial<View>): View {
  const existing = getView(db, id);
  if (!existing) {
    throw new Error(`View ${id} not found`);
  }

  const updated: View = {
    ...existing,
    ...patch,
    id: existing.id,
    configurationId: existing.configurationId,
  };

  db.prepare('UPDATE views SET configurationId = ?, data = ? WHERE id = ?').run(
    updated.configurationId,
    JSON.stringify(updated),
    id
  );

  return updated;
}

/**
 * Delete a view by ID.
 */
export function deleteView(db: Database.Database, id: string): { deleted: true } {
  db.prepare('DELETE FROM views WHERE id = ?').run(id);
  return { deleted: true };
}

const ACL_ENTRY_TYPES: readonly string[] = ['ADDRESS', 'CIDR', 'ACL_NAME', 'KEY_NAME', 'ANY', 'NONE', 'LOCALHOST', 'LOCALNETS'];

/**
 * Normalize raw ACL entry input into stored AclEntry[]: coerce to an array,
 * assign ids/order, drop entries with an unknown type, coerce negated/value.
 */
function normalizeAclEntries(input: unknown): AclEntry[] {
  if (!Array.isArray(input)) return [];
  const entries: AclEntry[] = [];
  let order = 0;
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.type !== 'string' || !ACL_ENTRY_TYPES.includes(r.type)) continue;
    entries.push({
      id: typeof r.id === 'string' && r.id ? r.id : 'ae-' + randomBytes(4).toString('hex'),
      order,
      type: r.type as AclEntryType,
      value: typeof r.value === 'string' ? r.value : null,
      negated: Boolean(r.negated),
    });
    order++;
  }
  return entries;
}

/**
 * List ACLs for a configuration.
 */
export function listAcls(db: Database.Database, configId: string): Acl[] {
  const rows = db.prepare('SELECT data FROM acls WHERE configurationId = ?').all(configId) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Acl);
}

/**
 * Get ACL by ID.
 */
export function getAcl(db: Database.Database, id: string): Acl | null {
  const row = db.prepare('SELECT data FROM acls WHERE id = ?').get(id) as { data: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.data) as Acl;
}

/**
 * Create a new ACL for a configuration.
 */
export function createAcl(db: Database.Database, configId: string, input: { name: string; entries?: unknown }): Acl {
  const acl: Acl = {
    id: 'acl-' + randomBytes(6).toString('hex'),
    configurationId: configId,
    name: input.name,
    entries: normalizeAclEntries(input.entries),
    usedByCount: 0,
  };
  db.prepare('INSERT INTO acls (id, configurationId, data) VALUES (?, ?, ?)').run(acl.id, configId, JSON.stringify(acl));
  return acl;
}

/**
 * Update an existing ACL.
 */
export function updateAcl(db: Database.Database, id: string, patch: { name?: string; entries?: unknown }): Acl {
  const existing = getAcl(db, id);
  if (!existing) {
    throw new Error(`Acl ${id} not found`);
  }

  const updated: Acl = {
    ...existing,
    id: existing.id,
    configurationId: existing.configurationId,
    name: typeof patch.name === 'string' ? patch.name : existing.name,
    entries: patch.entries !== undefined ? normalizeAclEntries(patch.entries) : existing.entries,
  };

  db.prepare('UPDATE acls SET configurationId = ?, data = ? WHERE id = ?').run(
    updated.configurationId,
    JSON.stringify(updated),
    id
  );

  return updated;
}

/**
 * Delete an ACL by ID.
 */
export function deleteAcl(db: Database.Database, id: string): { deleted: true } {
  db.prepare('DELETE FROM acls WHERE id = ?').run(id);
  return { deleted: true };
}

export const TSIG_ALGORITHMS: readonly string[] = [
  'hmac-sha256',
  'hmac-sha512',
  'hmac-sha384',
  'hmac-sha224',
  'hmac-sha1',
  'hmac-md5',
];

/** Full stored TSIG key record: every TsigKey field plus the non-optional secret. */
type TsigKeyRecord = TsigKey & { secret: string };

/**
 * Strip the secret from a stored TSIG key. The secret is generated server-side
 * and is only ever returned in the create response; list/get/patch omit it.
 */
function stripTsigSecret(key: TsigKeyRecord): TsigKey {
  const { secret: _secret, ...rest } = key;
  return rest;
}

/**
 * List TSIG keys for a configuration (secret omitted).
 */
export function listTsigKeys(db: Database.Database, configId: string): TsigKey[] {
  const rows = db.prepare('SELECT data FROM tsig_keys WHERE configurationId = ?').all(configId) as { data: string }[];
  return rows.map((r) => stripTsigSecret(JSON.parse(r.data) as TsigKeyRecord));
}

/**
 * Get TSIG key by ID (secret omitted).
 */
export function getTsigKey(db: Database.Database, id: string): TsigKey | null {
  const row = db.prepare('SELECT data FROM tsig_keys WHERE id = ?').get(id) as { data: string } | undefined;
  if (!row) return null;
  return stripTsigSecret(JSON.parse(row.data) as TsigKeyRecord);
}

/**
 * Get TSIG key by ID including the secret. Internal only — used by update to
 * preserve the secret across writes.
 */
export function getTsigKeyWithSecret(db: Database.Database, id: string): TsigKeyRecord | null {
  const row = db.prepare('SELECT data FROM tsig_keys WHERE id = ?').get(id) as { data: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.data) as TsigKeyRecord;
}

/**
 * Create a new TSIG key for a configuration. The secret is generated
 * server-side and returned in the full record — the only response that
 * carries it.
 */
export function createTsigKey(
  db: Database.Database,
  configId: string,
  input: { name: string; algorithm: string }
): TsigKey {
  const key: TsigKeyRecord = {
    id: 'tsig-' + randomBytes(6).toString('hex'),
    configurationId: configId,
    name: input.name,
    algorithm: input.algorithm as TsigAlgorithm,
    secret: randomBytes(32).toString('base64'),
    usedByCount: 0,
  };
  db.prepare('INSERT INTO tsig_keys (id, configurationId, data) VALUES (?, ?, ?)').run(
    key.id,
    configId,
    JSON.stringify(key)
  );
  return key;
}

/**
 * Update an existing TSIG key. name/algorithm merge over the stored record;
 * id, configurationId and secret are immutable. Returns the record without
 * the secret.
 */
export function updateTsigKey(
  db: Database.Database,
  id: string,
  patch: { name?: string; algorithm?: string }
): TsigKey {
  const existing = getTsigKeyWithSecret(db, id);
  if (!existing) {
    throw new Error(`TSIG key ${id} not found`);
  }

  const updated: TsigKeyRecord = {
    ...existing,
    id: existing.id,
    configurationId: existing.configurationId,
    secret: existing.secret,
    name: typeof patch.name === 'string' ? patch.name : existing.name,
    algorithm: (typeof patch.algorithm === 'string' ? patch.algorithm : existing.algorithm) as TsigAlgorithm,
  };

  db.prepare('UPDATE tsig_keys SET configurationId = ?, data = ? WHERE id = ?').run(
    updated.configurationId,
    JSON.stringify(updated),
    id
  );

  return stripTsigSecret(updated);
}

/**
 * Delete a TSIG key by ID.
 */
export function deleteTsigKey(db: Database.Database, id: string): { deleted: true } {
  db.prepare('DELETE FROM tsig_keys WHERE id = ?').run(id);
  return { deleted: true };
}

/**
 * List zones for a configuration with optional filtering, sorting, and pagination.
 */
export function listZones(
  db: Database.Database,
  configId: string,
  filters?: ZoneFilters
): ListEnvelope<Zone> {
  const rows = db.prepare('SELECT data FROM zones WHERE configurationId = ?').all(configId) as { data: string }[];
  let items = rows.map((r) => JSON.parse(r.data) as Zone);

  if (filters?.view) {
    const vFilter = filters.view.toLowerCase();
    items = items.filter(
      (z) => z.viewId.toLowerCase() === vFilter || z.viewId.toLowerCase() === `view-${vFilter}`
    );
  }

  if (filters?.type) {
    const tFilter = filters.type.toUpperCase();
    items = items.filter((z) => z.type.toUpperCase() === tFilter);
  }

  if (filters?.status) {
    const sFilter = filters.status.toUpperCase();
    items = items.filter((z) => z.syncState.toUpperCase() === sFilter);
  }

  if (filters?.q) {
    const qFilter = filters.q.toLowerCase().trim();
    if (qFilter) {
      items = items.filter(
        (z) =>
          z.name.toLowerCase().includes(qFilter) ||
          z.id.toLowerCase().includes(qFilter)
      );
    }
  }

  items = sortItems(items, filters?.sort);

  const total = items.length;
  const page = Math.max(1, Number(filters?.page) || 1);
  const size = Math.max(1, Number(filters?.size) || 50);
  const start = (page - 1) * size;
  const data = items.slice(start, start + size);

  return { data, page, size, total };
}

/**
 * Get zone by ID.
 */
export function getZone(db: Database.Database, id: string): Zone | null {
  const row = db.prepare('SELECT data FROM zones WHERE id = ?').get(id) as { data: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.data) as Zone;
}

/**
 * Create a new zone in a view, bumping the parent view's zoneCount.
 */
export function createZone(
  db: Database.Database,
  configId: string,
  input: { viewId: string; name: string; type?: string; soa?: any; allowTransfer?: string[]; allowUpdate?: string[] }
): Zone {
  const soa = input.soa && typeof input.soa === 'object'
    ? {
        primaryNs: typeof input.soa.primaryNs === 'string' ? input.soa.primaryNs : '',
        adminEmail: typeof input.soa.adminEmail === 'string' ? input.soa.adminEmail : '',
        serial: typeof input.soa.serial === 'number' ? input.soa.serial : 1,
        refresh: typeof input.soa.refresh === 'number' ? input.soa.refresh : 3600,
        retry: typeof input.soa.retry === 'number' ? input.soa.retry : 600,
        expire: typeof input.soa.expire === 'number' ? input.soa.expire : 604800,
        minimum: typeof input.soa.minimum === 'number' ? input.soa.minimum : 3600,
      }
    : { primaryNs: '', adminEmail: '', serial: 1, refresh: 3600, retry: 600, expire: 604800, minimum: 3600 };

  const zone: Zone = {
    id: 'zone-' + randomBytes(6).toString('hex'),
    configurationId: configId,
    viewId: input.viewId,
    name: input.name,
    type: (input.type ?? 'PRIMARY') as Zone['type'],
    soa,
    allowTransfer: Array.isArray(input.allowTransfer) ? input.allowTransfer : undefined,
    allowUpdate: Array.isArray(input.allowUpdate) ? input.allowUpdate : undefined,
    recordCount: 0,
    syncState: 'PENDING',
  };

  const createTx = db.transaction(() => {
    db.prepare('INSERT INTO zones (id, configurationId, viewId, data) VALUES (?, ?, ?, ?)').run(
      zone.id,
      configId,
      input.viewId,
      JSON.stringify(zone)
    );
    const view = getView(db, input.viewId);
    if (view) {
      const cnt = (db.prepare('SELECT count(*) as cnt FROM zones WHERE viewId = ?').get(input.viewId) as { cnt: number }).cnt;
      view.zoneCount = cnt;
      db.prepare('UPDATE views SET data = ? WHERE id = ?').run(JSON.stringify(view), input.viewId);
    }
  });
  createTx();

  return zone;
}

/**
 * Update an existing zone.
 */
export function updateZone(db: Database.Database, id: string, patch: Partial<Zone>): Zone {
  const existing = getZone(db, id);
  if (!existing) {
    throw new Error(`Zone ${id} not found`);
  }

  const updated: Zone = {
    ...existing,
    ...patch,
    id: existing.id,
    configurationId: patch.configurationId ?? existing.configurationId,
    viewId: patch.viewId ?? existing.viewId,
    soa: patch.soa ? { ...existing.soa, ...patch.soa } : existing.soa,
  };

  db.prepare('UPDATE zones SET configurationId = ?, viewId = ?, data = ? WHERE id = ?').run(
    updated.configurationId,
    updated.viewId,
    JSON.stringify(updated),
    id
  );

  return updated;
}

/**
 * Delete a zone and its records, returning dependent record count.
 */
export function deleteZone(
  db: Database.Database,
  id: string
): { deleted: true; dependents: number } {
  const existing = getZone(db, id);
  if (!existing) {
    throw new Error(`Zone ${id} not found`);
  }

  const countRow = db.prepare('SELECT count(*) as cnt FROM records WHERE zoneId = ?').get(id) as { cnt: number } | undefined;
  const dependents = countRow ? countRow.cnt : 0;

  const deleteTx = db.transaction(() => {
    db.prepare('DELETE FROM records WHERE zoneId = ?').run(id);
    db.prepare('DELETE FROM zones WHERE id = ?').run(id);
  });
  deleteTx();

  return { deleted: true, dependents };
}

/**
 * List records for a zone with optional filtering, sorting, and pagination.
 */
export function listRecords(
  db: Database.Database,
  zoneId: string,
  filters?: RecordFilters
): ListEnvelope<ResourceRecord> {
  const rows = db.prepare('SELECT data FROM records WHERE zoneId = ?').all(zoneId) as { data: string }[];
  let items = rows.map((r) => JSON.parse(r.data) as ResourceRecord);

  if (filters?.type) {
    const tFilter = filters.type.toUpperCase();
    items = items.filter((r) => r.type.toUpperCase() === tFilter);
  }

  if (filters?.status) {
    const sFilter = filters.status.toUpperCase();
    items = items.filter((r) => r.syncState.toUpperCase() === sFilter);
  }

  if (filters?.q) {
    const qFilter = filters.q.toLowerCase().trim();
    if (qFilter) {
      items = items.filter((r) => {
        const rdataValues = r.rdata ? Object.values(r.rdata).join(' ') : '';
        const searchable = `${r.name} ${r.id} ${rdataValues}`.toLowerCase();
        return searchable.includes(qFilter);
      });
    }
  }

  items = sortItems(items, filters?.sort);

  const total = items.length;
  const page = Math.max(1, Number(filters?.page) || 1);
  const size = Math.max(1, Number(filters?.size) || 50);
  const start = (page - 1) * size;
  const data = items.slice(start, start + size);

  return { data, page, size, total };
}

/**
 * Get record by ID.
 */
export function getRecord(db: Database.Database, id: string): ResourceRecord | null {
  const row = db.prepare('SELECT data FROM records WHERE id = ?').get(id) as { data: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.data) as ResourceRecord;
}

function nextRecordId(db: Database.Database): string {
  const rows = db.prepare('SELECT id FROM records').all() as { id: string }[];
  let max = 0;
  for (const row of rows) {
    const match = /^rec-(\d+)$/.exec(row.id);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > max) max = num;
    }
  }
  return `rec-${max + 1}`;
}

/**
 * Create a new record in a zone.
 */
export function createRecord(
  db: Database.Database,
  zoneId: string,
  input: CreateRecordInput
): ResourceRecord {
  const zone = getZone(db, zoneId);
  if (!zone) {
    throw new Error(`Zone ${zoneId} not found`);
  }

  const record: ResourceRecord = {
    id: input.id || nextRecordId(db),
    zoneId,
    name: input.name,
    type: input.type,
    ttl: input.ttl ?? 3600,
    rdata: input.rdata ?? {},
    disabled: Boolean(input.disabled),
    syncState: input.syncState ?? 'PENDING',
    issue: input.issue ?? null,
  };

  const createTx = db.transaction(() => {
    db.prepare('INSERT INTO records (id, zoneId, data) VALUES (?, ?, ?)').run(
      record.id,
      zoneId,
      JSON.stringify(record)
    );
    const cnt = (db.prepare('SELECT count(*) as cnt FROM records WHERE zoneId = ?').get(zoneId) as { cnt: number }).cnt;
    zone.recordCount = cnt;
    db.prepare('UPDATE zones SET data = ? WHERE id = ?').run(JSON.stringify(zone), zoneId);
  });
  createTx();

  return record;
}

/**
 * Update an existing record.
 */
export function updateRecord(
  db: Database.Database,
  id: string,
  patch: Partial<ResourceRecord>
): ResourceRecord {
  const existing = getRecord(db, id);
  if (!existing) {
    throw new Error(`Record ${id} not found`);
  }

  const oldZoneId = existing.zoneId;
  const newZoneId = patch.zoneId ?? existing.zoneId;

  const updated: ResourceRecord = {
    ...existing,
    ...patch,
    id: existing.id,
    zoneId: newZoneId,
    rdata: patch.rdata ? { ...existing.rdata, ...patch.rdata } : existing.rdata,
  };

  const updateTx = db.transaction(() => {
    db.prepare('UPDATE records SET zoneId = ?, data = ? WHERE id = ?').run(
      updated.zoneId,
      JSON.stringify(updated),
      id
    );

    if (oldZoneId !== newZoneId) {
      const oldZone = getZone(db, oldZoneId);
      if (oldZone) {
        const cnt = (db.prepare('SELECT count(*) as cnt FROM records WHERE zoneId = ?').get(oldZoneId) as { cnt: number }).cnt;
        oldZone.recordCount = cnt;
        db.prepare('UPDATE zones SET data = ? WHERE id = ?').run(JSON.stringify(oldZone), oldZoneId);
      }
      const newZone = getZone(db, newZoneId);
      if (newZone) {
        const cnt = (db.prepare('SELECT count(*) as cnt FROM records WHERE zoneId = ?').get(newZoneId) as { cnt: number }).cnt;
        newZone.recordCount = cnt;
        db.prepare('UPDATE zones SET data = ? WHERE id = ?').run(JSON.stringify(newZone), newZoneId);
      }
    }
  });
  updateTx();

  return updated;
}

/**
 * Delete a record by ID.
 */
export function deleteRecord(
  db: Database.Database,
  id: string
): { deleted: true } {
  const existing = getRecord(db, id);
  if (!existing) {
    throw new Error(`Record ${id} not found`);
  }

  const deleteTx = db.transaction(() => {
    db.prepare('DELETE FROM records WHERE id = ?').run(id);
    const zone = getZone(db, existing.zoneId);
    if (zone) {
      const cnt = (db.prepare('SELECT count(*) as cnt FROM records WHERE zoneId = ?').get(existing.zoneId) as { cnt: number }).cnt;
      zone.recordCount = cnt;
      db.prepare('UPDATE zones SET data = ? WHERE id = ?').run(JSON.stringify(zone), existing.zoneId);
    }
  });
  deleteTx();

  return { deleted: true };
}

/**
 * List external hosts for a configuration.
 */
export function listExternalHosts(
  db: Database.Database,
  configId: string
): ExternalHost[] {
  const rows = db.prepare('SELECT data FROM external_hosts WHERE configurationId = ?').all(configId) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as ExternalHost);
}

/**
 * Get external host by ID.
 */
export function getExternalHost(
  db: Database.Database,
  id: string
): ExternalHost | null {
  const row = db.prepare('SELECT data FROM external_hosts WHERE id = ?').get(id) as { data: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.data) as ExternalHost;
}

/**
 * Create a new external host for a configuration.
 */
export function createExternalHost(
  db: Database.Database,
  configId: string,
  input: { fqdn: string }
): ExternalHost {
  const host: ExternalHost = {
    id: 'eh-' + randomBytes(6).toString('hex'),
    configurationId: configId,
    fqdn: input.fqdn,
    referenceCount: 0,
  };
  db.prepare('INSERT INTO external_hosts (id, configurationId, data) VALUES (?, ?, ?)').run(
    host.id,
    configId,
    JSON.stringify(host)
  );
  return host;
}

/**
 * Update an existing external host.
 */
export function updateExternalHost(
  db: Database.Database,
  id: string,
  patch: { fqdn?: string }
): ExternalHost {
  const existing = getExternalHost(db, id);
  if (!existing) {
    throw new Error(`External host ${id} not found`);
  }

  const updated: ExternalHost = {
    ...existing,
    ...patch,
    id: existing.id,
    configurationId: existing.configurationId,
  };

  db.prepare('UPDATE external_hosts SET configurationId = ?, data = ? WHERE id = ?').run(
    updated.configurationId,
    JSON.stringify(updated),
    id
  );

  return updated;
}

/**
 * Delete an external host by ID.
 */
export function deleteExternalHost(db: Database.Database, id: string): { deleted: true } {
  db.prepare('DELETE FROM external_hosts WHERE id = ?').run(id);
  return { deleted: true };
}

/**
 * Live member count for a server group: servers in the config whose
 * serverGroupId equals the group id. Not stored — recomputed on every read.
 */
function memberCountForGroup(db: Database.Database, configId: string, groupId: string): number {
  return listServers(db, configId).filter((s) => s.serverGroupId === groupId).length;
}

/**
 * List server groups for a configuration.
 */
export function listServerGroups(db: Database.Database, configId: string): ServerGroup[] {
  const rows = db.prepare('SELECT data FROM server_groups WHERE configurationId = ?').all(configId) as { data: string }[];
  return rows.map((r) => {
    const g = JSON.parse(r.data) as ServerGroup;
    return { ...g, memberCount: memberCountForGroup(db, configId, g.id) };
  });
}

/**
 * Get server group by ID.
 */
export function getServerGroup(db: Database.Database, id: string): ServerGroup | null {
  const row = db.prepare('SELECT data FROM server_groups WHERE id = ?').get(id) as { data: string } | undefined;
  if (!row) return null;
  const g = JSON.parse(row.data) as ServerGroup;
  return { ...g, memberCount: memberCountForGroup(db, g.configurationId, g.id) };
}

/**
 * Create a new server group for a configuration.
 */
export function createServerGroup(
  db: Database.Database,
  configId: string,
  input: { name: string; description?: string }
): ServerGroup {
  const group: ServerGroup = {
    id: 'sg-' + randomBytes(6).toString('hex'),
    configurationId: configId,
    name: input.name,
    description: input.description,
    memberCount: 0,
  };
  db.prepare('INSERT INTO server_groups (id, configurationId, data) VALUES (?, ?, ?)').run(
    group.id,
    configId,
    JSON.stringify(group)
  );
  return { ...group, memberCount: memberCountForGroup(db, configId, group.id) };
}

/**
 * Update an existing server group.
 */
export function updateServerGroup(
  db: Database.Database,
  id: string,
  patch: { name?: string; description?: string }
): ServerGroup {
  const existing = getServerGroup(db, id);
  if (!existing) {
    throw new Error(`Server group ${id} not found`);
  }

  const updated: ServerGroup = {
    ...existing,
    id: existing.id,
    configurationId: existing.configurationId,
    name: typeof patch.name === 'string' ? patch.name : existing.name,
    description: patch.description !== undefined ? patch.description : existing.description,
  };

  db.prepare('UPDATE server_groups SET configurationId = ?, data = ? WHERE id = ?').run(
    updated.configurationId,
    JSON.stringify(updated),
    id
  );

  return { ...updated, memberCount: memberCountForGroup(db, updated.configurationId, id) };
}

/**
 * Delete a server group by ID.
 */
export function deleteServerGroup(db: Database.Database, id: string): { deleted: true } {
  db.prepare('DELETE FROM server_groups WHERE id = ?').run(id);
  return { deleted: true };
}

/**
 * List servers for a configuration.
 */
export function listServers(db: Database.Database, configId: string): Server[] {
  const rows = db.prepare('SELECT data FROM servers WHERE configurationId = ?').all(configId) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Server);
}

/**
 * Get server by ID.
 */
export function getServer(db: Database.Database, id: string): Server | null {
  const row = db.prepare('SELECT data FROM servers WHERE id = ?').get(id) as { data: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.data) as Server;
}

/**
 * Upsert a server.
 */
export function upsertServer(db: Database.Database, server: Server & { configurationId?: string }): void {
  const id = server.id;
  const configurationId = (server as any).configurationId || '';
  db.prepare(`
    INSERT INTO servers (id, configurationId, data)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET configurationId = excluded.configurationId, data = excluded.data
  `).run(id, configurationId, JSON.stringify(server));
}

/**
 * Delete a server by ID.
 */
export function deleteServerById(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM servers WHERE id = ?').run(id);
}

/**
 * Delete server(s) matching a configurationId and nodeName.
 */
export function deleteServerByNode(db: Database.Database, configId: string, nodeName: string): void {
  const rows = db.prepare('SELECT id, data FROM servers WHERE configurationId = ?').all(configId) as { id: string; data: string }[];
  const delStmt = db.prepare('DELETE FROM servers WHERE id = ?');
  for (const r of rows) {
    try {
      const s = JSON.parse(r.data);
      if (s.nodeName === nodeName) {
        delStmt.run(r.id);
      }
    } catch {
      // ignore invalid json
    }
  }
}

interface DeploymentOptionDbRow {
  id: string;
  configurationId: string;
  scopeType: string;
  scopeId: string;
  key: string;
  value: string | null;
  disabled: number;
}

function optionRowToModel(row: DeploymentOptionDbRow): DeploymentOptionRow {
  return {
    id: row.id,
    configurationId: row.configurationId,
    scope: row.scopeType as OptionScope,
    scopeId: row.scopeId,
    key: row.key,
    value: row.value === null ? null : JSON.parse(row.value),
    disabled: Boolean(row.disabled),
  };
}

export function getDeploymentOption(db: Database.Database, id: string): DeploymentOptionRow | null {
  const row = db.prepare('SELECT id, configurationId, scopeType, scopeId, key, value, disabled FROM deployment_options WHERE id = ?').get(id) as DeploymentOptionDbRow | undefined;
  if (!row) return null;
  return optionRowToModel(row);
}

/**
 * List deployment options for a configuration.
 */
export function listDeploymentOptions(db: Database.Database, configId: string): DeploymentOptionRow[] {
  const rows = db.prepare('SELECT id, configurationId, scopeType, scopeId, key, value, disabled FROM deployment_options WHERE configurationId = ?').all(configId) as DeploymentOptionDbRow[];
  return rows.map(optionRowToModel);
}

/**
 * Create a deployment option for a configuration.
 */
export function createDeploymentOption(
  db: Database.Database,
  configId: string,
  input: { scope: OptionScope; scopeId: string; key: string; value: unknown; disabled?: boolean },
): DeploymentOptionRow {
  const option: DeploymentOptionRow = {
    id: 'do-' + randomBytes(6).toString('hex'),
    configurationId: configId,
    scope: input.scope,
    scopeId: input.scopeId,
    key: input.key,
    value: input.value ?? null,
    disabled: Boolean(input.disabled),
  };
  db.prepare(`
    INSERT INTO deployment_options (id, configurationId, scopeType, scopeId, key, value, disabled)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    option.id,
    configId,
    option.scope,
    option.scopeId,
    option.key,
    JSON.stringify(option.value),
    option.disabled ? 1 : 0,
  );
  return option;
}

/**
 * Update an existing deployment option.
 */
export function updateDeploymentOption(
  db: Database.Database,
  id: string,
  patch: { scope?: OptionScope; scopeId?: string; key?: string; value?: unknown; disabled?: boolean },
): DeploymentOptionRow {
  const existing = getDeploymentOption(db, id);
  if (!existing) {
    throw new Error(`Deployment option ${id} not found`);
  }

  const updated: DeploymentOptionRow = {
    ...existing,
    scope: patch.scope ?? existing.scope,
    scopeId: patch.scopeId ?? existing.scopeId,
    key: patch.key ?? existing.key,
    value: patch.value !== undefined ? patch.value : existing.value,
    disabled: patch.disabled !== undefined ? Boolean(patch.disabled) : existing.disabled,
  };

  db.prepare(`
    UPDATE deployment_options
    SET scopeType = ?, scopeId = ?, key = ?, value = ?, disabled = ?
    WHERE id = ?
  `).run(
    updated.scope,
    updated.scopeId,
    updated.key,
    JSON.stringify(updated.value),
    updated.disabled ? 1 : 0,
    id,
  );
  return updated;
}

/**
 * Delete a deployment option by ID.
 */
export function deleteDeploymentOption(db: Database.Database, id: string): { deleted: true } {
  db.prepare('DELETE FROM deployment_options WHERE id = ?').run(id);
  return { deleted: true };
}

interface DeploymentRoleDbRow {
  id: string;
  configurationId: string;
  scopeType: string;
  scopeId: string;
  serverId: string;
  role: string;
  disabled: number;
}

function roleRowToModel(row: DeploymentRoleDbRow): DeploymentRoleRow {
  return {
    id: row.id,
    configurationId: row.configurationId,
    scope: row.scopeType as OptionScope,
    scopeId: row.scopeId,
    serverId: row.serverId,
    role: row.role,
    disabled: Boolean(row.disabled),
  };
}

export function getDeploymentRole(db: Database.Database, id: string): DeploymentRoleRow | null {
  const row = db.prepare('SELECT id, configurationId, scopeType, scopeId, serverId, role, disabled FROM deployment_roles WHERE id = ?').get(id) as DeploymentRoleDbRow | undefined;
  if (!row) return null;
  return roleRowToModel(row);
}

/**
 * List deployment roles for a configuration.
 */
export function listDeploymentRoles(db: Database.Database, configId: string): DeploymentRoleRow[] {
  const rows = db.prepare('SELECT id, configurationId, scopeType, scopeId, serverId, role, disabled FROM deployment_roles WHERE configurationId = ?').all(configId) as DeploymentRoleDbRow[];
  return rows.map(roleRowToModel);
}

/**
 * Create a deployment role for a configuration.
 */
export function createDeploymentRole(
  db: Database.Database,
  configId: string,
  input: { scope: OptionScope; scopeId: string; serverId: string; role: string; disabled?: boolean },
): DeploymentRoleRow {
  const roleRow: DeploymentRoleRow = {
    id: 'dr-' + randomBytes(6).toString('hex'),
    configurationId: configId,
    scope: input.scope,
    scopeId: input.scopeId,
    serverId: input.serverId,
    role: input.role,
    disabled: Boolean(input.disabled),
  };
  db.prepare(`
    INSERT INTO deployment_roles (id, configurationId, scopeType, scopeId, serverId, role, disabled)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    roleRow.id,
    configId,
    roleRow.scope,
    roleRow.scopeId,
    roleRow.serverId,
    roleRow.role,
    roleRow.disabled ? 1 : 0,
  );
  return roleRow;
}

/**
 * Update an existing deployment role.
 */
export function updateDeploymentRole(
  db: Database.Database,
  id: string,
  patch: { scope?: OptionScope; scopeId?: string; serverId?: string; role?: string; disabled?: boolean },
): DeploymentRoleRow {
  const existing = getDeploymentRole(db, id);
  if (!existing) {
    throw new Error(`Deployment role ${id} not found`);
  }

  const updated: DeploymentRoleRow = {
    ...existing,
    scope: patch.scope ?? existing.scope,
    scopeId: patch.scopeId ?? existing.scopeId,
    serverId: patch.serverId ?? existing.serverId,
    role: patch.role ?? existing.role,
    disabled: patch.disabled !== undefined ? Boolean(patch.disabled) : existing.disabled,
  };

  db.prepare(`
    UPDATE deployment_roles
    SET scopeType = ?, scopeId = ?, serverId = ?, role = ?, disabled = ?
    WHERE id = ?
  `).run(
    updated.scope,
    updated.scopeId,
    updated.serverId,
    updated.role,
    updated.disabled ? 1 : 0,
    id,
  );
  return updated;
}

/**
 * Delete a deployment role by ID.
 */
export function deleteDeploymentRole(db: Database.Database, id: string): { deleted: true } {
  db.prepare('DELETE FROM deployment_roles WHERE id = ?').run(id);
  return { deleted: true };
}

/**
 * Assemble a ConfigModel from the entity store for a configuration.
 */
export function buildConfigModel(db: Database.Database, configId: string): ConfigModel {
  const configuration = getConfiguration(db, configId);
  if (!configuration) {
    throw new Error(`Configuration ${configId} not found`);
  }

  const views = listViews(db, configId);

  const zoneRows = db.prepare('SELECT data FROM zones WHERE configurationId = ?').all(configId) as { data: string }[];
  const zones = zoneRows.map((r) => JSON.parse(r.data) as Zone);

  const recordRows = db.prepare(`
    SELECT r.data FROM records r
    JOIN zones z ON r.zoneId = z.id
    WHERE z.configurationId = ?
  `).all(configId) as { data: string }[];
  const records = recordRows.map((r) => JSON.parse(r.data) as ResourceRecord);

  const servers = listServers(db, configId);
  const externalHosts = listExternalHosts(db, configId);
  const acls = listAcls(db, configId);

  const options: DeploymentOption[] = listDeploymentOptions(db, configId).map((row) => ({
    id: row.id,
    scopeType: row.scope,
    scopeId: row.scopeId,
    key: row.key,
    value: row.value,
    disabled: row.disabled,
  }));

  // Synthesize a VIEW-scope match-clients option from each view's matchClients
  // field unless an explicit deployment_options row already provides it
  // (explicit rows win). Empty/undefined matchClients synthesize nothing; the
  // renderer's existing ['any'] fallback covers that case.
  for (const view of views) {
    const hasExplicit = options.some(
      (o) => o.scopeType === 'VIEW' && o.scopeId === view.id && o.key === 'match-clients',
    );
    if (!hasExplicit && view.matchClients && view.matchClients.length > 0) {
      options.push({
        scopeType: 'VIEW',
        scopeId: view.id,
        key: 'match-clients',
        value: view.matchClients,
        disabled: false,
      });
    }
  }

  // Raw explicit VIEW/ZONE role rows (each with id) are the diffable form the
  // change set uses. `roles` below is the flattened per-zone render matrix:
  // a VIEW row inherits to every zone in the view; a ZONE row overrides it for
  // its zone; a ZONE disabled row suppresses the role for that zone entirely.
  const roleRows = listDeploymentRoles(db, configId);

  const roles: DeploymentRole[] = [];
  for (const zone of zones) {
    const zoneRows = roleRows.filter((r) => r.scope === 'ZONE' && r.scopeId === zone.id);
    const viewRows = roleRows.filter((r) => r.scope === 'VIEW' && r.scopeId === zone.viewId);
    const candidateServerIds = new Set<string>([
      ...zoneRows.map((r) => r.serverId),
      ...viewRows.map((r) => r.serverId),
    ]);
    for (const serverId of candidateServerIds) {
      const zoneRow = zoneRows.find((r) => r.serverId === serverId);
      if (zoneRow) {
        if (zoneRow.disabled) continue; // explicit suppress beats view inheritance
        roles.push({ serverId, zoneId: zone.id, role: zoneRow.role as ServerRole });
        continue;
      }
      const viewRow = viewRows.find((r) => r.serverId === serverId);
      if (viewRow && !viewRow.disabled) {
        roles.push({ serverId, zoneId: zone.id, role: viewRow.role as ServerRole });
      }
    }
  }

  return {
    configuration,
    views,
    zones,
    records,
    servers,
    acls,
    roles,
    roleRows,
    options,
    externalHosts,
  };
}

/**
 * Remap a deployment_options/deployment_roles scopeId through the id map that
 * matches its scopeType. Returns undefined for an unmapped (dangling) source
 * id or an unrecognized scopeType, so the caller can skip the row rather than
 * copy a reference that points nowhere in the clone.
 */
function remapScopeId(
  scopeType: string,
  scopeId: string,
  maps: {
    newConfigId: string;
    viewIdMap: Map<string, string>;
    zoneIdMap: Map<string, string>;
    serverIdMap: Map<string, string>;
    groupIdMap: Map<string, string>;
  },
): string | undefined {
  switch (scopeType) {
    case 'CONFIGURATION':
      return maps.newConfigId;
    case 'VIEW':
      return maps.viewIdMap.get(scopeId);
    case 'ZONE':
      return maps.zoneIdMap.get(scopeId);
    case 'SERVER':
      return maps.serverIdMap.get(scopeId);
    case 'SERVER_GROUP':
      return maps.groupIdMap.get(scopeId);
    default:
      return undefined;
  }
}

/**
 * Deep-copy a configuration's entire entity tree (server groups, servers,
 * views, zones, records, acls, tsig keys, external hosts, deployment options,
 * deployment roles) into a brand-new configuration with fresh ids, remapping
 * every cross-reference to the new ids. Labs, deploy jobs and deployed
 * baselines are runtime/lab state, not part of a config's DNS definition, and
 * are intentionally NOT cloned.
 *
 * Copy order matters: parents are copied (and their id maps built) before the
 * children that reference them. The whole copy runs in one transaction, so a
 * failure partway through leaves neither the new configuration nor any of its
 * partial entities behind.
 */
export function cloneConfiguration(
  db: Database.Database,
  sourceConfigId: string,
  newName: string,
): Configuration {
  const source = getConfiguration(db, sourceConfigId);
  if (!source) {
    throw new Error(`Configuration ${sourceConfigId} not found`);
  }

  const cloneTx = db.transaction((): Configuration => {
    const newConfig = createConfiguration(db, { name: newName });
    const newConfigId = newConfig.id;

    const groupIdMap = new Map<string, string>();
    for (const group of listServerGroups(db, sourceConfigId)) {
      const copy = createServerGroup(db, newConfigId, { name: group.name, description: group.description });
      groupIdMap.set(group.id, copy.id);
    }

    // No createServer(): servers are otherwise only ever upserted by lab
    // reconciliation with a caller-supplied id, so the fresh id is minted here.
    const serverIdMap = new Map<string, string>();
    for (const server of listServers(db, sourceConfigId)) {
      const newServerId = 'srv-' + randomBytes(6).toString('hex');
      const clonedServer: Server & { configurationId: string } = {
        ...(JSON.parse(JSON.stringify(server)) as Server),
        id: newServerId,
        configurationId: newConfigId,
        serverGroupId:
          typeof server.serverGroupId === 'string' ? groupIdMap.get(server.serverGroupId) : undefined,
      };
      upsertServer(db, clonedServer);
      serverIdMap.set(server.id, newServerId);
    }

    const viewIdMap = new Map<string, string>();
    for (const view of listViews(db, sourceConfigId)) {
      const copy = createView(db, newConfigId, { name: view.name, order: view.order, matchClients: view.matchClients });
      viewIdMap.set(view.id, copy.id);
    }

    // Raw select, not listZones(): listZones returns a paginated envelope
    // (default page size 50) and a clone must copy every zone.
    const zoneIdMap = new Map<string, string>();
    const sourceZoneRows = db.prepare('SELECT data FROM zones WHERE configurationId = ?').all(sourceConfigId) as { data: string }[];
    for (const row of sourceZoneRows) {
      const zone = JSON.parse(row.data) as Zone;
      const mappedViewId = viewIdMap.get(zone.viewId);
      if (!mappedViewId) continue; // dangling view ref on the source — skip rather than copy it
      const copy = createZone(db, newConfigId, {
        viewId: mappedViewId,
        name: zone.name,
        type: zone.type,
        soa: zone.soa,
        allowTransfer: zone.allowTransfer,
        allowUpdate: zone.allowUpdate,
      });
      zoneIdMap.set(zone.id, copy.id);
    }

    // Raw select per zone, not listRecords(): same pagination reason as zones.
    for (const [oldZoneId, newZoneId] of zoneIdMap) {
      const sourceRecordRows = db.prepare('SELECT data FROM records WHERE zoneId = ?').all(oldZoneId) as { data: string }[];
      for (const row of sourceRecordRows) {
        const record = JSON.parse(row.data) as ResourceRecord;
        createRecord(db, newZoneId, {
          name: record.name,
          type: record.type,
          ttl: record.ttl,
          rdata: record.rdata,
          disabled: record.disabled,
          syncState: record.syncState,
          issue: record.issue,
        });
      }
    }

    // ACL entries reference TSIG keys by name (KEY_NAME), and names are
    // preserved below, so entries copy verbatim — no id remap needed here.
    for (const acl of listAcls(db, sourceConfigId)) {
      createAcl(db, newConfigId, { name: acl.name, entries: acl.entries });
    }

    // Direct row insert, not createTsigKey(): that regenerates the secret,
    // which would silently break every deployed server still trusting the
    // original. The clone must be a functional twin, so the secret is copied.
    for (const key of listTsigKeys(db, sourceConfigId)) {
      const withSecret = getTsigKeyWithSecret(db, key.id);
      if (!withSecret) continue;
      const newKey: TsigKeyRecord = {
        id: 'tsig-' + randomBytes(6).toString('hex'),
        configurationId: newConfigId,
        name: withSecret.name,
        algorithm: withSecret.algorithm,
        secret: withSecret.secret,
        usedByCount: 0,
      };
      db.prepare('INSERT INTO tsig_keys (id, configurationId, data) VALUES (?, ?, ?)').run(
        newKey.id,
        newConfigId,
        JSON.stringify(newKey),
      );
    }

    for (const host of listExternalHosts(db, sourceConfigId)) {
      createExternalHost(db, newConfigId, { fqdn: host.fqdn });
    }

    const scopeMaps = { newConfigId, viewIdMap, zoneIdMap, serverIdMap, groupIdMap };
    for (const option of listDeploymentOptions(db, sourceConfigId)) {
      const mappedScopeId = remapScopeId(option.scope, option.scopeId, scopeMaps);
      if (!mappedScopeId) continue; // dangling scope ref on the source — skip rather than copy it
      createDeploymentOption(db, newConfigId, {
        scope: option.scope,
        scopeId: mappedScopeId,
        key: option.key,
        value: option.value,
        disabled: option.disabled,
      });
    }

    for (const role of listDeploymentRoles(db, sourceConfigId)) {
      const mappedScopeId = remapScopeId(role.scope, role.scopeId, scopeMaps);
      const mappedServerId = serverIdMap.get(role.serverId);
      if (!mappedScopeId || !mappedServerId) continue; // dangling scope/server ref — skip rather than copy it
      createDeploymentRole(db, newConfigId, {
        scope: role.scope,
        scopeId: mappedScopeId,
        serverId: mappedServerId,
        role: role.role,
        disabled: role.disabled,
      });
    }

    // counts are recomputed live by getConfiguration()/computeConfigCounts(),
    // not stored, so no explicit count write is needed here.
    return getConfiguration(db, newConfigId) as Configuration;
  });

  return cloneTx();
}


