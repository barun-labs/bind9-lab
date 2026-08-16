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

