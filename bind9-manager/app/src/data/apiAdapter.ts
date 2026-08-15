import type {
  Configuration,
  View,
  Zone,
  ZoneType,
  ResourceRecord,
  RecordType,
  SyncState,
  ExternalHost,
  ApiKey,
  ListEnvelope,
} from '../types/entities';
import type { StoreData } from './store';

export interface ListParams {
  q?: string;
  page?: number;
  size?: number;
  sort?: string;
}

export interface ZoneFilters extends ListParams {
  viewId?: string;
  view?: string;
  type?: ZoneType;
  status?: SyncState;
}

export interface RecordFilters extends ListParams {
  type?: RecordType;
  status?: SyncState;
}

export interface CreateRecordInput {
  name: string;
  type: RecordType;
  ttl: number;
  rdata: Record<string, unknown>;
  disabled?: boolean;
  syncState?: SyncState;
  issue?: string | null;
}

export interface UpdateRecordPatch {
  name?: string;
  type?: RecordType;
  ttl?: number;
  rdata?: Record<string, unknown>;
  disabled?: boolean;
  syncState?: SyncState;
  issue?: string | null;
}

export interface SearchResults {
  zones: Zone[];
  records: ResourceRecord[];
  servers: any[];
  blocks: any[];
}

function applySort<T>(items: T[], sort?: string): T[] {
  if (!sort) return items;
  const [field, direction] = sort.split(':');
  const dirMultiplier = direction === 'desc' ? -1 : 1;
  return [...items].sort((a, b) => {
    const valA = (a as any)[field];
    const valB = (b as any)[field];
    if (valA === valB) return 0;
    if (valA == null) return 1;
    if (valB == null) return -1;
    if (typeof valA === 'number' && typeof valB === 'number') {
      return (valA - valB) * dirMultiplier;
    }
    return String(valA).localeCompare(String(valB)) * dirMultiplier;
  });
}

function paginate<T>(items: T[], page?: number, size?: number): ListEnvelope<T> {
  const p = page && page > 0 ? page : 1;
  const s = size !== undefined ? Math.max(1, size) : 50;
  const total = items.length;
  const startIndex = (p - 1) * s;
  const data = items.slice(startIndex, startIndex + s);
  return {
    data,
    page: p,
    size: s,
    total,
  };
}

export async function listConfigurations(
  store: StoreData,
  params?: ListParams
): Promise<ListEnvelope<Configuration>> {
  let items = store.configurations;
  if (params?.q && params.q.trim()) {
    const qLower = params.q.trim().toLowerCase();
    items = items.filter(
      (c) =>
        c.name.toLowerCase().includes(qLower) ||
        (c.description && c.description.toLowerCase().includes(qLower)) ||
        c.id.toLowerCase().includes(qLower)
    );
  }
  items = applySort(items, params?.sort);
  return paginate(items, params?.page, params?.size);
}

export async function listViews(
  store: StoreData,
  configId: string,
  params?: ListParams
): Promise<ListEnvelope<View>> {
  let items = store.views.filter((v) => v.configurationId === configId);
  if (params?.q && params.q.trim()) {
    const qLower = params.q.trim().toLowerCase();
    items = items.filter(
      (v) => v.name.toLowerCase().includes(qLower) || v.id.toLowerCase().includes(qLower)
    );
  }
  items = applySort(items, params?.sort || 'order:asc');
  return paginate(items, params?.page, params?.size);
}

export async function listZones(
  store: StoreData,
  configId: string,
  filters?: ZoneFilters
): Promise<ListEnvelope<Zone>> {
  let items = store.zones.filter((z) => z.configurationId === configId);

  if (filters?.viewId) {
    items = items.filter((z) => z.viewId === filters.viewId);
  } else if (filters?.view) {
    items = items.filter((z) => z.viewId === filters.view);
  }

  if (filters?.type) {
    items = items.filter((z) => z.type === filters.type);
  }

  if (filters?.status) {
    items = items.filter((z) => z.syncState === filters.status);
  }

  if (filters?.q && filters.q.trim()) {
    const qLower = filters.q.trim().toLowerCase();
    items = items.filter(
      (z) => z.name.toLowerCase().includes(qLower) || z.id.toLowerCase().includes(qLower)
    );
  }

  items = applySort(items, filters?.sort);
  return paginate(items, filters?.page, filters?.size);
}

