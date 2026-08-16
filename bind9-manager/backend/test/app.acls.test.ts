import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';

describe('ACL API (CRUD + evaluate)', () => {
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

  async function createAcl(
    token: string,
    configId: string,
    payload: Record<string, unknown>
  ): Promise<{ statusCode: number; body: any }> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/configurations/${configId}/acls`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    return { statusCode: res.statusCode, body: JSON.parse(res.body) };
  }

  it('creates an ACL, ignores an injected id, and normalizes entries', async () => {
    const token = await loginAs('admin', 'admin');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/acls',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        id: 'acl-evil',
        name: 'internal',
        entries: [
          { type: 'CIDR', value: '10.0.0.0/8' },
          { type: 'BOGUS', value: 'x' },
          { type: 'ANY', value: null },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const acl = JSON.parse(res.body);
    expect(acl.id.startsWith('acl-')).toBe(true);
    expect(acl.id).not.toBe('acl-evil');
    expect(acl.name).toBe('internal');
    expect(acl.configurationId).toBe('dns-lab');
    expect(acl.usedByCount).toBe(0);
    expect(acl.entries).toHaveLength(2);
    expect(acl.entries[0]).toMatchObject({ type: 'CIDR', value: '10.0.0.0/8', order: 0, negated: false });
    expect(acl.entries[1]).toMatchObject({ type: 'ANY', value: null, order: 1 });
  });

  it('rejects invalid and empty ACL names with 422', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    for (const name of ['bad name!', '']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/configurations/dns-lab/acls',
        headers: authHeader,
        payload: { name },
      });
      expect(res.statusCode).toBe(422);
      expect(JSON.parse(res.body).error.code).toBe('INVALID_NAME');
    }
  });

  it('lists, fetches, patches, and deletes an ACL', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const { body: acl } = await createAcl(token, 'dns-lab', { name: 'listme' });

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/acls',
      headers: authHeader,
    });
    expect(listRes.statusCode).toBe(200);
    expect(JSON.parse(listRes.body).some((a: any) => a.id === acl.id)).toBe(true);

    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/v1/configurations/dns-lab/acls/${acl.id}`,
      headers: authHeader,
    });
    expect(detailRes.statusCode).toBe(200);
    expect(JSON.parse(detailRes.body).name).toBe('listme');

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/dns-lab/acls/${acl.id}`,
      headers: authHeader,
      payload: { name: 'renamed', entries: [{ type: 'ADDRESS', value: '10.0.0.1' }] },
    });
    expect(patchRes.statusCode).toBe(200);
    const patched = JSON.parse(patchRes.body);
    expect(patched.name).toBe('renamed');
    expect(patched.entries).toHaveLength(1);
    expect(patched.entries[0].type).toBe('ADDRESS');

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/dns-lab/acls/${acl.id}`,
      headers: authHeader,
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(JSON.parse(deleteRes.body).deleted).toBe(true);
  });

  it('scope-guards patch, delete, and detail across configurations', async () => {
    seedConfiguration('config-a');
    seedConfiguration('config-b');
    createUserWithRole('usr-dual', 'dual', [
      { configurationId: 'config-a', role: 'editor', canDeploy: false },
      { configurationId: 'config-b', role: 'editor', canDeploy: false },
    ]);
    const token = await loginAs('dual', 'password123');
    const authHeader = { authorization: `Bearer ${token}` };

    const { body: aclA } = await createAcl(token, 'config-a', { name: 'scope-acl' });

    const patchOther = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/config-b/acls/${aclA.id}`,
      headers: authHeader,
      payload: { name: 'hijacked' },
    });
    expect(patchOther.statusCode).toBe(404);

    const deleteOther = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/config-b/acls/${aclA.id}`,
      headers: authHeader,
    });
    expect(deleteOther.statusCode).toBe(404);

    const detailOther = await app.inject({
      method: 'GET',
      url: `/api/v1/configurations/config-b/acls/${aclA.id}`,
      headers: authHeader,
    });
    expect(detailOther.statusCode).toBe(404);
  });

  it('returns 403 to a view-only actor on create, patch, and delete', async () => {
    createUserWithRole('usr-viewer', 'viewer', [
      { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
    ]);
    const token = await loginAs('viewer', 'password123');
    const authHeader = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/acls',
      headers: authHeader,
      payload: { name: 'nope' },
    });
    expect(createRes.statusCode).toBe(403);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/configurations/dns-lab/acls/acl-whatever',
      headers: authHeader,
      payload: { name: 'nope' },
    });
    expect(patchRes.statusCode).toBe(403);

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/configurations/dns-lab/acls/acl-whatever',
      headers: authHeader,
    });
    expect(deleteRes.statusCode).toBe(403);
  });

  it('evaluates an ACL by name and returns a trace', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    await createAcl(token, 'dns-lab', {
      name: 'office',
      entries: [
        { type: 'CIDR', value: '10.0.0.0/8' },
        { type: 'ANY', value: null },
      ],
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/acls/evaluate',
      headers: authHeader,
      payload: { target: 'office', clientIp: '10.1.1.1' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ matched: true, decision: 'ALLOW' });
    expect(body.trace).toHaveLength(1);
    expect(body.trace[0].type).toBe('CIDR');
  });

  it('rejects a bad clientIp and a missing target with 422', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const badIp = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/acls/evaluate',
      headers: authHeader,
      payload: { target: 'x', clientIp: 'not an ip' },
    });
    expect(badIp.statusCode).toBe(422);
    expect(JSON.parse(badIp.body).error.code).toBe('INVALID_IP');

    const missingTarget = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/acls/evaluate',
      headers: authHeader,
      payload: { clientIp: '10.0.0.1' },
    });
    expect(missingTarget.statusCode).toBe(422);
    expect(JSON.parse(missingTarget.body).error.code).toBe('INVALID_TARGET');
  });
});
