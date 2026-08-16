import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import { buildConfigModel, createDeploymentRole } from '../src/server/entityStore';
import { effectiveZoneRoles } from '../src/config-engine/resolve';
import type { ConfigModel } from '../src/config-engine/model';
import type { Configuration, DeploymentRoleRow } from '../../shared/entities';

describe('Deployment Roles API', () => {
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

  it('creates a valid ZONE-scope role, server-generates the id', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/roles',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        id: 'dr-evil',
        scope: 'ZONE',
        scopeId: 'zone-lab',
        serverId: 'srv-pri',
        role: 'SECONDARY',
      },
    });
    expect(res.statusCode).toBe(201);
    const role = JSON.parse(res.body);
    expect(role.id.startsWith('dr-')).toBe(true);
    expect(role.id).not.toBe('dr-evil');
    expect(role.role).toBe('SECONDARY');
    expect(role.disabled).toBe(false);
  });

  it('rejects an unknown role value with 422 INVALID_ROLE', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/roles',
      headers: { authorization: `Bearer ${token}` },
      payload: { scope: 'ZONE', scopeId: 'zone-lab', serverId: 'srv-pri', role: 'OVERLORD' },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_ROLE');
  });

  it('rejects a non-existent serverId with 422 INVALID_SERVER_ID', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/roles',
      headers: { authorization: `Bearer ${token}` },
      payload: { scope: 'ZONE', scopeId: 'zone-lab', serverId: 'srv-nope', role: 'PRIMARY' },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_SERVER_ID');
  });

  it('rejects a non-existent scopeId with 422 INVALID_SCOPE_ID', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/roles',
      headers: { authorization: `Bearer ${token}` },
      payload: { scope: 'ZONE', scopeId: 'zone-nope', serverId: 'srv-pri', role: 'PRIMARY' },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_SCOPE_ID');
  });

  it('rejects a duplicate (scope, scopeId, serverId) with 409', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };
    const payload = { scope: 'ZONE', scopeId: 'zone-lab', serverId: 'srv-pri', role: 'PRIMARY' };

    const first = await app.inject({ method: 'POST', url: '/api/v1/configurations/dns-lab/roles', headers: authHeader, payload });
    expect(first.statusCode).toBe(201);

    const dup = await app.inject({ method: 'POST', url: '/api/v1/configurations/dns-lab/roles', headers: authHeader, payload });
    expect(dup.statusCode).toBe(409);
    expect(JSON.parse(dup.body).error.code).toBe('CONFLICT');
  });

  it('lists, patches disabled, and deletes a role', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/roles',
      headers: authHeader,
      payload: { scope: 'ZONE', scopeId: 'zone-lab', serverId: 'srv-pri', role: 'PRIMARY' },
    });
    const role = JSON.parse(createRes.body);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/roles?scope=ZONE&scopeId=zone-lab',
      headers: authHeader,
    });
    expect(listRes.statusCode).toBe(200);
    expect(JSON.parse(listRes.body).some((r: any) => r.id === role.id)).toBe(true);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/dns-lab/roles/${role.id}`,
      headers: authHeader,
      payload: { disabled: true },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(JSON.parse(patchRes.body).disabled).toBe(true);

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/dns-lab/roles/${role.id}`,
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
      url: '/api/v1/configurations/dns-lab/roles',
      headers: { authorization: `Bearer ${token}` },
      payload: { scope: 'ZONE', scopeId: 'zone-lab', serverId: 'srv-pri', role: 'PRIMARY' },
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

    const role = createDeploymentRole(db, 'config-a', {
      scope: 'ZONE',
      scopeId: 'zone-a',
      serverId: 'srv-a',
      role: 'PRIMARY',
    });

    const patchOther = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/config-b/roles/${role.id}`,
      headers: authHeader,
      payload: { disabled: true },
    });
    expect(patchOther.statusCode).toBe(404);

    const deleteOther = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/config-b/roles/${role.id}`,
      headers: authHeader,
    });
    expect(deleteOther.statusCode).toBe(404);
  });

  it('serves effective-roles for a zone (requires view)', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/zones/zone-lab/effective-roles',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(res.body))).toBe(true);
  });
});