export async function getZone(
  store: StoreData,
  zoneId: string
): Promise<Zone | null> {
  const zone = store.zones.find((z) => z.id === zoneId);
  return zone ?? null;
}

export async function listRecords(
  store: StoreData,
  zoneId: string,
  filters?: RecordFilters
): Promise<ListEnvelope<ResourceRecord>> {
  let records = store.records.filter((r) => r.zoneId === zoneId);

  if (filters?.type) {
    records = records.filter((r) => r.type === filters.type);
  }

  if (filters?.status) {
    records = records.filter((r) => r.syncState === filters.status);
  }

  if (filters?.q && filters.q.trim()) {
    const qLower = filters.q.trim().toLowerCase();
    records = records.filter((r) => {
      if (r.name.toLowerCase().includes(qLower)) return true;
      if (r.type.toLowerCase().includes(qLower)) return true;
      if (r.id.toLowerCase().includes(qLower)) return true;
      if (r.rdata) {
        for (const val of Object.values(r.rdata)) {
          if (val != null && String(val).toLowerCase().includes(qLower)) {
            return true;
          }
        }
      }
      return false;
    });
  }

  records = applySort(records, filters?.sort);
  return paginate(records, filters?.page, filters?.size);
}

export async function createRecord(
  store: StoreData,
  zoneId: string,
  input: CreateRecordInput
): Promise<ResourceRecord> {
  const id = 'rec-' + Math.random().toString(36).substring(2, 10);
  const newRecord: ResourceRecord = {
    id,
    zoneId,
    name: input.name,
    type: input.type,
    ttl: input.ttl,
    rdata: input.rdata,
    disabled: input.disabled ?? false,
    syncState: input.syncState ?? 'PENDING',
    issue: input.issue ?? null,
  };

  store.records.push(newRecord);

  const zone = store.zones.find((z) => z.id === zoneId);
  if (zone) {
    zone.recordCount = store.records.filter((r) => r.zoneId === zoneId).length;
    const config = store.configurations.find((c) => c.id === zone.configurationId);
    if (config) {
      config.counts.records = store.records.length;
    }
  }

  return newRecord;
}

export async function updateRecord(
  store: StoreData,
  id: string,
  patch: UpdateRecordPatch
): Promise<ResourceRecord> {
  const record = store.records.find((r) => r.id === id);
  if (!record) {
    throw new Error(`Record with id ${id} not found`);
  }

  if (patch.name !== undefined) record.name = patch.name;
  if (patch.type !== undefined) record.type = patch.type;
  if (patch.ttl !== undefined) record.ttl = patch.ttl;
  if (patch.rdata !== undefined) record.rdata = { ...record.rdata, ...patch.rdata };
  if (patch.disabled !== undefined) record.disabled = patch.disabled;
  if (patch.syncState !== undefined) {
    record.syncState = patch.syncState;
  } else if (record.syncState === 'SYNCED') {
    record.syncState = 'PENDING';
  }
  if (patch.issue !== undefined) record.issue = patch.issue;

  return record;
}

export async function deleteRecord(
  store: StoreData,
  id: string
): Promise<ResourceRecord | null> {
  const index = store.records.findIndex((r) => r.id === id);
  if (index === -1) {
    return null;
  }

  const [deleted] = store.records.splice(index, 1);
  const zone = store.zones.find((z) => z.id === deleted.zoneId);
  if (zone) {
    zone.recordCount = store.records.filter((r) => r.zoneId === zone.id).length;
    const config = store.configurations.find((c) => c.id === zone.configurationId);
    if (config) {
      config.counts.records = store.records.length;
    }
  }

  return deleted;
}

