import { describe, it, expect } from 'vitest';
import { openDb } from '../src/server/db';
import {
  buildConfigModel,
  listDeploymentOptions,
  createDeploymentOption,
  updateDeploymentOption,
  deleteDeploymentOption,
  listDeploymentRoles,
  createDeploymentRole,
  updateDeploymentRole,
  deleteDeploymentRole,
} from '../src/server/entityStore';
import { generateNamedConf } from '../src/config-engine';
import type { ConfigModel } from '../src/config-engine/model';

describe('deployment options + roles store', () => {
  it('round-trips an option value and disabled flag', () => {
    const db = openDb(':memory:');
    const created = createDeploymentOption(db, 'dns-lab', {
      scope: 'VIEW',
      scopeId: 'view-internal',
      key: 'recursion',
      value: { nested: [1, 2, 3] },
      disabled: true,
    });

    expect(created.id).toMatch(/^do-/);
    expect(created.value).toEqual({ nested: [1, 2, 3] });
    expect(created.disabled).toBe(true);

    const rows = listDeploymentOptions(db, 'dns-lab');
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toEqual({ nested: [1, 2, 3] });
    expect(rows[0].disabled).toBe(true);

    const updated = updateDeploymentOption(db, created.id, { disabled: false });
    expect(updated.disabled).toBe(false);
    expect(listDeploymentOptions(db, 'dns-lab')[0].disabled).toBe(false);

    deleteDeploymentOption(db, created.id);
    expect(listDeploymentOptions(db, 'dns-lab')).toEqual([]);
  });

  it('round-trips a role', () => {
    const db = openDb(':memory:');
    const created = createDeploymentRole(db, 'dns-lab', {
      scope: 'ZONE',
      scopeId: 'zone-lab',
      serverId: 'srv-pri',
      role: 'PRIMARY',
    });

    expect(created.id).toMatch(/^dr-/);
    expect(listDeploymentRoles(db, 'dns-lab')).toHaveLength(1);

    const updated = updateDeploymentRole(db, created.id, { role: 'SECONDARY' });
    expect(updated.role).toBe('SECONDARY');

    deleteDeploymentRole(db, created.id);
    expect(listDeploymentRoles(db, 'dns-lab')).toEqual([]);
  });

  it('wires options and ZONE roles into buildConfigModel', () => {
    const db = openDb(':memory:');
    createDeploymentOption(db, 'dns-lab', {
      scope: 'VIEW',
      scopeId: 'view-internal',
      key: 'recursion',
      value: false,
    });
    createDeploymentRole(db, 'dns-lab', {
      scope: 'ZONE',
      scopeId: 'zone-lab',
      serverId: 'srv-pri',
      role: 'PRIMARY',
    });
    // VIEW-scope role must be ignored by buildConfigModel (later slice).
    createDeploymentRole(db, 'dns-lab', {
      scope: 'VIEW',
      scopeId: 'view-internal',
      serverId: 'srv-pri',
      role: 'PRIMARY',
    });

    const model = buildConfigModel(db, 'dns-lab');
    expect(model.options).toContainEqual({
      scopeType: 'VIEW',
      scopeId: 'view-internal',
      key: 'recursion',
      value: false,
      disabled: false,
    });
    expect(model.roles).toContainEqual({
      serverId: 'srv-pri',
      zoneId: 'zone-lab',
      role: 'PRIMARY',
    });
    expect(model.roles).toHaveLength(1);
  });

  it('golden: empty options/roles tables leave named.conf byte-identical to options:[]/roles:[]', () => {
    const db = openDb(':memory:');
    const model = buildConfigModel(db, 'dns-lab');

    // Fresh seed has no deployment_options/deployment_roles rows.
    expect(model.options).toEqual([]);
    expect(model.roles).toEqual([]);

    // The pre-change buildConfigModel emitted options: [] and roles: [].
    const reference: ConfigModel = { ...model, options: [], roles: [] };

    expect(model.servers.length).toBeGreaterThan(0);
    for (const server of model.servers) {
      const actual = generateNamedConf(model, server.id);
      expect(actual).toContain('options {');
      expect(actual).toBe(generateNamedConf(reference, server.id));
    }
  });
});
