import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import { createDeploymentOption } from '../src/server/entityStore';
import { effectiveZoneOptions } from '../src/config-engine/resolve';
import type { ConfigModel } from '../src/config-engine/model';
import type { Configuration, View, Zone } from '../../shared/entities';

describe('Deployment Options API', () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = openDb(':memory:');
    app = buildApp(db);
  });

  async function loginAs(username = 'admin', password = 'admin'): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      payload: { username, password },
    });
    return JSON.parse(res.body).token;
  }

  function createUserWithRole(
    userId: string,
    username: string,
    roles: Array<{ configurationId: string; role: 'viewer' | 'editor' | 'admin'; canDeploy: boolean }>
  ): void {
    const { salt, hash } = hashPassword('password123');
    db.prepare(`
      INSERT INTO users (id, username, displayName, isActive, roles, pwSalt, pwHash, createdAt)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?)
    `).run(userId, username, username, JSON.stringify(roles), salt, hash, new Date().toISOString());
  }

  function seedConfiguration(id: string): void {
    db.prepare('INSERT INTO configurations (id, data) VALUES (?, ?)').run(
      id,
      JSON.stringify({
        id,
        name: id,
        isActive: true,
        createdFromTemplateId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        counts: { views: 0, zones: 0, records: 0, servers: 0 },
      })
    );
  }

  it('creates a valid VIEW-scope option, server-generates the id', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/options',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        id: 'do-evil',
        scope: 'VIEW',
        scopeId: 'view-internal',
        key: 'recursion',
        value: false,
      },
    });
    expect(res.statusCode).toBe(201);
    const option = JSON.parse(res.body);
    expect(option.id.startsWith('do-')).toBe(true);
    expect(option.id).not.toBe('do-evil');
    expect(option.key).toBe('recursion');
    expect(option.value).toBe(false);
    expect(option.disabled).toBe(false);
  });

  it('rejects match-clients at ZONE scope with 422', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/options',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        scope: 'ZONE',
        scopeId: 'zone-lab',
        key: 'match-clients',
        value: ['10.0.0.1'],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_SCOPE');
  });

  it('rejects an unknown option key with 422 UNKNOWN_OPTION_KEY', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/options',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        scope: 'VIEW',
        scopeId: 'view-internal',
        key: 'bogus-option',
        value: 'x',
      },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('UNKNOWN_OPTION_KEY');
  });

  it('rejects an ACL-token value with a shell metachar or path traversal (MUST-FAIL CONTROL)', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const shellMetachar = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/options',
      headers: authHeader,
      payload: {
        scope: 'VIEW',
        scopeId: 'view-internal',
        key: 'allow-query',
        value: ['10.0.0.1; echo hacked'],
      },
    });
    expect(shellMetachar.statusCode).toBe(422);
    expect(JSON.parse(shellMetachar.body).error.code).toBe('VALIDATION_ERROR');
    expect(JSON.parse(shellMetachar.body).error.field).toBe('10.0.0.1; echo hacked');

    const traversal = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/options',
      headers: authHeader,
      payload: {
        scope: 'VIEW',
        scopeId: 'view-internal',
        key: 'allow-query',
        value: ['../../etc/passwd'],
      },
    });
    expect(traversal.statusCode).toBe(422);
    expect(JSON.parse(traversal.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a bad forwarders entry and a non-boolean recursion value', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const badForwarder = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/options',
      headers: authHeader,
      payload: {
        scope: 'VIEW',
        scopeId: 'view-internal',
        key: 'forwarders',
        value: ['not-an-ip'],
      },
    });
    expect(badForwarder.statusCode).toBe(422);
    expect(JSON.parse(badForwarder.body).error.code).toBe('VALIDATION_ERROR');

    const badRecursion = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/options',
      headers: authHeader,
      payload: {
        scope: 'VIEW',
        scopeId: 'view-internal',
        key: 'recursion',
        value: 'yes',
      },
    });
    expect(badRecursion.statusCode).toBe(422);
    expect(JSON.parse(badRecursion.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('lists, patches disabled, and deletes an option', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/options',
      headers: authHeader,
      payload: {
        scope: 'VIEW',
        scopeId: 'view-internal',
        key: 'recursion',
        value: false,
      },
    });
    const option = JSON.parse(createRes.body);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/options?scope=VIEW&scopeId=view-internal',
      headers: authHeader,
    });
    expect(listRes.statusCode).toBe(200);
    const rows = JSON.parse(listRes.body);
    expect(rows.some((r: any) => r.id === option.id)).toBe(true);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/dns-lab/options/${option.id}`,
      headers: authHeader,
      payload: { disabled: true },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(JSON.parse(patchRes.body).disabled).toBe(true);

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/dns-lab/options/${option.id}`,
      headers: authHeader,
    });
    expect(deleteRes.statusCode).toBe(204);
  });

  it('returns 403 to a view-only actor on create', async () => {
    createUserWithRole('usr-viewer', 'viewer', [
      { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
    ]);
    const token = await loginAs('viewer', 'password123');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/options',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        scope: 'VIEW',
        scopeId: 'view-internal',
        key: 'recursion',
        value: false,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('scope-guards patch and delete across configurations', async () => {
    seedConfiguration('config-a');
    seedConfiguration('config-b');
    createUserWithRole('usr-dual', 'dual', [
      { configurationId: 'config-a', role: 'editor', canDeploy: false },
      { configurationId: 'config-b', role: 'editor', canDeploy: false },
    ]);
    const token = await loginAs('dual', 'password123');
    const authHeader = { authorization: `Bearer ${token}` };

    // config-a has no views in the seed, so create the option directly in the store.
    const option = createDeploymentOption(db, 'config-a', {
      scope: 'VIEW',
      scopeId: 'view-a',
      key: 'recursion',
      value: false,
    });

    const patchOther = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/config-b/options/${option.id}`,
      headers: authHeader,
      payload: { disabled: true },
    });
    expect(patchOther.statusCode).toBe(404);

    const deleteOther = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/config-b/options/${option.id}`,
      headers: authHeader,
    });
    expect(deleteOther.statusCode).toBe(404);
  });

  it('serves effective-options for a zone (requires view)', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/zones/zone-lab/effective-options',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(res.body))).toBe(true);
  });
});

