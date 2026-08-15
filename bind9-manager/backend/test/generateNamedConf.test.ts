import { describe, it, expect } from 'vitest';
import { generateNamedConf } from '../src/config-engine/generateNamedConf';
import type { ConfigModel } from '../src/config-engine/model';
import type { Configuration, View, Zone, ResourceRecord } from '../../shared/entities';

describe('generateNamedConf', () => {
  const dummyConfig: Configuration = {
    id: 'cfg-1',
    name: 'test-config',
    isActive: true,
    createdFromTemplateId: null,
    createdAt: '2026-08-15T00:00:00Z',
    updatedAt: '2026-08-15T00:00:00Z',
    counts: { views: 2, zones: 2, records: 0, servers: 2 },
  };

  const records: ResourceRecord[] = [];

  it('(a) generates named.conf for a cache-style server with a forward-only view', () => {
    const viewCache: View = {
      id: 'view-cache',
      configurationId: 'cfg-1',
      name: 'cache',
      order: 1,
      matchClients: ['172.21.21.1'],
      zoneCount: 0,
    };

    const model: ConfigModel = {
      configuration: dummyConfig,
      views: [viewCache],
      zones: [],
      records,
      servers: [{ id: 'bc-cache1' }],
      roles: [],
      options: [
        {
          scopeType: 'SERVER',
          scopeId: 'bc-cache1',
          key: 'dnssec-validation',
          value: 'no',
        },
        {
          scopeType: 'VIEW',
          scopeId: 'view-cache',
          key: 'match-clients',
          value: ['172.21.21.1'],
        },
        {
          scopeType: 'VIEW',
          scopeId: 'view-cache',
          key: 'allow-query',
          value: ['172.21.21.1'],
        },
        {
          scopeType: 'VIEW',
          scopeId: 'view-cache',
          key: 'allow-query-cache',
          value: ['172.21.21.1'],
        },
        {
          scopeType: 'VIEW',
          scopeId: 'view-cache',
          key: 'allow-recursion',
          value: ['172.21.21.1'],
        },
        {
          scopeType: 'VIEW',
          scopeId: 'view-cache',
          key: 'recursion',
          value: true,
        },
        {
          scopeType: 'VIEW',
          scopeId: 'view-cache',
          key: 'dnssec-validation',
          value: 'no',
        },
        {
          scopeType: 'VIEW',
          scopeId: 'view-cache',
          key: 'forwarders',
          value: ['172.23.23.97', '172.23.23.129', '172.23.23.100'],
        },
        {
          scopeType: 'VIEW',
          scopeId: 'view-cache',
          key: 'forward',
          value: 'only',
        },
      ],
    };

    const out = generateNamedConf(model, 'bc-cache1');

    // Assert options block
    expect(out).toContain('options {');
    expect(out).toContain('directory "/var/bind";');
    expect(out).toContain('listen-on { any; };');
    expect(out).toContain('listen-on-v6 { none; };');
    expect(out).toContain('dnssec-validation no;');
    expect(out).toContain('empty-zones-enable no;');

    // Assert logging block
    expect(out).toContain('logging {');
    expect(out).toContain('channel default_log {');
    expect(out).toContain('file "/var/log/named.log" versions 3 size 5m;');
    expect(out).toContain('category default { default_log; };');
    expect(out).toContain('category queries { default_log; };');
    expect(out).toContain('category resolver { default_log; };');

    // Assert controls block
    expect(out).toContain('include "/etc/bind/rndc.key";');
    expect(out).toContain('controls {');
    expect(out).toContain('inet 127.0.0.1 allow { localhost; } keys { "rndc-key"; };');

    // Assert view block contains forward only, forwarders list, match-clients, and hint zone
    expect(out).toContain('view "cache" {');
    expect(out).toContain('match-clients { 172.21.21.1; };');
    expect(out).toContain('forward only;');
    expect(out).toContain('forwarders { 172.23.23.97; 172.23.23.129; 172.23.23.100; };');
    expect(out).toContain('allow-query { 172.21.21.1; };');
    expect(out).toContain('allow-query-cache { 172.21.21.1; };');
    expect(out).toContain('allow-recursion { 172.21.21.1; };');
    expect(out).toContain('recursion yes;');
    expect(out).toContain('zone "." {');
    expect(out).toContain('type hint;');
    expect(out).toContain('file "/etc/bind/db.root";');
  });

  it('(b) generates named.conf for a server that is PRIMARY for a zone', () => {
    const viewAuth: View = {
      id: 'view-auth',
      configurationId: 'cfg-1',
      name: 'authoritative',
      order: 1,
      matchClients: ['any'],
      zoneCount: 1,
    };

    const zoneLabTest: Zone = {
      id: 'zone-lab',
      configurationId: 'cfg-1',
      viewId: 'view-auth',
      name: 'lab.test',
      type: 'PRIMARY',
      soa: {
        primaryNs: 'ns1.lab.test.',
        adminEmail: 'hostmaster.lab.test.',
        serial: 2026081501,
        refresh: 3600,
        retry: 900,
        expire: 604800,
        minimum: 300,
      },
      recordCount: 0,
      syncState: 'SYNCED',
    };

    const model: ConfigModel = {
      configuration: dummyConfig,
      views: [viewAuth],
      zones: [zoneLabTest],
      records,
      servers: [{ id: 'bc-rmaster' }],
      roles: [{ serverId: 'bc-rmaster', zoneId: 'zone-lab', role: 'PRIMARY' }],
      options: [
        {
          scopeType: 'VIEW',
          scopeId: 'view-auth',
          key: 'recursion',
          value: false,
        },
        {
          scopeType: 'ZONE',
          scopeId: 'zone-lab',
          key: 'allow-transfer',
          value: 'any',
        },
        {
          scopeType: 'ZONE',
          scopeId: 'zone-lab',
          key: 'also-notify',
          value: ['172.23.23.129', '172.23.23.100'],
        },
      ],
    };

    const out = generateNamedConf(model, 'bc-rmaster');

    expect(out).toContain('view "authoritative" {');
    expect(out).toContain('match-clients { any; };');
    expect(out).toContain('recursion no;');
    expect(out).toContain('zone "lab.test" {');
    expect(out).toContain('type primary;');
    expect(out).toContain('file "/etc/bind/zones/db.lab.test";');
    expect(out).toContain('allow-transfer { any; };');
    expect(out).toContain('also-notify { 172.23.23.129; 172.23.23.100; };');
  });

  it('generates secondary zones with primaries and slave file path', () => {
    const viewAuth: View = {
      id: 'view-auth',
      configurationId: 'cfg-1',
      name: 'authoritative',
      order: 1,
      matchClients: ['any'],
      zoneCount: 1,
    };

    const zoneLabTest: Zone = {
      id: 'zone-lab',
      configurationId: 'cfg-1',
      viewId: 'view-auth',
      name: 'lab.test',
      type: 'PRIMARY',
      soa: {
        primaryNs: 'ns1.lab.test.',
        adminEmail: 'hostmaster.lab.test.',
        serial: 2026081501,
        refresh: 3600,
        retry: 900,
        expire: 604800,
        minimum: 300,
      },
      recordCount: 0,
      syncState: 'SYNCED',
    };

    const model: ConfigModel = {
      configuration: dummyConfig,
      views: [viewAuth],
      zones: [zoneLabTest],
      records,
      servers: [{ id: 'bc-rslave1' }],
      roles: [{ serverId: 'bc-rslave1', zoneId: 'zone-lab', role: 'SECONDARY' }],
      options: [
        {
          scopeType: 'ZONE',
          scopeId: 'zone-lab',
          key: 'primaries',
          value: ['172.23.23.97'],
        },
        {
          scopeType: 'ZONE',
          scopeId: 'zone-lab',
          key: 'allow-transfer',
          value: ['any'],
        },
      ],
    };

    const out = generateNamedConf(model, 'bc-rslave1');

    expect(out).toContain('zone "lab.test" {');
    expect(out).toContain('type secondary;');
    expect(out).toContain('file "/var/bind/sec/db.lab.test";');
    expect(out).toContain('primaries { 172.23.23.97; };');
    expect(out).toContain('allow-transfer { any; };');
  });

  it('orders multiple views according to their order property', () => {
    const viewRecursive: View = {
      id: 'view-rec',
      configurationId: 'cfg-1',
      name: 'recursive',
      order: 1,
      matchClients: ['172.22.22.100', '172.22.22.200'],
      zoneCount: 0,
    };

    const viewAuth: View = {
      id: 'view-auth',
      configurationId: 'cfg-1',
      name: 'authoritative',
      order: 2,
      matchClients: ['any'],
      zoneCount: 1,
    };

    const zoneLabTest: Zone = {
      id: 'zone-lab',
      configurationId: 'cfg-1',
      viewId: 'view-auth',
      name: 'lab.test',
      type: 'PRIMARY',
      soa: {
        primaryNs: 'ns1.lab.test.',
        adminEmail: 'hostmaster.lab.test.',
        serial: 2026081501,
        refresh: 3600,
        retry: 900,
        expire: 604800,
        minimum: 300,
      },
      recordCount: 0,
      syncState: 'SYNCED',
    };

    const model: ConfigModel = {
      configuration: dummyConfig,
      views: [viewAuth, viewRecursive], // unsorted in model
      zones: [zoneLabTest],
      records,
      servers: [{ id: 'bc-rmaster' }],
      roles: [{ serverId: 'bc-rmaster', zoneId: 'zone-lab', role: 'PRIMARY' }],
      options: [
        {
          scopeType: 'VIEW',
          scopeId: 'view-rec',
          key: 'recursion',
          value: true,
        },
        {
          scopeType: 'VIEW',
          scopeId: 'view-auth',
          key: 'recursion',
          value: false,
        },
      ],
    };

    const out = generateNamedConf(model, 'bc-rmaster');

    const recIndex = out.indexOf('view "recursive"');
    const authIndex = out.indexOf('view "authoritative"');
    expect(recIndex).toBeGreaterThan(-1);
    expect(authIndex).toBeGreaterThan(-1);
    expect(recIndex).toBeLessThan(authIndex);
  });
});
