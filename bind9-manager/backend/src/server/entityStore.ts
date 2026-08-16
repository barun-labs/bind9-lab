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
  ListEnvelope,
  RecordType,
  SyncState,
} from '../../../shared/entities';
import type { Server, ConfigModel } from '../config-engine/model';

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

  return {
    configuration,
    views,
    zones,
    records,
    servers,
    acls,
    roles: [],
    options: [],
    externalHosts,
  };
}


