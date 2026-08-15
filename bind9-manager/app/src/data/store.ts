import React, { createContext, useContext, useRef, useMemo, type ReactNode } from 'react';
import type {
  Configuration,
  View,
  Zone,
  ResourceRecord,
  ExternalHost,
  ApiKey,
  User,
  RoleAssignment,
  Lab,
  TelemetrySnapshot,
} from '../types/entities';
import { seedUsers } from './users.seed';
import fixtures from '../../public/fixtures.json';
import * as api from './apiAdapter';

export const seedLabs: Lab[] = [
  {
    id: 'lab-dns-1',
    name: 'dns-lab-topo',
    configurationId: 'dns-lab',
    topology: {
      name: 'dns-lab-topo',
      mgmtNetwork: 'clab-mgmt',
      mgmtSubnet: '10.70.0.0/24',
      nodes: [
        {
          name: 'ns1',
          kind: 'linux',
          intent: 'bind',
          image: 'dnsnode:1.0',
          mgmtIpv4: '10.70.0.11',
          interfaces: [{ name: 'eth1', address: '10.70.0.11/24' }],
        },
        {
          name: 'ns2',
          kind: 'linux',
          intent: 'bind',
          image: 'dnsnode:1.0',
          mgmtIpv4: '10.70.0.12',
          interfaces: [{ name: 'eth1', address: '10.70.0.12/24' }],
        },
        {
          name: 'r1',
          kind: 'linux',
          intent: 'router',
          image: 'dnsnode:1.0',
          mgmtIpv4: '10.70.0.1',
          interfaces: [
            { name: 'eth1', address: '10.70.0.1/24' },
            { name: 'eth2', address: '10.70.0.2/24' },
          ],
        },
      ],
      links: [
        { endpoints: ['ns1:eth1', 'r1:eth1'] },
        { endpoints: ['ns2:eth1', 'r1:eth2'] },
      ],
    },
    createdAt: '2026-08-15T10:00:00Z',
    updatedAt: '2026-08-15T10:00:00Z',
  },
];

export interface StoreData {
  configurations: Configuration[];
  views: View[];
  zones: Zone[];
  records: ResourceRecord[];
  externalHosts: ExternalHost[];
  networkBlocks: any[];
  servers: any[];
  deploymentRoles: any[];
  deploymentOptions: any[];
  changeSet: any[];
  deployJobs: any[];
  snapshots: any[];
  apiKeys: ApiKey[];
  users: User[];
  labs: Lab[];
}

export type Store = StoreData;

export function makeStore(initialData?: Partial<StoreData>): StoreData {
  const cloned = structuredClone(fixtures) as unknown as Partial<StoreData>;
  return {
    configurations: cloned.configurations ?? [],
    views: cloned.views ?? [],
    zones: cloned.zones ?? [],
    records: cloned.records ?? [],
    externalHosts: cloned.externalHosts ?? [],
    networkBlocks: cloned.networkBlocks ?? [],
    servers: cloned.servers ?? [],
    deploymentRoles: cloned.deploymentRoles ?? [],
    deploymentOptions: cloned.deploymentOptions ?? [],
    changeSet: cloned.changeSet ?? [],
    deployJobs: cloned.deployJobs ?? [],
    snapshots: cloned.snapshots ?? [],
    apiKeys: cloned.apiKeys ?? [],
    users: cloned.users ?? structuredClone(seedUsers),
    labs: cloned.labs ?? structuredClone(seedLabs),
    ...initialData,
  };
}

const StoreContext = createContext<StoreData | null>(null);

export interface StoreProviderProps {
  children: ReactNode;
  initialStore?: StoreData;
}

export function StoreProvider({ children, initialStore }: StoreProviderProps) {
  const storeRef = useRef<StoreData | null>(null);
  if (!storeRef.current) {
    storeRef.current = initialStore ?? makeStore();
  }
  return React.createElement(StoreContext.Provider, { value: storeRef.current }, children);
}

const defaultStore = makeStore();

export function useStore(): StoreData {
  const context = useContext(StoreContext);
  return context ?? defaultStore;
}

export function useApi() {
  const store = useStore();
  return useMemo(
    () => ({
      listConfigurations: (params?: api.ListParams) => api.listConfigurations(store, params),
      listViews: (configId: string, params?: api.ListParams) => api.listViews(store, configId, params),
      listZones: (configId: string, filters?: api.ZoneFilters) => api.listZones(store, configId, filters),
      getZone: (zoneId: string) => api.getZone(store, zoneId),
      listRecords: (zoneId: string, filters?: api.RecordFilters) => api.listRecords(store, zoneId, filters),
      createRecord: (zoneId: string, input: api.CreateRecordInput) => api.createRecord(store, zoneId, input),
      updateRecord: (id: string, patch: api.UpdateRecordPatch) => api.updateRecord(store, id, patch),
      deleteRecord: (id: string) => api.deleteRecord(store, id),
      setRecordDisabled: (id: string, disabled: boolean) => api.setRecordDisabled(store, id, disabled),
      listExternalHosts: (configId: string, params?: api.ListParams) => api.listExternalHosts(store, configId, params),
      listApiKeys: (params?: api.ListParams) => api.listApiKeys(store, params),
      createApiKey: (input: string | api.CreateApiKeyInput) => api.createApiKey(store, input),
      deleteApiKey: (id: string) => api.deleteApiKey(store, id),
      listUsers: (params?: api.ListParams) => api.listUsers(store, params),
      setUserRole: (userId: string, assignment: RoleAssignment) => api.setUserRole(store, userId, assignment),
      setUserActive: (userId: string, isActive: boolean) => api.setUserActive(store, userId, isActive),
      search: (q: string) => api.search(store, q),
      listLabs: (configId: string, params?: api.ListParams) => api.listLabs(store, configId, params),
      getLab: (id: string) => api.getLab(store, id),
      listServers: (configId: string) => api.listServers(store, configId),
      getServer: (configId: string, id: string) => api.getServer(store, configId, id),
      createLab: (input: api.CreateLabInput) => api.createLab(store, input),
      updateLab: (id: string, patch: api.UpdateLabPatch) => api.updateLab(store, id, patch),
      deleteLab: (id: string) => api.deleteLab(store, id),
      renderLab: (id: string) => api.renderLab(store, id),
      importLab: (input: api.ImportLabInput) => api.importLab(store, input),
      validateLab: (id: string) => api.validateLab(store, id),
      deployLab: (id: string) => api.deployLab(store, id),
      getDeployJob: (jobId: string) => api.getDeployJob(store, jobId),
      getNodeLogs: (labId: string, node: string, tail?: number) => api.getNodeLogs(store, labId, node, tail),
      openTelemetryStream: (labId: string, onFrame: (snap: TelemetrySnapshot) => void) => api.openTelemetryStream(store, labId, onFrame),
    }),
    [store]
  );
}

