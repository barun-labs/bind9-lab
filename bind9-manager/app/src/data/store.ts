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
  Acl,
  TsigKey,
  ServerGroup,
  Block,
  RecordTemplate,
  RpzPolicy,
  RpzRule,
  Snapshot,
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
  acls: Acl[];
  tsigKeys: TsigKey[];
  serverGroups: ServerGroup[];
  recordTemplates: RecordTemplate[];
  rpzPolicies: RpzPolicy[];
  rpzRules: RpzRule[];
  zones: Zone[];
  records: ResourceRecord[];
  externalHosts: ExternalHost[];
  networkBlocks: Block[];
  servers: any[];
  deploymentRoles: any[];
  deploymentOptions: any[];
  changeSet: any[];
  deployJobs: any[];
  snapshots: Snapshot[];
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
    acls: cloned.acls ?? [],
    tsigKeys: cloned.tsigKeys ?? [],
    serverGroups: cloned.serverGroups ?? [],
    recordTemplates: cloned.recordTemplates ?? [],
    rpzPolicies: cloned.rpzPolicies ?? [],
    rpzRules: cloned.rpzRules ?? [],
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
      createConfiguration: (input: api.CreateConfigurationInput) => api.createConfiguration(store, input),
      updateConfiguration: (configId: string, patch: api.UpdateConfigurationPatch) => api.updateConfiguration(store, configId, patch),
      deleteConfiguration: (configId: string) => api.deleteConfiguration(store, configId),
      cloneConfiguration: (configId: string, input: api.CreateConfigurationInput) => api.cloneConfiguration(store, configId, input),
      listViews: (configId: string) => api.listViews(store, configId),
      createView: (configId: string, input: api.CreateViewInput) => api.createView(store, configId, input),
      updateView: (configId: string, id: string, patch: api.UpdateViewPatch) => api.updateView(store, configId, id, patch),
      deleteView: (configId: string, id: string) => api.deleteView(store, configId, id),
      listAcls: (configId: string) => api.listAcls(store, configId),
      getAcl: (configId: string, aclId: string) => api.getAcl(store, configId, aclId),
      createAcl: (configId: string, input: api.CreateAclInput) => api.createAcl(store, configId, input),
      updateAcl: (configId: string, aclId: string, patch: api.UpdateAclPatch) => api.updateAcl(store, configId, aclId, patch),
      deleteAcl: (configId: string, aclId: string) => api.deleteAcl(store, configId, aclId),
      evaluateAcl: (configId: string, input: { target: string; clientIp: string }) => api.evaluateAcl(store, configId, input),
      listTsigKeys: (configId: string) => api.listTsigKeys(store, configId),
      createTsigKey: (configId: string, input: api.CreateTsigKeyInput) => api.createTsigKey(store, configId, input),
      deleteTsigKey: (configId: string, keyId: string) => api.deleteTsigKey(store, configId, keyId),
      listServerGroups: (configId: string) => api.listServerGroups(store, configId),
      getServerGroup: (configId: string, groupId: string) => api.getServerGroup(store, configId, groupId),
      createServerGroup: (configId: string, input: api.CreateServerGroupInput) => api.createServerGroup(store, configId, input),
      updateServerGroup: (configId: string, groupId: string, patch: api.UpdateServerGroupPatch) => api.updateServerGroup(store, configId, groupId, patch),
      deleteServerGroup: (configId: string, groupId: string) => api.deleteServerGroup(store, configId, groupId),
      listBlocks: (configId: string) => api.listBlocks(store, configId),
      getBlock: (configId: string, blockId: string) => api.getBlock(store, configId, blockId),
      createBlock: (configId: string, input: api.CreateBlockInput) => api.createBlock(store, configId, input),
      updateBlock: (configId: string, blockId: string, patch: api.UpdateBlockPatch) => api.updateBlock(store, configId, blockId, patch),
      deleteBlock: (configId: string, blockId: string) => api.deleteBlock(store, configId, blockId),
      reconcileBlock: (configId: string, blockId: string) => api.reconcileBlock(store, configId, blockId),
      listRecordTemplates: (configId: string) => api.listRecordTemplates(store, configId),
      getRecordTemplate: (configId: string, templateId: string) => api.getRecordTemplate(store, configId, templateId),
      createRecordTemplate: (configId: string, input: api.CreateRecordTemplateInput) => api.createRecordTemplate(store, configId, input),
      deleteRecordTemplate: (configId: string, templateId: string) => api.deleteRecordTemplate(store, configId, templateId),
      listRpzPolicies: (configId: string) => api.listRpzPolicies(store, configId),
      getRpzPolicy: (configId: string, policyId: string) => api.getRpzPolicy(store, configId, policyId),
      createRpzPolicy: (configId: string, input: api.CreateRpzPolicyInput) => api.createRpzPolicy(store, configId, input),
      deleteRpzPolicy: (configId: string, policyId: string) => api.deleteRpzPolicy(store, configId, policyId),
      listRpzRules: (configId: string, policyId: string) => api.listRpzRules(store, configId, policyId),
      createRpzRule: (configId: string, policyId: string, input: api.CreateRpzRuleInput) => api.createRpzRule(store, configId, policyId, input),
      updateRpzRule: (configId: string, ruleId: string, patch: api.UpdateRpzRulePatch) => api.updateRpzRule(store, configId, ruleId, patch),
      deleteRpzRule: (configId: string, ruleId: string) => api.deleteRpzRule(store, configId, ruleId),
      listSnapshots: (configId: string) => api.listSnapshots(store, configId),
      getSnapshot: (configId: string, id: string) => api.getSnapshot(store, configId, id),
      captureSnapshot: (configId: string, input: api.CreateSnapshotInput) => api.captureSnapshot(store, configId, input),
      adoptSnapshot: (configId: string) => api.adoptSnapshot(store, configId),
      restoreSnapshot: (configId: string, id: string) => api.restoreSnapshot(store, configId, id),
      deleteSnapshot: (configId: string, id: string) => api.deleteSnapshot(store, configId, id),
      listZones: (configId: string, filters?: api.ZoneFilters) => api.listZones(store, configId, filters),
      getZone: (zoneId: string) => api.getZone(store, zoneId),
      listRecords: (zoneId: string, filters?: api.RecordFilters) => api.listRecords(store, zoneId, filters),
      createRecord: (zoneId: string, input: api.CreateRecordInput) => api.createRecord(store, zoneId, input),
      updateRecord: (id: string, patch: api.UpdateRecordPatch) => api.updateRecord(store, id, patch),
      deleteRecord: (id: string) => api.deleteRecord(store, id),
      setRecordDisabled: (id: string, disabled: boolean) => api.setRecordDisabled(store, id, disabled),
      listExternalHosts: (configId: string, params?: api.ListParams) => api.listExternalHosts(store, configId, params),
      listDeploymentOptions: (configId: string, scope: api.OptionScope, scopeId: string) => api.listDeploymentOptions(store, configId, scope, scopeId),
      listDeploymentRoles: (configId: string, scope: api.OptionScope, scopeId: string) => api.listDeploymentRoles(store, configId, scope, scopeId),
      createDeploymentOption: (configId: string, input: api.CreateDeploymentOptionInput) => api.createDeploymentOption(store, configId, input),
      updateDeploymentOption: (configId: string, optionId: string, patch: api.UpdateDeploymentOptionPatch) => api.updateDeploymentOption(store, configId, optionId, patch),
      deleteDeploymentOption: (configId: string, optionId: string) => api.deleteDeploymentOption(store, configId, optionId),
      getEffectiveZoneOptions: (configId: string, zoneId: string) => api.getEffectiveZoneOptions(store, configId, zoneId),
      createDeploymentRole: (configId: string, input: api.CreateDeploymentRoleInput) => api.createDeploymentRole(store, configId, input),
      updateDeploymentRole: (configId: string, roleId: string, patch: api.UpdateDeploymentRolePatch) => api.updateDeploymentRole(store, configId, roleId, patch),
      deleteDeploymentRole: (configId: string, roleId: string) => api.deleteDeploymentRole(store, configId, roleId),
      getEffectiveZoneRoles: (configId: string, zoneId: string) => api.getEffectiveZoneRoles(store, configId, zoneId),
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
      createServer: (configId: string, input: api.CreateServerInput) => api.createServer(store, configId, input),
      deleteServer: (configId: string, id: string) => api.deleteServer(store, configId, id),
      createLab: (input: api.CreateLabInput) => api.createLab(store, input),
      updateLab: (id: string, patch: api.UpdateLabPatch) => api.updateLab(store, id, patch),
      deleteLab: (id: string) => api.deleteLab(store, id),
      renderLab: (id: string) => api.renderLab(store, id),
      importLab: (input: api.ImportLabInput) => api.importLab(store, input),
      validateLab: (id: string) => api.validateLab(store, id),
      deployLab: (id: string) => api.deployLab(store, id),
      destroyLab: (labId: string) => api.destroyLab(store, labId),
      getDeployJob: (jobId: string) => api.getDeployJob(store, jobId),
      getNodeLogs: (labId: string, node: string, tail?: number) => api.getNodeLogs(store, labId, node, tail),
      openTelemetryStream: (labId: string, onFrame: (snap: TelemetrySnapshot) => void) => api.openTelemetryStream(store, labId, onFrame),
      getLabStatistics: (labId: string) => api.getLabStatistics(store, labId),
      runQuery: (labId: string, input: { node: string; qname: string; qtype?: string; server?: string }) => api.runQuery(store, labId, input),
      getConfigHealth: (configId: string) => api.getConfigHealth(store, configId),
      getChangeSet: (configId: string) => api.getChangeSet(store, configId),
      getChangeSetDiff: (configId: string, mode: 'unified' | 'split', serverId?: string) => api.getChangeSetDiff(store, configId, mode, serverId),
      createDeployJob: (configId: string, input: api.CreateDeployJobInput) => api.createDeployJob(store, configId, input),
      getChangeSetDeployJob: (configId: string, jobId: string) => api.getChangeSetDeployJob(store, configId, jobId),
      retryDeployJob: (configId: string, jobId: string, serverId?: string) => api.retryDeployJob(store, configId, jobId, serverId),
    }),
    [store]
  );
}

