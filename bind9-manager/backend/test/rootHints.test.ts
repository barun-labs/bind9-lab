import { describe, it, expect } from 'vitest';
import { generateServerConfig } from '../src/config-engine';
import type { ConfigModel, Configuration, View, Zone } from '../src/config-engine/model';

const dummyConfig: Configuration = {
  id: 'cfg-1',
  name: 'test-config',
  isActive: true,
  createdFromTemplateId: null,
  createdAt: '2026-08-15T00:00:00Z',
  updatedAt: '2026-08-15T00:00:00Z',
  counts: { views: 1, zones: 1, records: 0, servers: 2 },
};

const viewRoot: View = {
  id: 'view-root',
  configurationId: 'cfg-1',
  name: 'root',
  order: 1,
  matchClients: ['any'],
  zoneCount: 1,
};

const zoneRoot: Zone = {
  id: 'zone-root',
  configurationId: 'cfg-1',
  viewId: 'view-root',
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
  recordCount: 0,
  syncState: 'SYNCED',
};

function baseModel(): ConfigModel {
  return {
    configuration: dummyConfig,
    views: [viewRoot],
    zones: [zoneRoot],
    records: [],
    servers: [
      { id: 'root', serviceInterfaces: [{ address: '10.60.2.53', port: 53 }] },
      { id: 'recursive', serviceInterfaces: [{ address: '10.60.1.20', port: 53 }] },
    ],
    roles: [
      { serverId: 'root', zoneId: 'zone-root', role: 'PRIMARY' },
      { serverId: 'recursive', zoneId: 'zone-root', role: 'RECURSIVE' },
    ],
    options: [],
  };
}

describe('root-hints generation (generateServerConfig)', () => {
  it('emits db.root for a server with an explicit RECURSIVE role, pointing at the root server IP', () => {
    const files = generateServerConfig(baseModel(), 'recursive');

    expect(files['db.root']).toBeDefined();
    expect(files['db.root']).toContain('IN      NS    ns.root.');
    expect(files['db.root']).toContain('ns.root.                 3600000      IN      A     10.60.2.53');
  });

  it('does not emit db.root for the root server itself (it is PRIMARY, not RECURSIVE)', () => {
    const files = generateServerConfig(baseModel(), 'root');
    expect(files['db.root']).toBeUndefined();
  });

  it('emits db.root for a server with recursion enabled and no explicit hint zone (implicit-hint case)', () => {
    const model: ConfigModel = {
      ...baseModel(),
      servers: [
        ...baseModel().servers,
        { id: 'cache', serviceInterfaces: [{ address: '10.60.1.10', port: 53 }] },
      ],
      options: [{ scopeType: 'SERVER', scopeId: 'cache', key: 'recursion', value: true }],
    };

    const files = generateServerConfig(model, 'cache');
    expect(files['db.root']).toBeDefined();
    expect(files['db.root']).toContain('10.60.2.53');
  });

  it('emits nothing when the model has no "." zone at all (no root server to point at)', () => {
    const model: ConfigModel = {
      ...baseModel(),
      zones: [],
      roles: [{ serverId: 'recursive', zoneId: 'zone-root', role: 'RECURSIVE' }],
    };
    // zonesForServer looks up the zone by id; with zones: [] the RECURSIVE
    // role entry resolves to no zone, so serverNeedsRootHints sees no
    // RECURSIVE entries and (since no zone means no hint-or-dot marker)
    // falls back to the recursion-option check, which is also unset here.
    const files = generateServerConfig(model, 'recursive');
    expect(files['db.root']).toBeUndefined();
  });

  it('does not emit db.root for a server whose root server has no serviceInterfaces address', () => {
    const model: ConfigModel = {
      ...baseModel(),
      servers: [
        { id: 'root' }, // no serviceInterfaces
        { id: 'recursive', serviceInterfaces: [{ address: '10.60.1.20', port: 53 }] },
      ],
    };
    const files = generateServerConfig(model, 'recursive');
    expect(files['db.root']).toBeUndefined();
  });
});