describe('buildConfigModel role flattening (IA-5)', () => {
  it('a ZONE override changes the flattened role; a disabled ZONE row suppresses the inherited role', () => {
    const db = openDb(':memory:');

    // VIEW role: srv-pri is PRIMARY for every zone in view-internal.
    createDeploymentRole(db, 'dns-lab', {
      scope: 'VIEW',
      scopeId: 'view-internal',
      serverId: 'srv-pri',
      role: 'PRIMARY',
    });

    const internalZoneIds = buildConfigModel(db, 'dns-lab').zones
      .filter((z) => z.viewId === 'view-internal')
      .map((z) => z.id);
    expect(internalZoneIds).toContain('zone-lab');
    const otherZoneId = internalZoneIds.find((id) => id !== 'zone-lab')!;

    // MUST-FAIL CONTROL: with no zone row, the flattened entry reflects the VIEW role.
    const inherited = buildConfigModel(db, 'dns-lab').roles.find(
      (r) => r.serverId === 'srv-pri' && r.zoneId === 'zone-lab',
    );
    expect(inherited).toMatchObject({ serverId: 'srv-pri', zoneId: 'zone-lab', role: 'PRIMARY' });

    // ZONE override for zone-lab: srv-pri becomes SECONDARY there only.
    createDeploymentRole(db, 'dns-lab', {
      scope: 'ZONE',
      scopeId: 'zone-lab',
      serverId: 'srv-pri',
      role: 'SECONDARY',
    });
    const overridden = buildConfigModel(db, 'dns-lab').roles.find(
      (r) => r.serverId === 'srv-pri' && r.zoneId === 'zone-lab',
    );
    expect(overridden?.role).toBe('SECONDARY');
    // A sibling zone still inherits PRIMARY.
    const sibling = buildConfigModel(db, 'dns-lab').roles.find(
      (r) => r.serverId === 'srv-pri' && r.zoneId === otherZoneId,
    );
    expect(sibling?.role).toBe('PRIMARY');

    // Disabled ZONE row on the sibling suppresses the inherited role entirely.
    createDeploymentRole(db, 'dns-lab', {
      scope: 'ZONE',
      scopeId: otherZoneId,
      serverId: 'srv-pri',
      role: 'PRIMARY',
      disabled: true,
    });
    const suppressed = buildConfigModel(db, 'dns-lab').roles.find(
      (r) => r.serverId === 'srv-pri' && r.zoneId === otherZoneId,
    );
    expect(suppressed).toBeUndefined();
  });
});

describe('effectiveZoneRoles', () => {
  const dummyConfig: Configuration = {
    id: 'cfg-1',
    name: 'test-config',
    isActive: true,
    createdFromTemplateId: null,
    createdAt: '2026-08-16T00:00:00Z',
    updatedAt: '2026-08-16T00:00:00Z',
    counts: { views: 1, zones: 1, records: 0, servers: 1 },
  };

  function makeModel(roleRows: DeploymentRoleRow[]): ConfigModel {
    return {
      configuration: dummyConfig,
      views: [],
      zones: [],
      records: [],
      servers: [{ id: 'srv-1' }],
      roles: [],
      roleRows,
      options: [],
    };
  }

  function row(over: Partial<DeploymentRoleRow>): DeploymentRoleRow {
    return {
      id: 'dr-x',
      configurationId: 'cfg-1',
      scope: 'VIEW',
      scopeId: 'view-int',
      serverId: 'srv-1',
      role: 'PRIMARY',
      disabled: false,
      ...over,
    };
  }

  it('no zone row → INHERIT from the view role', () => {
    const model = makeModel([row({ scope: 'VIEW', scopeId: 'view-int', role: 'PRIMARY' })]);
    expect(effectiveZoneRoles(model, 'view-int', 'zone-int')).toEqual([
      { serverId: 'srv-1', role: 'PRIMARY', mode: 'INHERIT' },
    ]);
  });

  it('zone row → OVERRIDE with the zone role', () => {
    const model = makeModel([
      row({ scope: 'VIEW', scopeId: 'view-int', role: 'PRIMARY' }),
      row({ id: 'dr-z', scope: 'ZONE', scopeId: 'zone-int', role: 'SECONDARY' }),
    ]);
    expect(effectiveZoneRoles(model, 'view-int', 'zone-int')).toEqual([
      { serverId: 'srv-1', role: 'SECONDARY', mode: 'OVERRIDE' },
    ]);
  });

  it('disabled zone row → DISABLE', () => {
    const model = makeModel([
      row({ scope: 'VIEW', scopeId: 'view-int', role: 'PRIMARY' }),
      row({ id: 'dr-z', scope: 'ZONE', scopeId: 'zone-int', role: 'PRIMARY', disabled: true }),
    ]);
    expect(effectiveZoneRoles(model, 'view-int', 'zone-int')).toEqual([
      { serverId: 'srv-1', role: 'PRIMARY', mode: 'DISABLE' },
    ]);
  });
});
