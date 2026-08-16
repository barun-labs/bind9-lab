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

  it('golden: empty explicit options leave named.conf byte-identical to options:[]', () => {
    const db = openDb(':memory:');
    const model = buildConfigModel(db, 'dns-lab');

    // Fresh seed has no explicit deployment_options rows; buildConfigModel
    // synthesizes a VIEW-scope match-clients option from each view's field only.
    expect(model.options).toHaveLength(3);
    expect(model.options).toContainEqual({
      scopeType: 'VIEW',
      scopeId: 'view-internal',
      key: 'match-clients',
      value: ['10.0.0.0/8', '172.20.0.0/16'],
      disabled: false,
    });
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

  it('synthesizes a VIEW-scope match-clients option from view.matchClients on a fresh seed', () => {
    const db = openDb(':memory:');
    const model = buildConfigModel(db, 'dns-lab');

    const synthesized = model.options.filter((o) => o.key === 'match-clients');
    expect(synthesized).toHaveLength(3);
    expect(synthesized).toContainEqual({
      scopeType: 'VIEW',
      scopeId: 'view-internal',
      key: 'match-clients',
      value: ['10.0.0.0/8', '172.20.0.0/16'],
      disabled: false,
    });

    const out = generateNamedConf(model, 'srv-pri');
    expect(out).toContain('match-clients { 10.0.0.0/8; 172.20.0.0/16; };');
  });

  it('explicit match-clients option overrides view.matchClients', () => {
    const db = openDb(':memory:');

    // MUST-FAIL guard: without an override the emitted line reflects the field.
    const baseline = generateNamedConf(buildConfigModel(db, 'dns-lab'), 'srv-pri');
    expect(baseline).toContain('match-clients { 10.0.0.0/8; 172.20.0.0/16; };');

    createDeploymentOption(db, 'dns-lab', {
      scope: 'VIEW',
      scopeId: 'view-internal',
      key: 'match-clients',
      value: ['192.0.2.1'],
    });

    const model = buildConfigModel(db, 'dns-lab');
    const matches = model.options.filter(
      (o) => o.scopeType === 'VIEW' && o.scopeId === 'view-internal' && o.key === 'match-clients',
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].value).toEqual(['192.0.2.1']);

    const out = generateNamedConf(model, 'srv-pri');
    expect(out).toContain('match-clients { 192.0.2.1; };');
    expect(out).not.toContain('match-clients { 10.0.0.0/8; 172.20.0.0/16; };');
  });
});
