import type { ConfigModel, ResourceRecord } from '../config-engine/model';

// Exercises DeploymentRoles + DeploymentOptions end to end against a real,
// small containerlab deploy (see docs/superpowers/specs/2026-08-15-testlab-roles-options-deploy.md).
// Four BIND servers, one non-BIND router (provisioned by deployEngine's
// data-plane step but absent from `servers` since it carries no DNS role):
//   auth      PRIMARY for "test"     — records for ns.test / www.test
//   root      PRIMARY for "."        — root zone + delegation of "test." to ns.test.
//   recursive RECURSIVE for "."      — root-hints db.root generated from the root zone
//   cache     FORWARDER for "."      — forward-only to the recursive server

const testZoneRecords: ResourceRecord[] = [
  {
    id: 'rec-test-ns',
    zoneId: 'zone-test',
    name: '@',
    type: 'NS',
    ttl: 86400,
    rdata: { target: 'ns.test.' },
    disabled: false,
    syncState: 'SYNCED',
    issue: null,
  },
  {
    id: 'rec-test-ns-a',
    zoneId: 'zone-test',
    name: 'ns',
    type: 'A',
    ttl: 86400,
    rdata: { address: '10.60.2.30' },
    disabled: false,
    syncState: 'SYNCED',
    issue: null,
  },
  {
    id: 'rec-test-www',
    zoneId: 'zone-test',
    name: 'www',
    type: 'A',
    ttl: 86400,
    rdata: { address: '10.99.0.1' },
    disabled: false,
    syncState: 'SYNCED',
    issue: null,
  },
];

const rootZoneRecords: ResourceRecord[] = [
  {
    id: 'rec-root-ns',
    zoneId: 'zone-root',
    name: '@',
    type: 'NS',
    ttl: 86400,
    rdata: { target: 'ns.root.' },
    disabled: false,
    syncState: 'SYNCED',
    issue: null,
  },
  {
    id: 'rec-root-ns-a',
    zoneId: 'zone-root',
    name: 'ns.root.',
    type: 'A',
    ttl: 86400,
    rdata: { address: '10.60.2.53' },
    disabled: false,
    syncState: 'SYNCED',
    issue: null,
  },
  {
    id: 'rec-root-deleg-test-ns',
    zoneId: 'zone-root',
    name: 'test.',
    type: 'NS',
    ttl: 86400,
    rdata: { target: 'ns.test.' },
    disabled: false,
    syncState: 'SYNCED',
    issue: null,
  },
  {
    id: 'rec-root-deleg-test-glue',
    zoneId: 'zone-root',
    name: 'ns.test.',
    type: 'A',
    ttl: 86400,
    rdata: { address: '10.60.2.30' },
    disabled: false,
    syncState: 'SYNCED',
    issue: null,
  },
];

const allRecords: ResourceRecord[] = [...testZoneRecords, ...rootZoneRecords];

