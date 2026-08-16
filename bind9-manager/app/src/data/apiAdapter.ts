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
  Lab,
  CreateLabInput,
  UpdateLabPatch,
  ImportLabInput,
  ValidateLabResult,
  DeployJob,
  Server,
  TelemetryNode,
  TelemetrySnapshot,
  StatisticsSnapshot,
  QueryResult,
  HealthFinding,
  Acl,
  AclEntry,
  AclEvalResult,
  TsigKey,
  ServerGroup,
  Block,
  BlockKind,
  RecordTemplate,
  RecordTemplateEntry,
  ChangeSetResponse,
  DiffLine,
  DeployPreflight,
  ChangeSetDeployJob,
} from '../types/entities';
export type {
  Lab,
  CreateLabInput,
  UpdateLabPatch,
  ImportLabInput,
  ValidateLabResult,
  ServerValidationResult,
  TopologyModel,
  NodeSpec,
  LinkSpec,
  NodeInterface,
  DeployJob,
  DeployResult,
  DeployedServerResult,
} from '../types/entities';
import type { StoreData } from './store';
import { apiFetch, isApiEnabled, resolveUrl } from './http';
import { generateClabYaml, parseClabYaml, validateClientTopology } from '../lib/clabYaml';
import { ZONE_SCOPE_KEYS } from '../lib/optionKinds';


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

export type OptionScope = 'VIEW' | 'ZONE';

export interface DeploymentOptionRow {
  id: string;
  configurationId: string;
  scope: OptionScope;
  scopeId: string;
  key: string;
  value: unknown | null;
  disabled?: boolean;
}

export interface DeploymentRoleRow {
  id: string;
  configurationId: string;
  scope: OptionScope;
  scopeId: string;
  serverId: string;
  role: string;
  disabled?: boolean;
}

export type InheritanceMode = 'INHERIT' | 'OVERRIDE' | 'DISABLE';

export interface EffectiveOption {
  key: string;
  mode: InheritanceMode;
  effectiveValue: unknown;
  inheritedValue: unknown;
}

export interface EffectiveRole {
  serverId: string;
  role: string;
  mode: InheritanceMode;
}

export interface CreateDeploymentOptionInput {
  scope: OptionScope;
  scopeId: string;
  key: string;
  value?: unknown;
  disabled?: boolean;
}

export interface UpdateDeploymentOptionPatch {
  value?: unknown;
  disabled?: boolean;
}

export interface CreateDeploymentRoleInput {
  scope: OptionScope;
  scopeId: string;
  serverId: string;
  role: string;
  disabled?: boolean;
}