export async function setRecordDisabled(
  store: StoreData,
  id: string,
  disabled: boolean
): Promise<ResourceRecord> {
  const record = store.records.find((r) => r.id === id);
  if (!record) {
    throw new Error(`Record with id ${id} not found`);
  }
  record.disabled = disabled;
  if (record.syncState === 'SYNCED') {
    record.syncState = 'PENDING';
  }
  return record;
}

export async function listExternalHosts(
  store: StoreData,
  configId: string,
  params?: ListParams
): Promise<ListEnvelope<ExternalHost>> {
  let items = store.externalHosts.filter((h) => h.configurationId === configId);
  if (params?.q && params.q.trim()) {
    const qLower = params.q.trim().toLowerCase();
    items = items.filter(
      (h) => h.fqdn.toLowerCase().includes(qLower) || h.id.toLowerCase().includes(qLower)
    );
  }
  items = applySort(items, params?.sort);
  return paginate(items, params?.page, params?.size);
}

export async function listApiKeys(
  store: StoreData,
  params?: ListParams
): Promise<ListEnvelope<ApiKey>> {
  let items = store.apiKeys.map(({ token: _token, ...rest }) => rest);
  if (params?.q && params.q.trim()) {
    const qLower = params.q.trim().toLowerCase();
    items = items.filter(
      (k) => k.name.toLowerCase().includes(qLower) || k.id.toLowerCase().includes(qLower)
    );
  }
  items = applySort(items, params?.sort);
  return paginate(items, params?.page, params?.size);
}

export async function createApiKey(
  store: StoreData,
  name: string
): Promise<ApiKey> {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const token = `bnd_${hex}`;

  const id = 'key-' + Math.random().toString(36).substring(2, 10);
  const createdAt = new Date().toISOString();

  // Store the key WITHOUT the token
  const storedKey: ApiKey = {
    id,
    name,
    createdAt,
    lastUsedAt: null,
  };
  store.apiKeys.push(storedKey);

  // Return the key WITH the token that one time only
  return {
    ...storedKey,
    token,
  };
}

export async function deleteApiKey(
  store: StoreData,
  id: string
): Promise<ApiKey | null> {
  const index = store.apiKeys.findIndex((k) => k.id === id);
  if (index === -1) {
    return null;
  }
  const [deleted] = store.apiKeys.splice(index, 1);
  return deleted;
}

export async function search(
  store: StoreData,
  q: string
): Promise<SearchResults> {
  if (!q || !q.trim()) {
    return {
      zones: [],
      records: [],
      servers: [],
      blocks: [],
    };
  }

  const qLower = q.trim().toLowerCase();

  const zones = store.zones
    .filter((z) => z.name.toLowerCase().includes(qLower) || z.id.toLowerCase().includes(qLower))
    .slice(0, 10);

  const records = store.records
    .filter((r) => {
      if (r.name.toLowerCase().includes(qLower)) return true;
      if (r.type.toLowerCase().includes(qLower)) return true;
      if (r.id.toLowerCase().includes(qLower)) return true;
      if (r.rdata) {
        for (const val of Object.values(r.rdata)) {
          if (val != null && String(val).toLowerCase().includes(qLower)) {
            return true;
          }
        }
      }
      return false;
    })
    .slice(0, 10);

  const servers = (store.servers || [])
    .filter(
      (s: any) =>
        (s.hostname && s.hostname.toLowerCase().includes(qLower)) ||
        (s.nodeName && s.nodeName.toLowerCase().includes(qLower)) ||
        (s.mgmtAddress && s.mgmtAddress.toLowerCase().includes(qLower)) ||
        (s.id && s.id.toLowerCase().includes(qLower))
    )
    .slice(0, 10);

  const blocks = (store.networkBlocks || [])
    .filter(
      (b: any) =>
        (b.cidr && b.cidr.toLowerCase().includes(qLower)) ||
        (b.id && b.id.toLowerCase().includes(qLower))
    )
    .slice(0, 10);

  return {
    zones,
    records,
    servers,
    blocks,
  };
}
