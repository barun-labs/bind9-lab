import React, { createContext, useContext, useRef, useMemo, type ReactNode } from 'react';
import type {
  Configuration,
  View,
  Zone,
  ResourceRecord,
  ExternalHost,
  ApiKey,
} from '../types/entities';
import fixtures from '../../public/fixtures.json';
import * as api from './apiAdapter';

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
      createApiKey: (name: string) => api.createApiKey(store, name),
      deleteApiKey: (id: string) => api.deleteApiKey(store, id),
      search: (q: string) => api.search(store, q),
    }),
    [store]
  );
}
