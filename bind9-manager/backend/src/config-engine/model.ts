import type { Configuration, View, Zone, ResourceRecord, ExternalHost } from '../../../shared/entities';

export type ServerRole = 'PRIMARY' | 'SECONDARY' | 'FORWARDER' | 'STUB' | 'RECURSIVE';

export interface Server {
  id: string;
  name?: string;
  serverGroupId?: string;
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
  roles: DeploymentRole[];
  options: DeploymentOption[];
  externalHosts?: ExternalHost[];
}

export type { Configuration, View, Zone, ResourceRecord, ExternalHost };
