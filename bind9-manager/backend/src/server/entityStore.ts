import type Database from 'better-sqlite3';
import type {
  Configuration,
  View,
  Zone,
  ResourceRecord,
  ExternalHost,
  ListEnvelope,
  RecordType,
  SyncState,
} from '../../../shared/entities';

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
 * List all configurations.
 */
export function listConfigurations(db: Database.Database): Configuration[] {
  const rows = db.prepare('SELECT data FROM configurations').all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Configuration);
}

/**
 * Get configuration by ID.
 */
export function getConfiguration(db: Database.Database, id: string): Configuration | null {
  const row = db.prepare('SELECT data FROM configurations WHERE id = ?').get(id) as { data: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.data) as Configuration;
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
