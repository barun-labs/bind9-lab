import type { Configuration, View, Zone, ResourceRecord, ExternalHost, Acl } from '../../../shared/entities';

export type ServerRole = 'PRIMARY' | 'SECONDARY' | 'FORWARDER' | 'STUB' | 'RECURSIVE';

export interface Server {
  id: string;
  name?: string;
  serverGroupId?: string;
  // containerlab lab/node identity — see design/docs/entities.md.
  labName?: string;
  nodeName?: string;
  // Listen-on / data-plane addresses; visually distinct from a management
  // address. rootHints.ts reads serviceInterfaces[0].address for db.root.
  serviceInterfaces?: { address: string; port?: number }[];
  [key: string]: unknown;
}

export interface DeploymentRole {
  serverId: string;
  zoneId: string;
  role: ServerRole;
}

export interface DeploymentOption {
  scopeType: 'CONFIGURATION' | 'SERVER_GROUP' | 'SERVER' | 'VIEW' | 'ZONE';
  scopeId: string;
  key: string;
  value: unknown;
}

export interface ConfigModel {
  configuration: Configuration;
  views: View[];
  zones: Zone[];
  records: ResourceRecord[];
  servers: Server[];
  acls?: Acl[];
  roles: DeploymentRole[];
  options: DeploymentOption[];
  externalHosts?: ExternalHost[];
}

export type { Configuration, View, Zone, ResourceRecord, ExternalHost };