describe('effectiveZoneOptions', () => {
  const dummyConfig: Configuration = {
    id: 'cfg-1',
    name: 'test-config',
    isActive: true,
    createdFromTemplateId: null,
    createdAt: '2026-08-15T00:00:00Z',
    updatedAt: '2026-08-15T00:00:00Z',
    counts: { views: 1, zones: 1, records: 0, servers: 1 },
  };

  const view: View = {
    id: 'view-int',
    configurationId: 'cfg-1',
    name: 'internal',
    order: 1,
    matchClients: ['10.0.0.0/8'],
    zoneCount: 1,
  };

  const zone: Zone = {
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

  function makeModel(options: ConfigModel['options']): ConfigModel {
    return {
      configuration: dummyConfig,
      views: [view],
      zones: [zone],
      records: [],
      servers: [{ id: 'srv-1' }],
      roles: [],
      options,
    };
  }

  it('no zone row → INHERIT with the view value; match-clients never appears', () => {
    const model = makeModel([
      { scopeType: 'VIEW', scopeId: 'view-int', key: 'recursion', value: true },
      { scopeType: 'VIEW', scopeId: 'view-int', key: 'match-clients', value: ['any'] },
    ]);
    const result = effectiveZoneOptions(model, 'view-int', 'zone-int');

    expect(result.find((r) => r.key === 'match-clients')).toBeUndefined();
    const recursion = result.find((r) => r.key === 'recursion');
    expect(recursion).toEqual({
      key: 'recursion',
      mode: 'INHERIT',
      effectiveValue: true,
      inheritedValue: true,
    });
  });

  it('zone override row → OVERRIDE with the zone value and the view value inherited', () => {
    const model = makeModel([
      { scopeType: 'VIEW', scopeId: 'view-int', key: 'recursion', value: true },
      { scopeType: 'ZONE', scopeId: 'zone-int', key: 'recursion', value: false },
    ]);
    const result = effectiveZoneOptions(model, 'view-int', 'zone-int');
    expect(result.find((r) => r.key === 'recursion')).toEqual({
      key: 'recursion',
      mode: 'OVERRIDE',
      effectiveValue: false,
      inheritedValue: true,
    });
  });

  it('disabled zone row → DISABLE with null effective value', () => {
    const model = makeModel([
      { scopeType: 'VIEW', scopeId: 'view-int', key: 'recursion', value: true },
      { scopeType: 'ZONE', scopeId: 'zone-int', key: 'recursion', value: true, disabled: true },
    ]);
    const result = effectiveZoneOptions(model, 'view-int', 'zone-int');
    expect(result.find((r) => r.key === 'recursion')).toEqual({
      key: 'recursion',
      mode: 'DISABLE',
      effectiveValue: null,
      inheritedValue: true,
    });
  });

  it('keys unset everywhere are skipped', () => {
    const model = makeModel([]);
    expect(effectiveZoneOptions(model, 'view-int', 'zone-int')).toEqual([]);
  });
});
