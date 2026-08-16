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
export interface ServiceInterface { address: string; port: number; }
export interface Server {
  id: string;
  configurationId: string;
  hostname: string;
  labName?: string;
  nodeName?: string;
  mgmtAddress?: string;
  runtimeAddress?: string;   // populated by deploy-time reconcile (inspect IP)
  containerId?: string;
  runtimeState?: string;     // e.g. "running"
  serviceInterfaces?: ServiceInterface[];
  adminState?: string;
  syncState: SyncState | string;
  bindVersion?: string;
  lastDeployedAt?: string;
  trustKeyId?: string;
  trustKeyCreatedAt?: string;
  [key: string]: any;        // fixtures carry extra nested `services` etc — tolerate them
}
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

export interface NodeInterface {
  name: string;
  address: string;
}

export interface NodeRoute {
  to: string;
  via: string;
}

export interface NodeSpec {
  name: string;
  kind: 'linux' | 'bridge';
  intent?: 'bind' | 'router' | 'bridge';
  image?: string;
  mgmtIpv4?: string;
  binds?: string[];
  interfaces?: NodeInterface[];
  ipForward?: boolean;
  routes?: NodeRoute[];
  defaultVia?: string;
}

export interface LinkSpec {
  endpoints: [string, string];
}

export interface TopologyModel {
  name: string;
  mgmtNetwork?: string;
  mgmtSubnet?: string;
  nodes: NodeSpec[];
  links: LinkSpec[];
}

export interface Lab {
  id: string;
  name: string;
  configurationId: string;
  topology: TopologyModel;
  createdAt: string;
  updatedAt: string;
  lifecycleState?: 'NEVER_DEPLOYED' | 'DEPLOYED' | 'DESTROYED';
  lastDeployedAt?: string;
  lastDestroyedAt?: string;
}

export interface CreateLabInput {
  id?: string;
  name: string;
  configurationId: string;
  topology: TopologyModel;
}

export interface UpdateLabPatch {
  name?: string;
  configurationId?: string;
  topology?: TopologyModel;
}

export interface ImportLabInput {
  name?: string;
  configurationId: string;
  yaml: string;
}

export interface ServerValidationResult {
  serverId: string;
  ok: boolean;
  warnings?: string[];
  errors: string[];
}

export interface ValidateLabResult {
  topology: string[];
  perServer: ServerValidationResult[];
}

export interface DeployedServerResult {
  serverId: string;
  ok: boolean;
  output: string;
}

export interface DeployResult {
  validated: { serverId: string; ok: boolean; errors: string[] }[];
  plan?: string[];
  aborted?: string;
  deployed?: DeployedServerResult[];
}

export interface DeployJob {
  id: string;
  labId: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  result?: DeployResult;
  error?: string;
  createdAt: string;
}

export interface TelemetryNode {
  nodeName: string;
  containerName: string;
  containerId?: string;
  state?: string;
  status?: string;
  address?: string;
  cpuPerc?: string;
  memPerc?: string;
  memUsage?: string;
  netIO?: string;
  blockIO?: string;
  pids?: string;
  present: boolean;
}

export interface TelemetrySnapshot {
  nodes: TelemetryNode[];
  at: string;
  runtimeError?: string;
}

export interface ServerStatistics {
  serverId: string;
  nodeName: string;
  containerName: string;
  present: boolean;
  totalQueries?: number;
  responseCodes?: { NOERROR: number; NXDOMAIN: number; SERVFAIL: number; REFUSED: number };
  cacheHits?: number;
  cacheMisses?: number;
  cacheHitRatio?: number;
  recursionCount?: number;
}

export interface StatisticsSnapshot {
  servers: ServerStatistics[];
  at: string;
  runtimeError?: string;
}

export interface QueryResult {
  node: string;
  containerName: string;
  qname: string;
  qtype: string;
  server?: string;
  output: string;
  exitCode: number;
}

export interface HealthFinding {
  severity: 'ERROR' | 'WARNING' | 'INFO';
  code: string;
  message: string;
  subject?: string;
}

export type AclEntryType = 'ADDRESS'|'CIDR'|'ACL_NAME'|'KEY_NAME'|'ANY'|'NONE'|'LOCALHOST'|'LOCALNETS';
export interface AclEntry { id: string; order: number; type: AclEntryType; value: string|null; negated: boolean; }
export interface Acl { id: string; configurationId: string; name: string; entries: AclEntry[]; usedByCount: number; }
export interface AclTraceStep { entryId: string; type: string; value: string|null; negated: boolean; matched: boolean; }
export interface AclEvalResult { matched: boolean; decision: 'ALLOW'|'DENY'; trace: AclTraceStep[]; error?: string; }

export type TsigAlgorithm = 'hmac-sha256'|'hmac-sha512'|'hmac-sha384'|'hmac-sha224'|'hmac-sha1'|'hmac-md5';
export interface TsigKey { id: string; configurationId: string; name: string; algorithm: TsigAlgorithm; secret?: string; usedByCount: number; }
export interface ServerGroup { id: string; configurationId: string; name: string; description?: string; memberCount: number; }
export interface RecordTemplateEntry { name: string; type: RecordType; ttl?: number; rdata: Record<string, unknown>; disabled?: boolean; }
export interface RecordTemplate { id: string; configurationId: string; name: string; description?: string; entries: RecordTemplateEntry[]; }

export type ChangeSetItemAction = 'CREATE'|'UPDATE'|'DELETE'|'DISABLE'|'ENABLE';
export type ChangeSetObjectType = 'VIEW'|'ZONE'|'RECORD'|'ACL'|'SERVER';
export interface ChangeSetItem { id:string; configurationId:string; objectType:ChangeSetObjectType;
  objectId:string; objectLabel:string; groupKey:string; action:ChangeSetItemAction;
  diff:{before:unknown|null; after:unknown|null}; createdBy:'user'; }
export interface ChangeSetGroup { groupKey:string; objectType:ChangeSetObjectType; items:ChangeSetItem[]; }
export interface ChangeSetResponse { items:ChangeSetItem[]; groups:ChangeSetGroup[]; }
export interface DiffLine { kind:'context'|'add'|'del'; text:string; }
export type DeployOutcome = 'SUCCEEDED'|'FAILED'|'PARTIAL'|'CANCELLED';
export interface DeployPreflightCheck { serverId?:string; zoneId?:string; zoneName?:string;
  result:'OK'|'WARN'|'FAIL'; detail:string; }
export interface DeployPreflight { checkconf:DeployPreflightCheck[]; checkzone:DeployPreflightCheck[]; }
export interface DeployServerResult { serverId:string; outcome:DeployOutcome; startedAt:string;
  finishedAt?:string; stderr?:string; }
export interface ChangeSetDeployJob { id:string; configurationId:string; changeSetItemIds:string[];
  targetServerIds:string[]; status:'QUEUED'|'RUNNING'|'SUCCEEDED'|'FAILED'|'PARTIAL'|'CANCELLED';
  preflight?:DeployPreflight; serverResults:DeployServerResult[]; warningAck?:boolean; createdAt:string; }

