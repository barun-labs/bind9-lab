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
  User,
  RoleAssignment,
  ListEnvelope,
} from '../types/entities';
import type { StoreData } from './store';
import { apiFetch, isApiEnabled } from './http';

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

export interface CreateApiKeyInput {
  name: string;
  ownerUserId?: string;
  scopes?: ('read' | 'write' | 'deploy')[];
  readOnly?: boolean;
  expiresAt?: string | null;
}

function buildQueryString(params?: Record<string, any>): string {
  if (!params) return '';
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, String(value));
    }
  }
  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
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
  if (isApiEnabled()) {
    const qs = buildQueryString({
      q: params?.q,
      page: params?.page,
      size: params?.size,
      sort: params?.sort,
    });
    return apiFetch<ListEnvelope<Configuration>>(`/api/v1/configurations${qs}`);
  }

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
  if (isApiEnabled()) {
    try {
      const qs = buildQueryString({
        q: params?.q,
        page: params?.page,
        size: params?.size,
        sort: params?.sort,
      });
      return await apiFetch<ListEnvelope<View>>(`/api/v1/configurations/${configId}/views${qs}`);
    } catch (err: any) {
      if (err?.status !== 404) {
        throw err;
      }
      // Fall back to fixture store if views endpoint is not present
    }
  }

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
  if (isApiEnabled()) {
    const qs = buildQueryString({
      view: filters?.view || filters?.viewId,
      type: filters?.type,
      status: filters?.status,
      q: filters?.q,
      page: filters?.page,
      size: filters?.size,
      sort: filters?.sort,
    });
    return apiFetch<ListEnvelope<Zone>>(`/api/v1/configurations/${configId}/zones${qs}`);
  }

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
  if (isApiEnabled()) {
    try {
      return await apiFetch<Zone>(`/api/v1/zones/${zoneId}`);
    } catch (err: any) {
      if (err?.status === 404) {
        return null;
      }
      throw err;
    }
  }

  const zone = store.zones.find((z) => z.id === zoneId);
  return zone ?? null;
}

export async function listRecords(
  store: StoreData,
  zoneId: string,
  filters?: RecordFilters
): Promise<ListEnvelope<ResourceRecord>> {
  if (isApiEnabled()) {
    const qs = buildQueryString({
      type: filters?.type,
      status: filters?.status,
      q: filters?.q,
      page: filters?.page,
      size: filters?.size,
      sort: filters?.sort,
    });
    return apiFetch<ListEnvelope<ResourceRecord>>(`/api/v1/zones/${zoneId}/records${qs}`);
  }

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
  if (isApiEnabled()) {
    return apiFetch<ResourceRecord>(`/api/v1/zones/${zoneId}/records`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

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
  if (isApiEnabled()) {
    return apiFetch<ResourceRecord>(`/api/v1/records/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

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
  if (isApiEnabled()) {
    const res = await apiFetch<any>(`/api/v1/records/${id}`, {
      method: 'DELETE',
    });
    return res;
  }

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
  if (isApiEnabled()) {
    return apiFetch<ResourceRecord>(`/api/v1/records/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ disabled }),
    });
  }

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
  if (isApiEnabled()) {
    const qs = buildQueryString({
      q: params?.q,
      page: params?.page,
      size: params?.size,
      sort: params?.sort,
    });
    return apiFetch<ListEnvelope<ExternalHost>>(`/api/v1/configurations/${configId}/external-hosts${qs}`);
  }

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
  if (isApiEnabled()) {
    const resp = await apiFetch<ApiKey[] | ListEnvelope<ApiKey>>('/api/v1/api-keys');
    if (Array.isArray(resp)) {
      let items = resp;
      if (params?.q && params.q.trim()) {
        const qLower = params.q.trim().toLowerCase();
        items = items.filter(
          (k) => k.name.toLowerCase().includes(qLower) || k.id.toLowerCase().includes(qLower)
        );
      }
      items = applySort(items, params?.sort);
      return paginate(items, params?.page, params?.size);
    }
    return resp;
  }

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
  input: string | CreateApiKeyInput
): Promise<ApiKey> {
  if (isApiEnabled()) {
    const payload =
      typeof input === 'string'
        ? { name: input, scopes: ['read', 'write'], readOnly: false }
        : {
            name: input.name,
            scopes: input.scopes ?? ['read', 'write'],
            readOnly: input.readOnly ?? false,
            expiresAt: input.expiresAt ?? null,
          };
    return apiFetch<ApiKey>('/api/v1/api-keys', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  const params: CreateApiKeyInput = typeof input === 'string' ? { name: input } : input;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const token = `bnd_${hex}`;

  const id = 'key-' + Math.random().toString(36).substring(2, 10);
  const createdAt = new Date().toISOString();

  // Store the key WITHOUT the token
  const storedKey: ApiKey = {
    id,
    name: params.name,
    ownerUserId: params.ownerUserId ?? 'usr-admin',
    scopes: params.scopes ?? ['read', 'write'],
    readOnly: params.readOnly ?? false,
    expiresAt: params.expiresAt ?? null,
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
  if (isApiEnabled()) {
    await apiFetch<void>(`/api/v1/api-keys/${id}`, {
      method: 'DELETE',
    });
    return { id } as any;
  }

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
  if (isApiEnabled()) {
    try {
      const qs = buildQueryString({ q });
      return await apiFetch<SearchResults>(`/api/v1/search${qs}`);
    } catch (err: any) {
      if (err?.status !== 404) {
        throw err;
      }
      // Fall back to fixture store search if search endpoint is not present
    }
  }

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

export async function listUsers(
  store: StoreData,
  params?: ListParams
): Promise<ListEnvelope<User>> {
  let items = store.users || [];
  if (params?.q && params.q.trim()) {
    const qLower = params.q.trim().toLowerCase();
    items = items.filter(
      (u) =>
        u.displayName.toLowerCase().includes(qLower) ||
        u.username.toLowerCase().includes(qLower) ||
        u.id.toLowerCase().includes(qLower)
    );
  }
  items = applySort(items, params?.sort);
  return paginate(items, params?.page, params?.size);
}

export async function setUserRole(
  store: StoreData,
  userId: string,
  assignment: RoleAssignment
): Promise<User> {
  const user = store.users.find((u) => u.id === userId);
  if (!user) {
    throw new Error(`User with id ${userId} not found`);
  }
  if (!user.roles) {
    user.roles = [];
  }
  const existingIndex = user.roles.findIndex(
    (r) => r.configurationId === assignment.configurationId
  );
  if (existingIndex >= 0) {
    user.roles[existingIndex] = {
      ...user.roles[existingIndex],
      ...assignment,
    };
  } else {
    user.roles.push({ ...assignment });
  }
  return user;
}

export async function setUserActive(
  store: StoreData,
  userId: string,
  isActive: boolean
): Promise<User> {
  const user = store.users.find((u) => u.id === userId);
  if (!user) {
    throw new Error(`User with id ${userId} not found`);
  }
  user.isActive = isActive;
  return user;
}
