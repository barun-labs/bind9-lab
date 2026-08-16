import { describe, it, expect } from 'vitest';
import { resolveOption, zonesForServer } from '../src/config-engine/resolve';
import type { ConfigModel } from '../src/config-engine/model';
import type { Configuration, View, Zone, ResourceRecord } from '../../shared/entities';

describe('resolve.ts', () => {
  const dummyConfig: Configuration = {
    id: 'cfg-1',
    name: 'test-config',
    isActive: true,
    createdFromTemplateId: null,
    createdAt: '2026-08-15T00:00:00Z',
    updatedAt: '2026-08-15T00:00:00Z',
    counts: { views: 2, zones: 2, records: 0, servers: 2 },
  };

  const viewInternal: View = {
    id: 'view-int',
    configurationId: 'cfg-1',
    name: 'internal',
    order: 1,
    matchClients: ['10.0.0.0/8'],
    zoneCount: 1,
  };

  const viewExternal: View = {
    id: 'view-ext',
    configurationId: 'cfg-1',
    name: 'external',
    order: 2,
    matchClients: ['any'],
    zoneCount: 1,
  };

  const zoneInternal: Zone = {
    id: 'zone-int',
    configurationId: 'cfg-1',
    viewId: 'view-int',
    name: 'internal.test',
    type: 'PRIMARY',
    soa: {
      primaryNs: 'ns1.internal.test.',
      adminEmail: 'hostmaster.internal.test.',
      serial: 2026081501,
      refresh: 3600,
      retry: 900,
      expire: 604800,
      minimum: 300,
    },
    recordCount: 0,
    syncState: 'SYNCED',
  };

  const zoneExternal: Zone = {
    id: 'zone-ext',
    configurationId: 'cfg-1',
    viewId: 'view-ext',
    name: 'external.test',
    type: 'PRIMARY',
    soa: {
      primaryNs: 'ns1.external.test.',
      adminEmail: 'hostmaster.external.test.',
      serial: 2026081501,
      refresh: 3600,
      retry: 900,
      expire: 604800,
      minimum: 300,
    },
    recordCount: 0,
    syncState: 'SYNCED',
  };

  const records: ResourceRecord[] = [];

  describe('resolveOption', () => {
    it('returns view value when overridden at VIEW scope, and configuration value when only serverId is given', () => {
      const model: ConfigModel = {
        configuration: dummyConfig,
        views: [viewInternal, viewExternal],
        zones: [zoneInternal, zoneExternal],
        records,
        servers: [{ id: 'srv-1' }, { id: 'srv-2' }],
        roles: [],
        options: [
          {
            scopeType: 'CONFIGURATION',
            scopeId: 'cfg-1',
            key: 'recursion',
            value: true,
          },
          {
            scopeType: 'VIEW',
            scopeId: 'view-int',
            key: 'recursion',
            value: false,
          },
        ],
      };

      // When viewId is view-int, returns the view value (false)
      expect(
        resolveOption(model, { serverId: 'srv-1', viewId: 'view-int' }, 'recursion'),
      ).toBe(false);

      // When viewId is view-ext (no view override), returns the configuration value (true)
      expect(
        resolveOption(model, { serverId: 'srv-1', viewId: 'view-ext' }, 'recursion'),
      ).toBe(true);

      // When only serverId is given, returns the configuration value (true)
      expect(
        resolveOption(model, { serverId: 'srv-1' }, 'recursion'),
      ).toBe(true);
    });

    it('respects scope precedence: ZONE > VIEW > SERVER > SERVER_GROUP > CONFIGURATION', () => {
      const model: ConfigModel = {
        configuration: dummyConfig,
        views: [viewInternal],
        zones: [zoneInternal],
        records,
        servers: [{ id: 'srv-1', serverGroupId: 'grp-1' }],
        roles: [],
        options: [
          { scopeType: 'CONFIGURATION', scopeId: 'cfg-1', key: 'dnssec-validation', value: 'yes' },
          { scopeType: 'SERVER_GROUP', scopeId: 'grp-1', key: 'dnssec-validation', value: 'auto' },
          { scopeType: 'SERVER', scopeId: 'srv-1', key: 'dnssec-validation', value: 'no' },
          { scopeType: 'VIEW', scopeId: 'view-int', key: 'dnssec-validation', value: 'view-val' },
          { scopeType: 'ZONE', scopeId: 'zone-int', key: 'dnssec-validation', value: 'zone-val' },
        ],
      };

      // ZONE scope wins over all
      expect(
        resolveOption(model, { serverId: 'srv-1', viewId: 'view-int', zoneId: 'zone-int' }, 'dnssec-validation'),
      ).toBe('zone-val');

      // VIEW scope wins over SERVER, SERVER_GROUP, CONFIGURATION
      expect(
        resolveOption(model, { serverId: 'srv-1', viewId: 'view-int' }, 'dnssec-validation'),
      ).toBe('view-val');

      // SERVER scope wins over SERVER_GROUP, CONFIGURATION
      expect(
        resolveOption(model, { serverId: 'srv-1' }, 'dnssec-validation'),
      ).toBe('no');

      // SERVER_GROUP scope wins over CONFIGURATION
      expect(
        resolveOption(model, { serverId: 'srv-2', ...({} as any) }, 'dnssec-validation'), // without server match
      ).toBe('yes');
    });

    it('returns undefined if option key is not set at any scope', () => {
      const model: ConfigModel = {
        configuration: dummyConfig,
        views: [viewInternal],
        zones: [zoneInternal],
        records,
        servers: [{ id: 'srv-1' }],
        roles: [],
        options: [],
      };

      expect(resolveOption(model, { serverId: 'srv-1' }, 'non-existent')).toBeUndefined();
    });

    it('(a) a ZONE-scope option with disabled=true suppresses a VIEW-scope value for the same key', () => {
      const model: ConfigModel = {
        configuration: dummyConfig,
        views: [viewInternal],
        zones: [zoneInternal],
        records,
        servers: [{ id: 'srv-1' }],
        roles: [],
        options: [
          { scopeType: 'VIEW', scopeId: 'view-int', key: 'recursion', value: true },
          { scopeType: 'ZONE', scopeId: 'zone-int', key: 'recursion', value: true, disabled: true },
        ],
      };

      expect(
        resolveOption(model, { serverId: 'srv-1', viewId: 'view-int', zoneId: 'zone-int' }, 'recursion'),
      ).toBeUndefined();
    });

    it('(b) MUST-FAIL CONTROL: with no ZONE row (inherit), resolveOption returns the VIEW value', () => {
      const model: ConfigModel = {
        configuration: dummyConfig,
        views: [viewInternal],
        zones: [zoneInternal],
        records,
        servers: [{ id: 'srv-1' }],
        roles: [],
        options: [
          { scopeType: 'VIEW', scopeId: 'view-int', key: 'recursion', value: true },
        ],
      };

      expect(
        resolveOption(model, { serverId: 'srv-1', viewId: 'view-int', zoneId: 'zone-int' }, 'recursion'),
      ).toBe(true);
    });

    it('(c) a ZONE-scope row with a value (override) returns the zone value', () => {
      const model: ConfigModel = {
        configuration: dummyConfig,
        views: [viewInternal],
        zones: [zoneInternal],
        records,
        servers: [{ id: 'srv-1' }],
        roles: [],
        options: [
          { scopeType: 'VIEW', scopeId: 'view-int', key: 'recursion', value: true },
          { scopeType: 'ZONE', scopeId: 'zone-int', key: 'recursion', value: false },
        ],
      };

      expect(
        resolveOption(model, { serverId: 'srv-1', viewId: 'view-int', zoneId: 'zone-int' }, 'recursion'),
      ).toBe(false);
    });
  });

  describe('zonesForServer', () => {
    it('joins DeploymentRole matrix to the server zones and views', () => {
      const model: ConfigModel = {
        configuration: dummyConfig,
        views: [viewInternal, viewExternal],
        zones: [zoneInternal, zoneExternal],
        records,
        servers: [{ id: 'S' }, { id: 'S2' }],
        roles: [
          { serverId: 'S', zoneId: 'zone-int', role: 'PRIMARY' },
          { serverId: 'S', zoneId: 'zone-ext', role: 'SECONDARY' },
          { serverId: 'S2', zoneId: 'zone-int', role: 'SECONDARY' },
        ],
        options: [],
      };

      const resultS = zonesForServer(model, 'S');
      expect(resultS).toHaveLength(2);
      expect(resultS).toContainEqual({
        zone: zoneInternal,
        role: 'PRIMARY',
        view: viewInternal,
      });
      expect(resultS).toContainEqual({
        zone: zoneExternal,
        role: 'SECONDARY',
        view: viewExternal,
      });

      const resultS2 = zonesForServer(model, 'S2');
      expect(resultS2).toEqual([
        {
          zone: zoneInternal,
          role: 'SECONDARY',
          view: viewInternal,
        },
      ]);

      const resultUnknown = zonesForServer(model, 'UNKNOWN');
      expect(resultUnknown).toEqual([]);
    });
  });
});
