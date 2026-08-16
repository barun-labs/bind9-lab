import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import { createServerGroup, upsertServer } from '../src/server/entityStore';

describe('Server Groups API', () => {
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

  it('creates a valid server group, server-generates the id', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/groups',
      headers: { authorization: `Bearer ${token}` },
      payload: { id: 'sg-evil', name: 'all-secondaries', description: '  Every secondary  ' },
    });
    expect(res.statusCode).toBe(201);
    const group = JSON.parse(res.body);
    expect(group.id.startsWith('sg-')).toBe(true);
    expect(group.id).not.toBe('sg-evil');
    expect(group.configurationId).toBe('dns-lab');
    expect(group.name).toBe('all-secondaries');
    expect(group.description).toBe('Every secondary');
    expect(group.memberCount).toBe(0);
  });

  it('rejects a group name with shell/traversal metachars (MUST-FAIL CONTROL)', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    for (const bad of ['evil; rm -rf', '../../etc', 'has space', 'group/name', 'a\\b']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/configurations/dns-lab/groups',
        headers: authHeader,
        payload: { name: bad },
      });
      expect(res.statusCode).toBe(422);
      expect(JSON.parse(res.body).error.code).toBe('INVALID_NAME');
    }
  });

  it('rejects a duplicate group name with 409 CONFLICT', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/groups',
      headers: authHeader,
      payload: { name: 'dup-group' },
    });
    expect(first.statusCode).toBe(201);

    const dup = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/groups',
      headers: authHeader,
      payload: { name: 'DUP-GROUP' }, // case-insensitive dup
    });
    expect(dup.statusCode).toBe(409);
    expect(JSON.parse(dup.body).error.code).toBe('CONFLICT');
  });

  it('lists and gets a single server group', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/groups',
      headers: authHeader,
      payload: { name: 'listed-group' },
    });
    const group = JSON.parse(createRes.body);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/groups',
      headers: authHeader,
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = JSON.parse(listRes.body);
    expect(listBody.some((g: any) => g.id === group.id && g.name === 'listed-group')).toBe(true);

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/configurations/dns-lab/groups/${group.id}`,
      headers: authHeader,
    });
    expect(getRes.statusCode).toBe(200);
    const got = JSON.parse(getRes.body);
    expect(got.id).toBe(group.id);
    expect(got.configurationId).toBe('dns-lab');
    expect(got.memberCount).toBe(0);
  });

  it('patches name and description; rejects a bad name with 422', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/groups',
      headers: authHeader,
      payload: { name: 'old-name' },
    });
    const group = JSON.parse(createRes.body);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/dns-lab/groups/${group.id}`,
      headers: authHeader,
      payload: { name: 'new-name', description: 'A fresh description' },
    });
    expect(patchRes.statusCode).toBe(200);
    const patched = JSON.parse(patchRes.body);
    expect(patched.name).toBe('new-name');
    expect(patched.description).toBe('A fresh description');
    expect(patched.id).toBe(group.id);
    expect(patched.configurationId).toBe('dns-lab');

    const badRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/dns-lab/groups/${group.id}`,
      headers: authHeader,
      payload: { name: 'bad..name; rm' },
    });
    expect(badRes.statusCode).toBe(422);
    expect(JSON.parse(badRes.body).error.code).toBe('INVALID_NAME');
  });

  it('deletes a server group with no members', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/groups',
      headers: authHeader,
      payload: { name: 'gone-group' },
    });
    const group = JSON.parse(createRes.body);

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/dns-lab/groups/${group.id}`,
      headers: authHeader,
    });
    expect(delRes.statusCode).toBe(200);
    expect(JSON.parse(delRes.body)).toEqual({ deleted: true });
  });

  it('rejects delete of a group with a member server with 409 HAS_DEPENDENTS', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/groups',
      headers: authHeader,
      payload: { name: 'member-group' },
    });
    const group = JSON.parse(createRes.body);

    upsertServer(db, {
      id: 'srv-member',
      configurationId: 'dns-lab',
      serverGroupId: group.id,
      hostname: 'member.example.com',
    });

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/dns-lab/groups/${group.id}`,
      headers: authHeader,
    });
    expect(delRes.statusCode).toBe(409);
    expect(JSON.parse(delRes.body).error.code).toBe('HAS_DEPENDENTS');
  });

  it('returns 403 to a view-only actor on create', async () => {
    createUserWithRole('usr-viewer', 'viewer', [
      { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
    ]);
    const token = await loginAs('viewer', 'password123');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/groups',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'nope-group' },
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

    const group = createServerGroup(db, 'config-a', { name: 'scope-group' });

    const patchOther = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/config-b/groups/${group.id}`,
      headers: authHeader,
      payload: { name: 'other-name' },
    });
    expect(patchOther.statusCode).toBe(404);

    const deleteOther = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/config-b/groups/${group.id}`,
      headers: authHeader,
    });
    expect(deleteOther.statusCode).toBe(404);
  });
});
