export type RecordType = 'A'|'AAAA'|'CNAME'|'MX'|'TXT'|'SRV'|'NS'|'PTR'|'CAA'|'ALIAS';
export type SyncState = 'SYNCED'|'PENDING'|'DEPLOYING'|'DRIFT'|'ERROR'|'NODE_ABSENT'|'UNREACHABLE';
export type ZoneType = 'PRIMARY'|'SECONDARY'|'FORWARD'|'STUB';

export type Permission = 'view'|'edit'|'deploy'|'admin';
export interface RoleAssignment { configurationId: string; role: 'viewer'|'editor'|'admin'; canDeploy: boolean }
export interface User { id: string; username: string; displayName: string; isActive: boolean; roles: RoleAssignment[] }

export type Rdata =
  | { type: 'A'|'AAAA'; address: string }
  | { type: 'CNAME'|'NS'|'ALIAS'; target: string }
  | { type: 'MX'; priority: number; target: string }
  | { type: 'SRV'; priority: number; weight: number; port: number; target: string }
  | { type: 'TXT'; text: string }
  | { type: 'PTR'; target: string }
  | { type: 'CAA'; flags: number; tag: string; value: string };

export interface ResourceRecord {
  id: string; zoneId: string; name: string; type: RecordType; ttl: number;
  rdata: Record<string, unknown>;
  disabled: boolean; syncState: SyncState; issue: string | null;
}
export interface Zone {
  id: string; configurationId: string; viewId: string; name: string; type: ZoneType;
  soa: { primaryNs: string; adminEmail: string; serial: number; refresh: number; retry: number; expire: number; minimum: number };
  allowTransfer?: string[]; allowUpdate?: string[]; recordCount: number; syncState: SyncState;
}
export interface View { id: string; configurationId: string; name: string; order: number; matchClients: string[]; zoneCount: number; }
export interface Configuration {
  id: string; name: string; description?: string; isActive: boolean;
  createdFromTemplateId: string | null; createdAt: string; updatedAt: string; lastDeployedAt?: string;
  counts: { views: number; zones: number; records: number; servers: number };
}
export interface ExternalHost { id: string; configurationId: string; fqdn: string; referenceCount: number; }
export type AclEntryType = 'ADDRESS' | 'CIDR' | 'ACL_NAME' | 'KEY_NAME' | 'ANY' | 'NONE' | 'LOCALHOST' | 'LOCALNETS';
export interface AclEntry {
  id: string; order: number; type: AclEntryType;
  value: string | null;   // address / CIDR / referenced ACL name / key name; null for ANY/NONE/LOCALHOST/LOCALNETS
  negated: boolean;
}
export interface Acl { id: string; configurationId: string; name: string; entries: AclEntry[]; usedByCount: number; }
export type OptionScope = 'VIEW' | 'ZONE';
export type InheritMode = 'INHERIT' | 'OVERRIDE' | 'DISABLE';
export interface DeploymentOptionRow { id: string; configurationId: string; scope: OptionScope; scopeId: string; key: string; value: unknown | null; disabled: boolean; }
export interface DeploymentRoleRow { id: string; configurationId: string; scope: OptionScope; scopeId: string; serverId: string; role: string; disabled: boolean; }
export interface EffectiveOption { key: string; mode: InheritMode; effectiveValue: unknown | null; inheritedValue: unknown | null; }
export interface ApiKey {
  id: string;
  name: string;
  ownerUserId: string;
  scopes: ('read'|'write'|'deploy')[];
  readOnly: boolean;
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  token?: string;
}

export interface ListEnvelope<T> { data: T[]; page: number; size: number; total: number; }
export interface ApiError { error: { code: string; message: string; field?: string; details?: unknown }; }

export type ChangeSetItemAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'DISABLE' | 'ENABLE';
export type ChangeSetObjectType = 'VIEW' | 'ZONE' | 'RECORD' | 'ACL' | 'SERVER' | 'OPTION' | 'ROLE';
export interface ChangeSetItem {
  id: string;                 // deterministic + stable: `cs-${objectType}-${objectId}`
  configurationId: string;
  objectType: ChangeSetObjectType;
  objectId: string;
  objectLabel: string;        // human label: zone name, record fqdn, view name, acl name, server id
  groupKey: string;           // UI grouping key: zone name for RECORD/ZONE, else objectType
  action: ChangeSetItemAction;
  diff: { before: unknown | null; after: unknown | null };
  createdBy: 'user';
}
export type DeployOutcome = 'SUCCEEDED' | 'FAILED' | 'PARTIAL' | 'CANCELLED';
export interface DeployPreflightCheck { serverId?: string; zoneId?: string; zoneName?: string;
  result: 'OK' | 'WARN' | 'FAIL'; detail: string; }
export interface DeployPreflight { checkconf: DeployPreflightCheck[]; checkzone: DeployPreflightCheck[]; }
export interface DeployServerResult { serverId: string; outcome: DeployOutcome;
  startedAt: string; finishedAt?: string; stderr?: string; }
export interface ChangeSetDeployJob {
  id: string;                 // `csdj-`+randomBytes(6).hex
  configurationId: string;
  changeSetItemIds: string[];
  targetServerIds: string[];
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'PARTIAL' | 'CANCELLED';
  preflight?: DeployPreflight;
  serverResults: DeployServerResult[];
  warningAck?: boolean;
  createdAt: string;
}
