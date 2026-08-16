import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import { createTsigKey, createAcl } from '../src/server/entityStore';

describe('TSIG Keys API', () => {
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

  it('creates a valid TSIG key: server-generated id and secret, algorithm echoed', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/tsig-keys',
      headers: { authorization: `Bearer ${token}` },
      payload: { id: 'tsig-evil', name: 'my-key', algorithm: 'hmac-sha256', secret: 'attacker' },
    });
    expect(res.statusCode).toBe(201);
    const key = JSON.parse(res.body);
    expect(key.id.startsWith('tsig-')).toBe(true);
    expect(key.id).not.toBe('tsig-evil');
    expect(key.configurationId).toBe('dns-lab');
    expect(key.name).toBe('my-key');
    expect(key.algorithm).toBe('hmac-sha256');
    expect(typeof key.secret).toBe('string');
    expect(key.secret.length).toBeGreaterThan(0);
    expect(key.usedByCount).toBe(0);
  });

  it('rejects a name with shell metachars or path traversal (MUST-FAIL CONTROL)', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    for (const bad of ['k;rm', '../x', 'k&echo', 'k$(id)', 'key name']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/configurations/dns-lab/tsig-keys',
        headers: authHeader,
        payload: { name: bad, algorithm: 'hmac-sha256' },
      });
      expect(res.statusCode).toBe(422);
      expect(JSON.parse(res.body).error.code).toBe('INVALID_NAME');
    }
  });

  it('rejects an unknown algorithm with 422 INVALID_ALGORITHM', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/tsig-keys',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'bad-algo', algorithm: 'md5' },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_ALGORITHM');
  });

  it('rejects a duplicate name (case-insensitive) with 409 CONFLICT', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/tsig-keys',
      headers: authHeader,
      payload: { name: 'dup-key', algorithm: 'hmac-sha256' },
    });
    expect(first.statusCode).toBe(201);

    const dup = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/tsig-keys',
      headers: authHeader,
      payload: { name: 'DUP-KEY', algorithm: 'hmac-sha512' },
    });
    expect(dup.statusCode).toBe(409);
    expect(JSON.parse(dup.body).error.code).toBe('CONFLICT');
  });

  it('list and get responses MUST NOT contain the secret (secret-leak guard)', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/tsig-keys',
      headers: authHeader,
      payload: { name: 'no-leak', algorithm: 'hmac-sha256' },
    });
    const created = JSON.parse(createRes.body);
    expect(created.secret.length).toBeGreaterThan(0);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/tsig-keys',
      headers: authHeader,
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = JSON.parse(listRes.body);
    expect(Array.isArray(listBody)).toBe(true);
    expect(listBody.length).toBeGreaterThanOrEqual(1);
    for (const k of listBody) {
      expect(k.secret).toBeUndefined();
    }
    const listed = listBody.find((k: any) => k.id === created.id);
    expect(listed).toBeDefined();
    expect(listed.name).toBe('no-leak');
    expect(listed.algorithm).toBe('hmac-sha256');

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/configurations/dns-lab/tsig-keys/${created.id}`,
      headers: authHeader,
    });
    expect(getRes.statusCode).toBe(200);
    expect(JSON.parse(getRes.body).secret).toBeUndefined();
  });

  it('client-supplied secret in the POST body is ignored', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/tsig-keys',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'forged-secret', algorithm: 'hmac-sha256', secret: 'attacker-controlled' },
    });
    expect(res.statusCode).toBe(201);
    const key = JSON.parse(res.body);
    expect(key.secret).not.toBe('attacker-controlled');
    expect(key.secret.length).toBeGreaterThan(0);
  });

  it('patches name/algorithm; no secret in response; rejects a bad algorithm with 422', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/tsig-keys',
      headers: authHeader,
      payload: { name: 'patch-me', algorithm: 'hmac-sha256' },
    });
    const key = JSON.parse(createRes.body);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/dns-lab/tsig-keys/${key.id}`,
      headers: authHeader,
      payload: { name: 'patched-name', algorithm: 'hmac-sha512' },
    });
    expect(patchRes.statusCode).toBe(200);
    const patched = JSON.parse(patchRes.body);
    expect(patched.id).toBe(key.id);
    expect(patched.configurationId).toBe('dns-lab');
    expect(patched.name).toBe('patched-name');
    expect(patched.algorithm).toBe('hmac-sha512');
    expect(patched.secret).toBeUndefined();

    const badAlgo = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/dns-lab/tsig-keys/${key.id}`,
      headers: authHeader,
      payload: { algorithm: 'not-an-algo' },
    });
    expect(badAlgo.statusCode).toBe(422);
    expect(JSON.parse(badAlgo.body).error.code).toBe('INVALID_ALGORITHM');
  });

  it('deletes a TSIG key with no referencing ACL', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/tsig-keys',
      headers: authHeader,
      payload: { name: 'gone-key', algorithm: 'hmac-sha256' },
    });
    const key = JSON.parse(createRes.body);

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/dns-lab/tsig-keys/${key.id}`,
      headers: authHeader,
    });
    expect(delRes.statusCode).toBe(200);
    expect(JSON.parse(delRes.body)).toEqual({ deleted: true });
  });

  it('rejects delete of a key referenced by an ACL KEY_NAME entry with 409 HAS_DEPENDENTS', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/tsig-keys',
      headers: authHeader,
      payload: { name: 'dep-key', algorithm: 'hmac-sha256' },
    });
    const key = JSON.parse(createRes.body);

    createAcl(db, 'dns-lab', {
      name: 'acl-with-key',
      entries: [{ type: 'KEY_NAME', value: key.name }],
    });

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/dns-lab/tsig-keys/${key.id}`,
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
      url: '/api/v1/configurations/dns-lab/tsig-keys',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'nope', algorithm: 'hmac-sha256' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('scope-guards get, patch and delete across configurations', async () => {
    seedConfiguration('config-a');
    seedConfiguration('config-b');
    createUserWithRole('usr-dual', 'dual', [
      { configurationId: 'config-a', role: 'editor', canDeploy: false },
      { configurationId: 'config-b', role: 'editor', canDeploy: false },
    ]);
    const token = await loginAs('dual', 'password123');
    const authHeader = { authorization: `Bearer ${token}` };

    const key = createTsigKey(db, 'config-a', { name: 'scope-key', algorithm: 'hmac-sha256' });

    const getOther = await app.inject({
      method: 'GET',
      url: `/api/v1/configurations/config-b/tsig-keys/${key.id}`,
      headers: authHeader,
    });
    expect(getOther.statusCode).toBe(404);

    const patchOther = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/config-b/tsig-keys/${key.id}`,
      headers: authHeader,
      payload: { name: 'other-key' },
    });
    expect(patchOther.statusCode).toBe(404);

    const deleteOther = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/config-b/tsig-keys/${key.id}`,
      headers: authHeader,
    });
    expect(deleteOther.statusCode).toBe(404);
  });
});