export interface UpdateDeploymentRolePatch {
  role?: string;
  disabled?: boolean;
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

export interface CreateViewInput {
  name: string;
  order?: number;
  matchClients?: string[];
}

export interface UpdateViewPatch {
  name?: string;
  order?: number;
  matchClients?: string[];
}

export async function listViews(
  store: StoreData,
  configId: string
): Promise<View[]> {
  if (isApiEnabled()) {
    return apiFetch<View[]>(`/api/v1/configurations/${configId}/views`);
  }

  return store.views
    .filter((v) => v.configurationId === configId)
    .sort((a, b) => a.order - b.order);
}

export async function createView(
  store: StoreData,
  configId: string,
  input: CreateViewInput
): Promise<View> {
  if (isApiEnabled()) {
    return apiFetch<View>(`/api/v1/configurations/${configId}/views`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  const view: View = {
    id: 'view-' + Math.random().toString(16).slice(2, 10),
    configurationId: configId,
    name: input.name,
    order: input.order ?? 0,
    matchClients: input.matchClients ?? [],
    zoneCount: 0,
  };
  store.views.push(view);
  return view;
}

export async function updateView(
  store: StoreData,
  configId: string,
  id: string,
  patch: UpdateViewPatch
): Promise<View> {
  if (isApiEnabled()) {
    return apiFetch<View>(`/api/v1/configurations/${configId}/views/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  const view = store.views.find((v) => v.id === id && v.configurationId === configId);
  if (!view) {
    throw new Error(`View with id ${id} not found`);
  }
  if (patch.name !== undefined) view.name = patch.name;
  if (patch.order !== undefined) view.order = patch.order;
  if (patch.matchClients !== undefined) view.matchClients = patch.matchClients;
  return view;
}

export async function deleteView(
  store: StoreData,
  configId: string,
  id: string
): Promise<{ deleted: boolean }> {
  if (isApiEnabled()) {
    return apiFetch<{ deleted: boolean }>(`/api/v1/configurations/${configId}/views/${id}`, {
      method: 'DELETE',
    });
  }

  const index = store.views.findIndex((v) => v.id === id && v.configurationId === configId);
  if (index >= 0) store.views.splice(index, 1);
  return { deleted: true };
}

export interface CreateAclInput {
  name: string;
  entries?: AclEntry[];
}

export interface UpdateAclPatch {
  name?: string;
  entries?: AclEntry[];
}

export async function listAcls(
  store: StoreData,
  configId: string
): Promise<Acl[]> {
  if (isApiEnabled()) {
    return apiFetch<Acl[]>(`/api/v1/configurations/${configId}/acls`);
  }

  return store.acls
    .filter((a) => a.configurationId === configId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAcl(
  store: StoreData,
  configId: string,
  aclId: string
): Promise<Acl | null> {
  if (isApiEnabled()) {
    try {
      return await apiFetch<Acl>(`/api/v1/configurations/${configId}/acls/${aclId}`);
    } catch (err: any) {
      if (err?.status === 404) {
        return null;
      }
      throw err;
    }
  }

  return store.acls.find((a) => a.id === aclId && a.configurationId === configId) ?? null;
}

export async function createAcl(
  store: StoreData,
  configId: string,
  input: CreateAclInput
): Promise<Acl> {
  if (isApiEnabled()) {
    return apiFetch<Acl>(`/api/v1/configurations/${configId}/acls`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  const acl: Acl = {
    id: 'acl-' + Math.random().toString(16).slice(2, 10),
    configurationId: configId,
    name: input.name,
    entries: (input.entries ?? []).map((e, i) => ({ ...e, order: i })),
    usedByCount: 0,
  };
  store.acls.push(acl);
  return acl;
}

export async function updateAcl(
  store: StoreData,
  configId: string,
  aclId: string,
  patch: UpdateAclPatch
): Promise<Acl> {
  if (isApiEnabled()) {
    return apiFetch<Acl>(`/api/v1/configurations/${configId}/acls/${aclId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  const acl = store.acls.find((a) => a.id === aclId && a.configurationId === configId);
  if (!acl) {
    throw new Error(`ACL with id ${aclId} not found`);
  }
  if (patch.name !== undefined) acl.name = patch.name;
  if (patch.entries !== undefined) {
    acl.entries = patch.entries.map((e, i) => ({ ...e, order: i }));
  }
  return acl;
}

export async function deleteAcl(
  store: StoreData,
  configId: string,
  aclId: string
): Promise<{ deleted: boolean }> {
  if (isApiEnabled()) {
    return apiFetch<{ deleted: boolean }>(`/api/v1/configurations/${configId}/acls/${aclId}`, {
      method: 'DELETE',
    });
  }

  const index = store.acls.findIndex((a) => a.id === aclId && a.configurationId === configId);
  if (index >= 0) store.acls.splice(index, 1);
  return { deleted: true };
}

export async function evaluateAcl(
  _store: StoreData,
  configId: string,
  input: { target: string; clientIp: string }
): Promise<AclEvalResult> {
  if (isApiEnabled()) {
    return apiFetch<AclEvalResult>(`/api/v1/configurations/${configId}/acls/evaluate`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  return { matched: false, decision: 'DENY', trace: [] };
}

export interface CreateTsigKeyInput {
  name: string;
  algorithm: TsigKey['algorithm'];
}

export async function listTsigKeys(
  store: StoreData,
  configId: string
): Promise<TsigKey[]> {
  if (isApiEnabled()) {
    return apiFetch<TsigKey[]>(`/api/v1/configurations/${configId}/tsig-keys`);
  }

  return store.tsigKeys
    .filter((k) => k.configurationId === configId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createTsigKey(
  store: StoreData,
  configId: string,
  input: CreateTsigKeyInput
): Promise<TsigKey> {
  if (isApiEnabled()) {
    return apiFetch<TsigKey>(`/api/v1/configurations/${configId}/tsig-keys`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  // Mirror createApiKey: the secret is generated once and NOT retained on the
  // stored record, so a later listTsigKeys/getTsigKey never leaks it.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const secret = btoa(String.fromCharCode(...bytes));

  const storedKey: TsigKey = {
    id: 'tsig-' + Math.random().toString(16).slice(2, 10),
    configurationId: configId,
    name: input.name,
    algorithm: input.algorithm,
    usedByCount: 0,
  };
  store.tsigKeys.push(storedKey);

  return { ...storedKey, secret };
}

// ponytail: no updateTsigKey — the backend PATCH exists but nothing in the UI
// needs to rename/re-algorithm a key today; add when a screen wants it.
export async function deleteTsigKey(
  store: StoreData,
  configId: string,
  keyId: string
): Promise<{ deleted: boolean }> {
  if (isApiEnabled()) {
    return apiFetch<{ deleted: boolean }>(`/api/v1/configurations/${configId}/tsig-keys/${keyId}`, {
      method: 'DELETE',
    });
  }

  const index = store.tsigKeys.findIndex((k) => k.id === keyId && k.configurationId === configId);
  if (index >= 0) store.tsigKeys.splice(index, 1);
  return { deleted: true };
}

export interface CreateServerGroupInput {
  name: string;
  description?: string;
}

export interface UpdateServerGroupPatch {
  name?: string;
  description?: string;
}

export async function listServerGroups(
  store: StoreData,
  configId: string
): Promise<ServerGroup[]> {
  if (isApiEnabled()) {
    return apiFetch<ServerGroup[]>(`/api/v1/configurations/${configId}/groups`);
  }

  return store.serverGroups
    .filter((g) => g.configurationId === configId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getServerGroup(
  store: StoreData,
  configId: string,
  groupId: string
): Promise<ServerGroup | null> {
  if (isApiEnabled()) {
    try {
      return await apiFetch<ServerGroup>(`/api/v1/configurations/${configId}/groups/${groupId}`);
    } catch (err: any) {
      if (err?.status === 404) return null;
      throw err;
    }
  }

  return store.serverGroups.find((g) => g.id === groupId && g.configurationId === configId) ?? null;
}

export async function createServerGroup(
  store: StoreData,
  configId: string,
  input: CreateServerGroupInput
): Promise<ServerGroup> {
  if (isApiEnabled()) {
    return apiFetch<ServerGroup>(`/api/v1/configurations/${configId}/groups`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  const group: ServerGroup = {
    id: 'grp-' + Math.random().toString(16).slice(2, 10),
    configurationId: configId,
    name: input.name,
    description: input.description,
    memberCount: 0,
  };
  store.serverGroups.push(group);
  return group;
}

export async function updateServerGroup(
  store: StoreData,
  configId: string,
  groupId: string,
  patch: UpdateServerGroupPatch
): Promise<ServerGroup> {
  if (isApiEnabled()) {
    return apiFetch<ServerGroup>(`/api/v1/configurations/${configId}/groups/${groupId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  const group = store.serverGroups.find((g) => g.id === groupId && g.configurationId === configId);
  if (!group) {
    throw new Error(`Server group with id ${groupId} not found`);
  }
  if (patch.name !== undefined) group.name = patch.name;
  if (patch.description !== undefined) group.description = patch.description;
  return group;
}

export async function deleteServerGroup(
  store: StoreData,
  configId: string,
  groupId: string
): Promise<{ deleted: boolean }> {
  if (isApiEnabled()) {
    return apiFetch<{ deleted: boolean }>(`/api/v1/configurations/${configId}/groups/${groupId}`, {
      method: 'DELETE',
    });
  }

  const index = store.serverGroups.findIndex((g) => g.id === groupId && g.configurationId === configId);
  if (index >= 0) store.serverGroups.splice(index, 1);
  return { deleted: true };
}

export interface CreateBlockInput {
  name: string;
  cidr: string;
  kind: BlockKind;
  parentBlockId?: string | null;
  viewId?: string;
}

export interface UpdateBlockPatch {
  name?: string;
  cidr?: string;
  parentBlockId?: string | null;
  viewId?: string;
}

export async function listBlocks(store: StoreData, configId: string): Promise<Block[]> {
  if (isApiEnabled()) {
    return apiFetch<Block[]>(`/api/v1/configurations/${configId}/blocks`);
  }

  return store.networkBlocks.filter((b) => b.configurationId === configId);
}

export async function getBlock(store: StoreData, configId: string, blockId: string): Promise<Block | null> {
  if (isApiEnabled()) {
    try {
      return await apiFetch<Block>(`/api/v1/configurations/${configId}/blocks/${blockId}`);
    } catch (err: any) {
      if (err?.status === 404) return null;
      throw err;
    }
  }

  return store.networkBlocks.find((b) => b.id === blockId && b.configurationId === configId) ?? null;
}

export async function createBlock(store: StoreData, configId: string, input: CreateBlockInput): Promise<Block> {
  if (isApiEnabled()) {
    return apiFetch<Block>(`/api/v1/configurations/${configId}/blocks`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  const block: Block = {
    id: 'blk-' + Math.random().toString(16).slice(2, 10),
    configurationId: configId,
    name: input.name,
    cidr: input.cidr,
    kind: input.kind,
    parentBlockId: input.parentBlockId ?? null,
    viewId: input.kind === 'NETWORK' ? input.viewId : undefined,
  };
  store.networkBlocks.push(block);
  return block;
}

export async function updateBlock(
  store: StoreData,
  configId: string,
  blockId: string,
  patch: UpdateBlockPatch
): Promise<Block> {
  if (isApiEnabled()) {
    return apiFetch<Block>(`/api/v1/configurations/${configId}/blocks/${blockId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  const block = store.networkBlocks.find((b) => b.id === blockId && b.configurationId === configId);
  if (!block) {
    throw new Error(`Block with id ${blockId} not found`);
  }
  if (patch.name !== undefined) block.name = patch.name;
  if (patch.cidr !== undefined) block.cidr = patch.cidr;
  if (patch.parentBlockId !== undefined) block.parentBlockId = patch.parentBlockId;
  if (patch.viewId !== undefined) block.viewId = patch.viewId;
  return block;
}

export async function deleteBlock(store: StoreData, configId: string, blockId: string): Promise<{ deleted: boolean }> {
  if (isApiEnabled()) {
    return apiFetch<{ deleted: boolean }>(`/api/v1/configurations/${configId}/blocks/${blockId}`, {
      method: 'DELETE',
    });
  }

  const hasChildren = store.networkBlocks.some((b) => b.parentBlockId === blockId && b.configurationId === configId);
  if (hasChildren) {
    throw new Error('Delete or reparent child blocks first');
  }
  const index = store.networkBlocks.findIndex((b) => b.id === blockId && b.configurationId === configId);
  if (index >= 0) store.networkBlocks.splice(index, 1);
  return { deleted: true };
}

export async function reconcileBlock(_store: StoreData, configId: string, blockId: string): Promise<{ created: number }> {
  if (isApiEnabled()) {
    return apiFetch<{ created: number }>(`/api/v1/configurations/${configId}/blocks/${blockId}/reconcile`, {
      method: 'POST',
    });
  }

  // ponytail: fixture store has no A-record/PTR model to reconcile against — reports zero.
  return { created: 0 };
}

export interface CreateRecordTemplateInput {
  name: string;
  description?: string;
  entries?: RecordTemplateEntry[];
}

export interface UpdateRecordTemplatePatch {
  name?: string;
  description?: string;
  entries?: RecordTemplateEntry[];
}

export async function listRecordTemplates(
  store: StoreData,
  configId: string
): Promise<RecordTemplate[]> {
  if (isApiEnabled()) {
    return apiFetch<RecordTemplate[]>(`/api/v1/configurations/${configId}/record-templates`);
  }

  return store.recordTemplates
    .filter((t) => t.configurationId === configId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getRecordTemplate(
  store: StoreData,
  configId: string,
  templateId: string
): Promise<RecordTemplate | null> {
  if (isApiEnabled()) {
    try {
      return await apiFetch<RecordTemplate>(`/api/v1/configurations/${configId}/record-templates/${templateId}`);
    } catch (err: any) {
      if (err?.status === 404) return null;
      throw err;
    }
  }

  return store.recordTemplates.find((t) => t.id === templateId && t.configurationId === configId) ?? null;
}

export async function createRecordTemplate(
  store: StoreData,
  configId: string,
  input: CreateRecordTemplateInput
): Promise<RecordTemplate> {
  if (isApiEnabled()) {
    return apiFetch<RecordTemplate>(`/api/v1/configurations/${configId}/record-templates`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  const template: RecordTemplate = {
    id: 'tpl-' + Math.random().toString(16).slice(2, 10),
    configurationId: configId,
    name: input.name,
    description: input.description,
    entries: input.entries ?? [],
  };
  store.recordTemplates.push(template);
  return template;
}

export async function deleteRecordTemplate(
  store: StoreData,
  configId: string,
  templateId: string
): Promise<{ deleted: boolean }> {
  if (isApiEnabled()) {
    return apiFetch<{ deleted: boolean }>(`/api/v1/configurations/${configId}/record-templates/${templateId}`, {
      method: 'DELETE',
    });
  }

  const index = store.recordTemplates.findIndex((t) => t.id === templateId && t.configurationId === configId);
  if (index >= 0) store.recordTemplates.splice(index, 1);
  return { deleted: true };
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

// ponytail: fixture rows in fixtures.json still carry the old ad-hoc
// `scopeType` field rather than the spec's `scope`; accept either until the
// fixture data migrates.
export async function listDeploymentOptions(
  store: StoreData,
  configId: string,
  scope: OptionScope,
  scopeId: string
): Promise<DeploymentOptionRow[]> {
  if (isApiEnabled()) {
    const qs = buildQueryString({ scope, scopeId });
    return apiFetch<DeploymentOptionRow[]>(`/api/v1/configurations/${configId}/options${qs}`);
  }

  return (store.deploymentOptions || []).filter(
    (row: any) => (row.scope ?? row.scopeType) === scope && row.scopeId === scopeId
  ) as DeploymentOptionRow[];
}

export async function listDeploymentRoles(
  store: StoreData,
  configId: string,
  scope: OptionScope,
  scopeId: string
): Promise<DeploymentRoleRow[]> {
  if (isApiEnabled()) {
    const qs = buildQueryString({ scope, scopeId });
    return apiFetch<DeploymentRoleRow[]>(`/api/v1/configurations/${configId}/roles${qs}`);
  }

  return (store.deploymentRoles || []).filter(
    (row: any) => (row.scope ?? row.scopeType) === scope && row.scopeId === scopeId
  ) as DeploymentRoleRow[];
}

export async function createDeploymentOption(
  store: StoreData,
  configId: string,
  input: CreateDeploymentOptionInput
): Promise<DeploymentOptionRow> {
  if (isApiEnabled()) {
    return apiFetch<DeploymentOptionRow>(`/api/v1/configurations/${configId}/options`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  const row: DeploymentOptionRow = {
    id: 'opt-' + Math.random().toString(16).slice(2, 10),
    configurationId: configId,
    scope: input.scope,
    scopeId: input.scopeId,
    key: input.key,
    value: input.disabled ? null : input.value ?? null,
    disabled: input.disabled ?? false,
  };
  if (!store.deploymentOptions) store.deploymentOptions = [];
  store.deploymentOptions.push(row as any);
  return row;
}

export async function updateDeploymentOption(
  store: StoreData,
  configId: string,
  optionId: string,
  patch: UpdateDeploymentOptionPatch
): Promise<DeploymentOptionRow> {
  if (isApiEnabled()) {
    return apiFetch<DeploymentOptionRow>(`/api/v1/configurations/${configId}/options/${optionId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  const row = (store.deploymentOptions || []).find((r: any) => r.id === optionId);
  if (!row) {
    throw new Error(`Deployment option with id ${optionId} not found`);
  }
  if (patch.value !== undefined) row.value = patch.value;
  if (patch.disabled !== undefined) row.disabled = patch.disabled;
  return row as DeploymentOptionRow;
}

export async function deleteDeploymentOption(
  store: StoreData,
  configId: string,
  optionId: string
): Promise<{ deleted: boolean }> {
  if (isApiEnabled()) {
    await apiFetch<void>(`/api/v1/configurations/${configId}/options/${optionId}`, {
      method: 'DELETE',
    });
    return { deleted: true };
  }

  const arr = store.deploymentOptions || [];
  const index = arr.findIndex((r: any) => r.id === optionId);
  if (index >= 0) arr.splice(index, 1);
  return { deleted: true };
}

// Resolved per-zone option modes. Real-API mode returns the backend's actual
// precedence result (server/server-group/config scopes included).
//
// ponytail: fixture-mode fallback is best-effort — it only resolves ZONE and
// VIEW rows, not the full server/server-group/config precedence chain the
// backend implements in config-engine/resolve.ts. Good enough for offline
// dev fixtures; the real API path above is what actually matters.
export async function getEffectiveZoneOptions(
  store: StoreData,
  configId: string,
  zoneId: string
): Promise<EffectiveOption[]> {
  if (isApiEnabled()) {
    return apiFetch<EffectiveOption[]>(
      `/api/v1/configurations/${configId}/zones/${zoneId}/effective-options`
    );
  }

  const zone = store.zones.find((z) => z.id === zoneId);
  const viewId = zone?.viewId ?? '';
  const rows = (store.deploymentOptions || []) as any[];
  const zoneRows = rows.filter((r) => (r.scope ?? r.scopeType) === 'ZONE' && r.scopeId === zoneId);
  const viewRows = rows.filter((r) => (r.scope ?? r.scopeType) === 'VIEW' && r.scopeId === viewId);

  const result: EffectiveOption[] = [];
  for (const key of ZONE_SCOPE_KEYS) {
    const zoneRow = zoneRows.find((r) => r.key === key);
    const viewRow = viewRows.find((r) => r.key === key);
    const inheritedValue = viewRow && !viewRow.disabled ? viewRow.value : undefined;

    if (zoneRow?.disabled) {
      result.push({ key, mode: 'DISABLE', effectiveValue: null, inheritedValue });
    } else if (zoneRow) {
      result.push({ key, mode: 'OVERRIDE', effectiveValue: zoneRow.value, inheritedValue });
    } else if (inheritedValue !== undefined) {
      result.push({ key, mode: 'INHERIT', effectiveValue: inheritedValue, inheritedValue });
    }
  }
  return result;
}

export async function createDeploymentRole(
  store: StoreData,
  configId: string,
  input: CreateDeploymentRoleInput
): Promise<DeploymentRoleRow> {
  if (isApiEnabled()) {
    return apiFetch<DeploymentRoleRow>(`/api/v1/configurations/${configId}/roles`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  const row: DeploymentRoleRow = {
    id: 'role-' + Math.random().toString(16).slice(2, 10),
    configurationId: configId,
    scope: input.scope,
    scopeId: input.scopeId,
    serverId: input.serverId,
    role: input.role,
    disabled: input.disabled ?? false,
  };
  if (!store.deploymentRoles) store.deploymentRoles = [];
  store.deploymentRoles.push(row as any);
  return row;
}

export async function updateDeploymentRole(
  store: StoreData,
  configId: string,
  roleId: string,
  patch: UpdateDeploymentRolePatch
): Promise<DeploymentRoleRow> {
  if (isApiEnabled()) {
    return apiFetch<DeploymentRoleRow>(`/api/v1/configurations/${configId}/roles/${roleId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  const row = (store.deploymentRoles || []).find((r: any) => r.id === roleId);
  if (!row) {
    throw new Error(`Deployment role with id ${roleId} not found`);
  }
  if (patch.role !== undefined) row.role = patch.role;
  if (patch.disabled !== undefined) row.disabled = patch.disabled;
  return row as DeploymentRoleRow;
}

export async function deleteDeploymentRole(
  store: StoreData,
  configId: string,
  roleId: string
): Promise<{ deleted: boolean }> {
  if (isApiEnabled()) {
    await apiFetch<void>(`/api/v1/configurations/${configId}/roles/${roleId}`, {
      method: 'DELETE',
    });
    return { deleted: true };
  }

  const arr = store.deploymentRoles || [];
  const index = arr.findIndex((r: any) => r.id === roleId);
  if (index >= 0) arr.splice(index, 1);
  return { deleted: true };
}

// ponytail: fixture-mode fallback, same caveat as getEffectiveZoneOptions —
// resolves only ZONE/VIEW role rows, not the full backend precedence chain.
export async function getEffectiveZoneRoles(
  store: StoreData,
  configId: string,
  zoneId: string
): Promise<EffectiveRole[]> {
  if (isApiEnabled()) {
    return apiFetch<EffectiveRole[]>(
      `/api/v1/configurations/${configId}/zones/${zoneId}/effective-roles`
    );
  }

  const zone = store.zones.find((z) => z.id === zoneId);
  const viewId = zone?.viewId ?? '';
  const rows = (store.deploymentRoles || []) as any[];
  const zoneRows = rows.filter((r) => (r.scope ?? r.scopeType) === 'ZONE' && r.scopeId === zoneId);
  const viewRows = rows.filter((r) => (r.scope ?? r.scopeType) === 'VIEW' && r.scopeId === viewId);
  const serverIds = new Set<string>([
    ...zoneRows.map((r) => r.serverId),
    ...viewRows.map((r) => r.serverId),
  ]);

  const result: EffectiveRole[] = [];
  for (const serverId of serverIds) {
    const zoneRow = zoneRows.find((r) => r.serverId === serverId);
    if (zoneRow) {
      result.push({ serverId, role: zoneRow.role, mode: zoneRow.disabled ? 'DISABLE' : 'OVERRIDE' });
      continue;
    }
    const viewRow = viewRows.find((r) => r.serverId === serverId);
    if (viewRow && !viewRow.disabled) {
      result.push({ serverId, role: viewRow.role, mode: 'INHERIT' });
    }
  }
  return result;
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

export async function listServers(store: StoreData, configId: string): Promise<Server[]> {
  if (isApiEnabled()) {
    return apiFetch<Server[]>(`/api/v1/configurations/${configId}/servers`);
  }
  return (store.servers || []).filter((s: any) => s.configurationId === configId) as Server[];
}

export async function getServer(store: StoreData, configId: string, id: string): Promise<Server | null> {
  if (isApiEnabled()) {
    try {
      return await apiFetch<Server>(`/api/v1/configurations/${configId}/servers/${id}`);
    } catch (err: any) {
      if (err?.status === 404) return null;
      throw err;
    }
  }
  return ((store.servers || []).find((s: any) => s.id === id && s.configurationId === configId) as Server) ?? null;
}

export interface CreateServerInput {
  hostname: string;
  name?: string;
  mgmtAddress?: string;
  image?: string;
  nodeName?: string;
  adminState?: 'ENABLED' | 'DISABLED';
  serviceInterfaces?: { address: string; port?: number }[];
}

export async function createServer(
  store: StoreData,
  configId: string,
  input: CreateServerInput
): Promise<Server> {
  if (isApiEnabled()) {
    return apiFetch<Server>(`/api/v1/configurations/${configId}/servers`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  const id = 'srv-' + Math.random().toString(16).slice(2, 18);
  const server: any = {
    id,
    configurationId: configId,
    syncState: 'PENDING',
    adminState: input.adminState ?? 'ENABLED',
    ...input,
    name: input.name ?? input.hostname,
  };
  (store.servers as any[]).push(server);
  return server as Server;
}

export async function deleteServer(
  store: StoreData,
  configId: string,
  id: string
): Promise<{ deleted: boolean }> {
  if (isApiEnabled()) {
    return apiFetch<{ deleted: boolean }>(`/api/v1/configurations/${configId}/servers/${id}`, {
      method: 'DELETE',
    });
  }
  const arr = store.servers as any[];
  const i = arr.findIndex((s) => s.id === id && s.configurationId === configId);
  if (i >= 0) arr.splice(i, 1);
  return { deleted: true };
}

export async function listLabs(
  store: StoreData,
  configId: string,
  params?: ListParams
): Promise<ListEnvelope<Lab>> {
  if (isApiEnabled()) {
    const qs = buildQueryString({
      configurationId: configId,
      q: params?.q,
      page: params?.page,
      size: params?.size,
      sort: params?.sort,
    });
    const resp = await apiFetch<Lab[] | ListEnvelope<Lab>>(`/api/v1/labs${qs}`);
    if (Array.isArray(resp)) {
      let items = resp;
      if (params?.q && params.q.trim()) {
        const qLower = params.q.trim().toLowerCase();
        items = items.filter(
          (l) => l.name.toLowerCase().includes(qLower) || l.id.toLowerCase().includes(qLower)
        );
      }
      items = applySort(items, params?.sort);
      return paginate(items, params?.page, params?.size);
    }
    return resp;
  }

  let items = (store.labs || []).filter((l) => l.configurationId === configId);
  if (params?.q && params.q.trim()) {
    const qLower = params.q.trim().toLowerCase();
    items = items.filter(
      (l) => l.name.toLowerCase().includes(qLower) || l.id.toLowerCase().includes(qLower)
    );
  }
  items = applySort(items, params?.sort);
  return paginate(items, params?.page, params?.size);
}

export async function getLab(
  store: StoreData,
  id: string
): Promise<Lab | null> {
  if (isApiEnabled()) {
    try {
      return await apiFetch<Lab>(`/api/v1/labs/${id}`);
    } catch (err: any) {
      if (err?.status === 404) {
        return null;
      }
      throw err;
    }
  }

  const lab = (store.labs || []).find((l) => l.id === id);
  return lab ?? null;
}

export async function createLab(
  store: StoreData,
  input: CreateLabInput
): Promise<Lab> {
  if (isApiEnabled()) {
    return apiFetch<Lab>('/api/v1/labs', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  const id = input.id || 'lab-' + Math.random().toString(36).substring(2, 10);
  const now = new Date().toISOString();
  const newLab: Lab = {
    id,
    name: input.name,
    configurationId: input.configurationId,
    topology: input.topology,
    createdAt: now,
    updatedAt: now,
  };

  if (!store.labs) {
    store.labs = [];
  }
  store.labs.push(newLab);
  return newLab;
}

export async function updateLab(
  store: StoreData,
  id: string,
  patch: UpdateLabPatch
): Promise<Lab> {
  if (isApiEnabled()) {
    return apiFetch<Lab>(`/api/v1/labs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  const lab = (store.labs || []).find((l) => l.id === id);
  if (!lab) {
    throw new Error(`Lab with id ${id} not found`);
  }

  if (patch.name !== undefined) lab.name = patch.name;
  if (patch.configurationId !== undefined) lab.configurationId = patch.configurationId;
  if (patch.topology !== undefined) lab.topology = patch.topology;
  lab.updatedAt = new Date().toISOString();

  return lab;
}

export async function deleteLab(
  store: StoreData,
  id: string
): Promise<{ deleted: true }> {
  if (isApiEnabled()) {
    return apiFetch<{ deleted: true }>(`/api/v1/labs/${id}`, {
      method: 'DELETE',
    });
  }

  if (store.labs) {
    const index = store.labs.findIndex((l) => l.id === id);
    if (index !== -1) {
      store.labs.splice(index, 1);
    }
  }
  return { deleted: true };
}

export async function renderLab(
  store: StoreData,
  id: string
): Promise<{ yaml: string }> {
  if (isApiEnabled()) {
    return apiFetch<{ yaml: string }>(`/api/v1/labs/${id}/render`, {
      method: 'POST',
    });
  }

  const lab = (store.labs || []).find((l) => l.id === id);
  if (!lab) {
    throw new Error(`Lab with id ${id} not found`);
  }
  return { yaml: generateClabYaml(lab.topology) };
}

export async function importLab(
  store: StoreData,
  input: ImportLabInput
): Promise<Lab> {
  if (isApiEnabled()) {
    return apiFetch<Lab>('/api/v1/labs/import', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  const topology = parseClabYaml(input.yaml, input.name);
  const labName = input.name || topology.name || 'imported-lab';
  return createLab(store, {
    name: labName,
    configurationId: input.configurationId,
    topology,
  });
}

export async function validateLab(
  store: StoreData,
  id: string
): Promise<ValidateLabResult> {
  if (isApiEnabled()) {
    return apiFetch<ValidateLabResult>(`/api/v1/labs/${id}/validate`, {
      method: 'POST',
    });
  }

  const lab = (store.labs || []).find((l) => l.id === id);
  if (!lab) {
    throw new Error(`Lab with id ${id} not found`);
  }

  const topologyProblems = validateClientTopology(lab.topology);
  const bindNodes = (lab.topology?.nodes || []).filter((n) => n.intent === 'bind');
  const perServer = bindNodes.map((n) => ({
    serverId: `srv-${lab.id}-${n.name}`,
    ok: true,
    warnings: [],
    errors: [],
  }));

  return {
    topology: topologyProblems,
    perServer,
  };
}

export async function deployLab(
  store: StoreData,
  id: string
): Promise<{ jobId: string }> {
  if (isApiEnabled()) {
    return apiFetch<{ jobId: string }>(`/api/v1/labs/${id}/deploy`, {
      method: 'POST',
    });
  }

  const lab = (store.labs || []).find((l) => l.id === id);
  const jobId = 'job-' + Math.random().toString(36).substring(2, 10);
  const now = new Date().toISOString();

  const bindNodes = (lab?.topology?.nodes || []).filter(
    (n) => n.intent === 'bind' || (!n.intent && n.kind !== 'bridge')
  );
  const validated = bindNodes.map((n) => ({
    serverId: `srv-${id}-${n.name}`,
    ok: true,
    errors: [],
  }));
  const deployed = bindNodes.map((n) => ({
    serverId: `srv-${id}-${n.name}`,
    ok: true,
    output: `dig @${n.mgmtIpv4 || '10.70.0.11'} example.com. SOA -> OK (flags: qr aa; 0 errors)`,
  }));

  const cannedJob: DeployJob = {
    id: jobId,
    labId: id,
    status: 'SUCCEEDED',
    createdAt: now,
    result: {
      validated: validated.length > 0 ? validated : [{ serverId: `srv-${id}-ns1`, ok: true, errors: [] }],
      deployed:
        deployed.length > 0
          ? deployed
          : [
              {
                serverId: `srv-${id}-ns1`,
                ok: true,
                output: 'dig @10.70.0.11 example.com. SOA -> OK (flags: qr aa; 0 errors)',
              },
            ],
    },
  };

  if (!store.deployJobs) {
    store.deployJobs = [];
  }
  store.deployJobs.push(cannedJob);

  return { jobId };
}

export async function destroyLab(
  store: StoreData,
  labId: string,
): Promise<{ lab: Lab | null; servers: Server[] }> {
  if (isApiEnabled()) {
    return apiFetch(`/api/v1/labs/${labId}/destroy`, { method: 'POST' });
  }
  // fixture: flip the lab to DESTROYED and force its bind servers to NODE_ABSENT in the store.
  const lab = (store.labs || []).find((l: any) => l.id === labId) || null;
  if (lab) {
    (lab as any).lifecycleState = 'DESTROYED';
    (lab as any).lastDestroyedAt = new Date().toISOString();
  }
  const servers = ((store.servers as any[]) || []).filter((s) => s.id.startsWith('srv-' + labId + '-'));
  for (const s of servers) { s.syncState = 'NODE_ABSENT'; s.containerId = undefined; s.runtimeAddress = undefined; }
  return { lab, servers };
}

export async function getNodeLogs(
  _store: StoreData,
  labId: string,
  node: string,
  tail = 200
): Promise<string> {
  if (isApiEnabled()) {
    // Logs route returns text/plain; apiFetch hands back the raw text body.
    return apiFetch<string>(`/api/v1/labs/${labId}/nodes/${node}/logs?tail=${tail}`);
  }

  return [
    `named[1]: starting BIND 9.18.28 (node ${node})`,
    `named[1]: zone example.com/IN loaded (serial 2026081501)`,
    `named[1]: listening on IPv4 interface eth1, 10.70.0.11#53`,
    `named[1]: zone example.com/IN: sending notifies (serial 2026081501)`,
    `named[1]: client @0x7f3a2c001000 10.70.0.1#54011 (example.com): query: example.com IN A +E (10.70.0.11)`,
    `named[1]: resolver priming query complete`,
  ].join('\n');
}

export async function getLabStatistics(_store: StoreData, labId: string): Promise<StatisticsSnapshot> {
  if (isApiEnabled()) return apiFetch<StatisticsSnapshot>(`/api/v1/labs/${labId}/statistics`);
  return { servers: [], at: new Date().toISOString() };
}

export async function runQuery(
  _store: StoreData,
  labId: string,
  input: { node: string; qname: string; qtype?: string; server?: string }
): Promise<QueryResult> {
  if (isApiEnabled()) {
    return apiFetch<QueryResult>(`/api/v1/labs/${labId}/query`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  return {
    node: input.node,
    containerName: `clab-lab-${input.node}`,
    qname: input.qname,
    qtype: input.qtype ?? 'A',
    output: '(offline: no query executed)',
    exitCode: 0,
  };
}

export async function getConfigHealth(
  _store: StoreData,
  configId: string
): Promise<{ findings: HealthFinding[] }> {
  if (isApiEnabled()) {
    return apiFetch<{ findings: HealthFinding[] }>(`/api/v1/configurations/${configId}/health`);
  }
  return { findings: [] };
}

function fixtureTelemetrySnapshot(tick: number): TelemetrySnapshot {
  const cpuA = (0.15 + tick * 0.02).toFixed(2);
  const cpuB = (0.08 + tick * 0.03).toFixed(2);
  const memA = 12 + tick;
  const memB = 10 + tick;

  const nodes: TelemetryNode[] = [
    {
      nodeName: 'ns1',
      containerName: 'clab-dns-lab-topo-ns1',
      state: 'running',
      address: '10.70.0.11',
      cpuPerc: `${cpuA}%`,
      memPerc: `${(3.1 + tick * 0.1).toFixed(1)}%`,
      memUsage: `${memA}MiB / 2GiB`,
      netIO: '1.2MB / 800KB',
      blockIO: '0B / 0B',
      pids: '12',
      present: true,
    },
    {
      nodeName: 'ns2',
      containerName: 'clab-dns-lab-topo-ns2',
      state: 'running',
      address: '10.70.0.12',
      cpuPerc: `${cpuB}%`,
      memPerc: `${(2.4 + tick * 0.1).toFixed(1)}%`,
      memUsage: `${memB}MiB / 2GiB`,
      netIO: '900KB / 400KB',
      blockIO: '0B / 0B',
      pids: '11',
      present: true,
    },
    {
      nodeName: 'r1',
      containerName: 'clab-dns-lab-topo-r1',
      state: 'running',
      address: '10.70.0.1',
      cpuPerc: '0.05%',
      memPerc: '1.2%',
      memUsage: '8MiB / 2GiB',
      netIO: '300KB / 200KB',
      blockIO: '0B / 0B',
      pids: '8',
      present: true,
    },
  ];

  return { nodes, at: new Date().toISOString() };
}

export function openTelemetryStream(
  _store: StoreData,
  labId: string,
  onFrame: (snap: TelemetrySnapshot) => void
): () => void {
  if (isApiEnabled()) {
    // EventSource cannot send an Authorization header, so real-mode SSE auth is a
    // known follow-up. Do NOT put the bearer token in the query string — that
    // leaks it into server logs. Fixture mode is the supported offline path today.
    const es = new EventSource(resolveUrl(`/api/v1/labs/${labId}/telemetry/stream`));
    es.onmessage = (e) => {
      try {
        onFrame(JSON.parse(e.data));
      } catch {
        // ignore malformed frames
      }
    };
    return () => es.close();
  }

  let tick = 0;
  const emit = () => onFrame(fixtureTelemetrySnapshot(tick++));
  emit();
  const interval = window.setInterval(emit, 2500);
  return () => window.clearInterval(interval);
}

export async function getDeployJob(
  store: StoreData,
  id: string
): Promise<DeployJob | null> {
  if (isApiEnabled()) {
    try {
      return await apiFetch<DeployJob>(`/api/v1/deploy-jobs/${id}`);
    } catch (err: any) {
      if (err?.status === 404) {
        return null;
      }
      throw err;
    }
  }

  const job = (store.deployJobs || []).find((j) => j.id === id);
  if (job) return job;

  return {
    id,
    labId: 'lab-dns-1',
    status: 'SUCCEEDED',
    createdAt: new Date().toISOString(),
    result: {
      validated: [{ serverId: 'srv-lab-dns-1-ns1', ok: true, errors: [] }],
      deployed: [
        {
          serverId: 'srv-lab-dns-1-ns1',
          ok: true,
          output: 'dig @10.70.0.11 example.com. SOA -> OK (flags: qr aa; 0 errors)',
        },
      ],
    },
  };
}

export interface CreateDeployJobInput {
  changeSetItemIds: string[];
  targetServerIds: string[];
  warningAck?: boolean;
}

export class DeployPreflightError extends Error {
  code: string;
  preflight?: DeployPreflight;
  constructor(code: string, message: string, preflight?: DeployPreflight) {
    super(message);
    this.name = 'DeployPreflightError';
    this.code = code;
    this.preflight = preflight;
  }
}

export interface UnifiedDiff { mode: 'unified'; lines: DiffLine[]; }
export interface SplitDiff { mode: 'split'; left: DiffLine[]; right: DiffLine[]; }
export type ChangeSetDiff = UnifiedDiff | SplitDiff;

export async function getChangeSet(
  _store: StoreData,
  configId: string
): Promise<ChangeSetResponse> {
  if (isApiEnabled()) {
    return apiFetch<ChangeSetResponse>(`/api/v1/configurations/${configId}/change-set`);
  }
  return { items: [], groups: [] };
}

export async function getChangeSetDiff(
  _store: StoreData,
  configId: string,
  mode: 'unified' | 'split',
  serverId?: string
): Promise<ChangeSetDiff> {
  if (isApiEnabled()) {
    const qs = buildQueryString({ mode, server: serverId });
    return apiFetch<ChangeSetDiff>(`/api/v1/configurations/${configId}/change-set/diff${qs}`);
  }
  return mode === 'unified'
    ? { mode: 'unified', lines: [] }
    : { mode: 'split', left: [], right: [] };
}

export async function createDeployJob(
  store: StoreData,
  configId: string,
  input: CreateDeployJobInput
): Promise<{ jobId: string }> {
  if (isApiEnabled()) {
    try {
      return await apiFetch<{ jobId: string }>(`/api/v1/configurations/${configId}/deploy-jobs`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    } catch (err: any) {
      const code = err?.error?.code;
      const preflight = err?.error?.preflight;
      if (code === 'PREFLIGHT_FAILED' || code === 'PREFLIGHT_WARNING_UNACK') {
        throw new DeployPreflightError(code, err?.message ?? code, preflight);
      }
      throw err;
    }
  }

  const job = syntheticChangeSetDeployJob(configId, input.changeSetItemIds, input.targetServerIds);
  if (!store.deployJobs) store.deployJobs = [];
  store.deployJobs.push(job);
  return { jobId: job.id };
}

export async function getChangeSetDeployJob(
  store: StoreData,
  configId: string,
  jobId: string
): Promise<ChangeSetDeployJob | null> {
  if (isApiEnabled()) {
    try {
      return await apiFetch<ChangeSetDeployJob>(
        `/api/v1/configurations/${configId}/deploy-jobs/${jobId}`
      );
    } catch (err: any) {
      if (err?.status === 404) return null;
      throw err;
    }
  }
  const job = (store.deployJobs || []).find(
    (j) => j.id === jobId && j.configurationId === configId
  );
  return (job as ChangeSetDeployJob) ?? null;
}

export async function retryDeployJob(
  _store: StoreData,
  configId: string,
  jobId: string,
  serverId?: string
): Promise<{ jobId: string }> {
  if (isApiEnabled()) {
    return apiFetch<{ jobId: string }>(
      `/api/v1/configurations/${configId}/deploy-jobs/${jobId}/retry`,
      {
        method: 'POST',
        body: JSON.stringify(serverId ? { serverId } : {}),
      }
    );
  }
  return { jobId };
}

function syntheticChangeSetDeployJob(
  configId: string,
  changeSetItemIds: string[],
  targetServerIds: string[]
): ChangeSetDeployJob {
  const now = new Date().toISOString();
  return {
    id: 'job-' + Math.random().toString(16).slice(2, 10),
    configurationId: configId,
    changeSetItemIds,
    targetServerIds,
    status: 'SUCCEEDED',
    serverResults: targetServerIds.map((serverId) => ({
      serverId,
      outcome: 'SUCCEEDED',
      startedAt: now,
      finishedAt: now,
    })),
    createdAt: now,
  };
}


