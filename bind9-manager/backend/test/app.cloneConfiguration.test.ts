import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import {
  createServerGroup,
  upsertServer,
  createTsigKey,
  createDeploymentOption,
  createDeploymentRole,
  getTsigKeyWithSecret,
} from '../src/server/entityStore';

describe('Configuration clone API', () => {
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

  const authHeader = (token: string) => ({ authorization: `Bearer ${token}` });

  function rowIds(table: string, configId: string): string[] {
    return (db.prepare(`SELECT id FROM ${table} WHERE configurationId = ?`).all(configId) as { id: string }[]).map(
      (r) => r.id
    );
  }

  function viewIds(configId: string): string[] {
    return rowIds('views', configId);
  }

  function zoneRows(configId: string): { id: string; viewId: string }[] {
    return db.prepare('SELECT id, viewId FROM zones WHERE configurationId = ?').all(configId) as {
      id: string;
      viewId: string;
    }[];
  }

  function serverIds(configId: string): string[] {
    return rowIds('servers', configId);
  }

  /**
   * Seed dns-lab (the default fixture config) with cross-references that
   * exercise every remap path: a server group with a member server, a tsig
   * key, a ZONE-scope deployment option, and a VIEW-scope deployment role.
   * Returns the source ids needed to assert the remap landed on new ids.
   */
  function seedCrossReferences() {
    const group = createServerGroup(db, 'dns-lab', { name: 'members' });
    upsertServer(db, {
      id: 'srv-grouped',
      configurationId: 'dns-lab',
      serverGroupId: group.id,
      hostname: 'grouped.example.com',
    });
    const tsigKey = createTsigKey(db, 'dns-lab', { name: 'transfer-key', algorithm: 'hmac-sha256' });
    const zoneRow = zoneRows('dns-lab')[0];
    const deploymentOption = createDeploymentOption(db, 'dns-lab', {
      scope: 'ZONE',
      scopeId: zoneRow.id,
      key: 'allow-transfer',
      value: ['10.0.0.1'],
    });
    const deploymentRole = createDeploymentRole(db, 'dns-lab', {
      scope: 'VIEW',
      scopeId: zoneRow.viewId,
      serverId: 'srv-grouped',
      role: 'PRIMARY',
    });
    return { group, tsigKey, zoneRow, deploymentOption, deploymentRole };
  }

  it('clones a configuration into a new one with fresh id, matching counts, and 201', async () => {
    const token = await loginAs('admin', 'admin');
    seedCrossReferences();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/clone',
      headers: authHeader(token),
      payload: { name: 'dns-lab-clone' },
    });
    expect(res.statusCode).toBe(201);
    const clone = JSON.parse(res.body);
    expect(clone.id.startsWith('cfg-')).toBe(true);
    expect(clone.id).not.toBe('dns-lab');
    expect(clone.name).toBe('dns-lab-clone');

    function liveCounts(configId: string) {
      return {
        views: viewIds(configId).length,
        zones: zoneRows(configId).length,
        servers: serverIds(configId).length,
        records: (
          db
            .prepare(
              'SELECT COUNT(*) AS c FROM records WHERE zoneId IN (SELECT id FROM zones WHERE configurationId = ?)'
            )
            .get(configId) as { c: number }
        ).c,
      };
    }
    const sourceCounts = liveCounts('dns-lab');
    expect(sourceCounts.views).toBeGreaterThan(0);
    expect(sourceCounts.zones).toBeGreaterThan(0);
    expect(sourceCounts.records).toBeGreaterThan(0);
    expect(liveCounts(clone.id)).toEqual(sourceCounts);
  });

  it('NO ID COLLISION: every cloned view/zone/server/group id differs from its source id', async () => {
    const token = await loginAs('admin', 'admin');
    seedCrossReferences();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/clone',
      headers: authHeader(token),
      payload: { name: 'no-collision' },
    });
    const clone = JSON.parse(res.body);

    const sourceViewIds = new Set(viewIds('dns-lab'));
    const cloneViewIds = new Set(viewIds(clone.id));
    expect(cloneViewIds.size).toBe(sourceViewIds.size);
    for (const id of cloneViewIds) expect(sourceViewIds.has(id)).toBe(false);

    const sourceZoneIds = new Set(zoneRows('dns-lab').map((z) => z.id));
    const cloneZoneIds = new Set(zoneRows(clone.id).map((z) => z.id));
    expect(cloneZoneIds.size).toBe(sourceZoneIds.size);
    for (const id of cloneZoneIds) expect(sourceZoneIds.has(id)).toBe(false);

    const sourceServerIds = new Set(serverIds('dns-lab'));
    const cloneServerIds = new Set(serverIds(clone.id));
    expect(cloneServerIds.size).toBe(sourceServerIds.size);
    for (const id of cloneServerIds) expect(sourceServerIds.has(id)).toBe(false);

    const sourceGroupIds = new Set(rowIds('server_groups', 'dns-lab'));
    const cloneGroupIds = new Set(rowIds('server_groups', clone.id));
    expect(cloneGroupIds.size).toBe(sourceGroupIds.size);
    for (const id of cloneGroupIds) expect(sourceGroupIds.has(id)).toBe(false);
  });

  it('REFERENTIAL INTEGRITY / MUST-FAIL CONTROL: a cloned zone.viewId is a cloned view id, never a source view id', async () => {
    const token = await loginAs('admin', 'admin');
    seedCrossReferences();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/clone',
      headers: authHeader(token),
      payload: { name: 'ref-integrity' },
    });
    const clone = JSON.parse(res.body);

    const sourceViewIds = new Set(viewIds('dns-lab'));
    const cloneViewIds = new Set(viewIds(clone.id));
    const cloneZones = zoneRows(clone.id);
    expect(cloneZones.length).toBeGreaterThan(0);
    for (const zone of cloneZones) {
      // This is the whole point of the slice: fails if viewId remapping is missing.
      expect(cloneViewIds.has(zone.viewId)).toBe(true);
      expect(sourceViewIds.has(zone.viewId)).toBe(false);
    }
  });

  it('remaps a ZONE-scope deployment_option and a VIEW-scope deployment_role to cloned ids', async () => {
    const token = await loginAs('admin', 'admin');
    const seeded = seedCrossReferences();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/clone',
      headers: authHeader(token),
      payload: { name: 'scope-remap' },
    });
    const clone = JSON.parse(res.body);

    const cloneZoneIds = new Set(zoneRows(clone.id).map((z) => z.id));
    const cloneViewIds = new Set(viewIds(clone.id));
    const cloneServerIds = new Set(serverIds(clone.id));

    const cloneOptions = db
      .prepare('SELECT scopeType, scopeId, key FROM deployment_options WHERE configurationId = ?')
      .all(clone.id) as { scopeType: string; scopeId: string; key: string }[];
    const clonedZoneOption = cloneOptions.find((o) => o.scopeType === 'ZONE' && o.key === 'allow-transfer');
    expect(clonedZoneOption).toBeDefined();
    expect(cloneZoneIds.has(clonedZoneOption!.scopeId)).toBe(true);
    expect(clonedZoneOption!.scopeId).not.toBe(seeded.zoneRow.id);

    const cloneRoles = db
      .prepare('SELECT scopeType, scopeId, serverId, role FROM deployment_roles WHERE configurationId = ?')
      .all(clone.id) as { scopeType: string; scopeId: string; serverId: string; role: string }[];
    const clonedViewRole = cloneRoles.find((r) => r.scopeType === 'VIEW' && r.role === 'PRIMARY');
    expect(clonedViewRole).toBeDefined();
    expect(cloneViewIds.has(clonedViewRole!.scopeId)).toBe(true);
    expect(clonedViewRole!.scopeId).not.toBe(seeded.zoneRow.viewId);
    expect(cloneServerIds.has(clonedViewRole!.serverId)).toBe(true);
    expect(clonedViewRole!.serverId).not.toBe('srv-grouped');
  });

  it("remaps a cloned server's serverGroupId to a cloned group id", async () => {
    const token = await loginAs('admin', 'admin');
    const seeded = seedCrossReferences();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/clone',
      headers: authHeader(token),
      payload: { name: 'group-remap' },
    });
    const clone = JSON.parse(res.body);

    const cloneGroupIds = new Set(rowIds('server_groups', clone.id));
    const cloneServerRow = (
      db.prepare('SELECT data FROM servers WHERE configurationId = ?').all(clone.id) as { data: string }[]
    )
      .map((r) => JSON.parse(r.data))
      .find((s: any) => s.hostname === 'grouped.example.com');
    expect(cloneServerRow).toBeDefined();
    expect(cloneServerRow.serverGroupId).toBeDefined();
    expect(cloneGroupIds.has(cloneServerRow.serverGroupId)).toBe(true);
    expect(cloneServerRow.serverGroupId).not.toBe(seeded.group.id);
  });

  it('preserves the tsig key secret across the clone and mints a new key id', async () => {
    const token = await loginAs('admin', 'admin');
    const seeded = seedCrossReferences();
    const sourceSecret = getTsigKeyWithSecret(db, seeded.tsigKey.id)!.secret;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/clone',
      headers: authHeader(token),
      payload: { name: 'tsig-preserve' },
    });
    const clone = JSON.parse(res.body);

    const cloneKeyRow = (
      db.prepare('SELECT id, data FROM tsig_keys WHERE configurationId = ?').all(clone.id) as {
        id: string;
        data: string;
      }[]
    ).find((r) => JSON.parse(r.data).name === 'transfer-key');
    expect(cloneKeyRow).toBeDefined();
    expect(cloneKeyRow!.id).not.toBe(seeded.tsigKey.id);
    const cloneSecret = getTsigKeyWithSecret(db, cloneKeyRow!.id)!.secret;
    expect(cloneSecret).toBe(sourceSecret);
  });

  it('INDEPENDENCE: deleting the source leaves the clone fully intact', async () => {
    const token = await loginAs('admin', 'admin');
    seedCrossReferences();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/clone',
      headers: authHeader(token),
      payload: { name: 'independent-clone' },
    });
    const clone = JSON.parse(res.body);
    const viewCountBefore = viewIds(clone.id).length;
    const zoneCountBefore = zoneRows(clone.id).length;
    const recordCountBefore = (
      db
        .prepare('SELECT COUNT(*) AS c FROM records WHERE zoneId IN (SELECT id FROM zones WHERE configurationId = ?)')
        .get(clone.id) as { c: number }
    ).c;
    expect(viewCountBefore).toBeGreaterThan(0);
    expect(zoneCountBefore).toBeGreaterThan(0);
    expect(recordCountBefore).toBeGreaterThan(0);

    createUserWithRole('usr-del', 'deluser', [{ configurationId: 'dns-lab', role: 'admin', canDeploy: false }]);
    const delToken = await loginAs('deluser', 'password123');
    const delRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/configurations/dns-lab',
      headers: authHeader(delToken),
    });
    expect(delRes.statusCode).toBe(200);

    expect(viewIds(clone.id).length).toBe(viewCountBefore);
    expect(zoneRows(clone.id).length).toBe(zoneCountBefore);
    const recordCountAfter = (
      db
        .prepare('SELECT COUNT(*) AS c FROM records WHERE zoneId IN (SELECT id FROM zones WHERE configurationId = ?)')
        .get(clone.id) as { c: number }
    ).c;
    expect(recordCountAfter).toBe(recordCountBefore);
  });

  it('rejects a duplicate clone name with 409 CONFLICT', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/clone',
      headers: authHeader(token),
      payload: { name: 'split-horizon-test' }, // already exists per fixtures (config name, not id)
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('CONFLICT');
  });

  it('rejects an invalid clone name with 422 INVALID_NAME (MUST-FAIL CONTROL)', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/clone',
      headers: authHeader(token),
      payload: { name: 'bad name; rm -rf' },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_NAME');
  });

  it('returns 403 to a non-admin', async () => {
    createUserWithRole('usr-viewer', 'viewer', [{ configurationId: 'dns-lab', role: 'viewer', canDeploy: false }]);
    const token = await loginAs('viewer', 'password123');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/clone',
      headers: authHeader(token),
      payload: { name: 'nope' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for an unknown source configuration', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/ghost-config/clone',
      headers: authHeader(token),
      payload: { name: 'anything' },
    });
    expect(res.statusCode).toBe(404);
  });
});