export const testlabModel: ConfigModel = {
  configuration: {
    id: 'cfg-testlab',
    name: 'testlab',
    description: 'Test lab exercising DeploymentRoles + DeploymentOptions end-to-end',
    isActive: true,
    createdFromTemplateId: null,
    createdAt: '2026-08-15T00:00:00Z',
    updatedAt: '2026-08-15T00:00:00Z',
    counts: { views: 1, zones: 2, records: allRecords.length, servers: 4 },
  },
  servers: [
    {
      id: 'auth',
      name: 'auth',
      labName: 'bind9mgr-testlab',
      nodeName: 'auth',
      serviceInterfaces: [{ address: '10.60.2.30', port: 53 }],
    },
    {
      id: 'root',
      name: 'root',
      labName: 'bind9mgr-testlab',
      nodeName: 'root',
      serviceInterfaces: [{ address: '10.60.2.53', port: 53 }],
    },
    {
      id: 'recursive',
      name: 'recursive',
      labName: 'bind9mgr-testlab',
      nodeName: 'recursive',
      serviceInterfaces: [{ address: '10.60.1.20', port: 53 }],
    },
    {
      id: 'cache',
      name: 'cache',
      labName: 'bind9mgr-testlab',
      nodeName: 'cache',
      serviceInterfaces: [{ address: '10.60.1.10', port: 53 }],
    },
  ],
  // A single shared view. generateNamedConf renders every view in the model
  // for every server, so a second view would leak onto servers that don't
  // own it: since generateNamedConf's implicit-hint fallback and BIND's
  // first-match view semantics don't know or care that a view is empty for
  // a given server, an empty (or accidentally hint-injected) phantom view
  // listed before a server's real view would shadow it outright. One view
  // sidesteps that: zonesForServer already scopes each server to only its
  // own DeploymentRole entries, so each server's view block ends up with
  // exactly its own zone(s) and nothing else.
  views: [
    {
      id: 'view-main',
      configurationId: 'cfg-testlab',
      name: 'main',
      order: 1,
      matchClients: ['any'],
      zoneCount: 2,
    },
  ],
  zones: [
    {
      id: 'zone-test',
      configurationId: 'cfg-testlab',
      viewId: 'view-main',
      name: 'test',
      type: 'PRIMARY',
      soa: {
        primaryNs: 'ns.test.',
        adminEmail: 'hostmaster.test.',
        serial: 2026081501,
        refresh: 3600,
        retry: 1800,
        expire: 604800,
        minimum: 86400,
      },
      allowTransfer: ['any'],
      recordCount: testZoneRecords.length,
      syncState: 'SYNCED',
    },
    {
      id: 'zone-root',
      configurationId: 'cfg-testlab',
      viewId: 'view-main',
      name: '.',
      type: 'PRIMARY',
      soa: {
        primaryNs: 'ns.root.',
        adminEmail: 'hostmaster.root.',
        serial: 2026081501,
        refresh: 3600,
        retry: 1800,
        expire: 604800,
        minimum: 86400,
      },
      allowTransfer: ['any'],
      recordCount: rootZoneRecords.length,
      syncState: 'SYNCED',
    },
  ],
  records: allRecords,
  roles: [
    { serverId: 'auth', zoneId: 'zone-test', role: 'PRIMARY' },
    { serverId: 'root', zoneId: 'zone-root', role: 'PRIMARY' },
    { serverId: 'recursive', zoneId: 'zone-root', role: 'RECURSIVE' },
    { serverId: 'cache', zoneId: 'zone-root', role: 'FORWARDER' },
  ],
  options: [
    // Configuration-scope defaults
    { scopeType: 'CONFIGURATION', scopeId: 'cfg-testlab', key: 'directory', value: '/var/bind' },
    { scopeType: 'CONFIGURATION', scopeId: 'cfg-testlab', key: 'dnssec-validation', value: 'no' },
    { scopeType: 'CONFIGURATION', scopeId: 'cfg-testlab', key: 'empty-zones-enable', value: 'no' },

    // DeploymentOptions under test — recursion/dnssec-validation scoped at
    // SERVER level so each node's own behavior holds even where two nodes
    // share the "." zone (root PRIMARY / cache FORWARDER / recursive
    // RECURSIVE all resolve recursion independently via SERVER scope,
    // which wins over the shared VIEW scope).
    //
    // forward/forwarders are scoped to ZONE (zone-root), not SERVER: the
    // FORWARDER role already renders `forward`/`forwarders` inside the
    // `zone "." { type forward; ... };` stanza. If the same key also
    // resolved at the view/options level (which a SERVER-scoped option
    // would do, since renderView's own forwarders/forward lookup has no
    // zoneId to exclude it), named-checkconf rejects the config with
    // "forwarders declared in root zone and in general configuration".
    { scopeType: 'SERVER', scopeId: 'cache', key: 'recursion', value: true },
    { scopeType: 'ZONE', scopeId: 'zone-root', key: 'forward', value: 'only' },
    { scopeType: 'ZONE', scopeId: 'zone-root', key: 'forwarders', value: ['10.60.1.20'] },

    { scopeType: 'SERVER', scopeId: 'recursive', key: 'recursion', value: true },
    { scopeType: 'SERVER', scopeId: 'recursive', key: 'dnssec-validation', value: 'no' },

    { scopeType: 'SERVER', scopeId: 'auth', key: 'recursion', value: false },
    { scopeType: 'SERVER', scopeId: 'root', key: 'recursion', value: false },

    // Zone-level
    { scopeType: 'ZONE', scopeId: 'zone-test', key: 'allow-transfer', value: ['any'] },
    { scopeType: 'ZONE', scopeId: 'zone-root', key: 'allow-transfer', value: ['any'] },
  ],
};
