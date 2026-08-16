import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import { createExternalHost } from '../src/server/entityStore';

describe('External Hosts API', () => {
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

  it('creates a valid external host, server-generates the id', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/external-hosts',
      headers: { authorization: `Bearer ${token}` },
      payload: { id: 'eh-evil', fqdn: 'ext.example.com' },
    });
    expect(res.statusCode).toBe(201);
    const host = JSON.parse(res.body);
    expect(host.id.startsWith('eh-')).toBe(true);
    expect(host.id).not.toBe('eh-evil');
    expect(host.configurationId).toBe('dns-lab');
    expect(host.fqdn).toBe('ext.example.com');
    expect(host.referenceCount).toBe(0);
  });

  it('rejects fqdn with shell/zone metachars or path traversal (MUST-FAIL CONTROL)', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    for (const bad of ['evil.com; rm -rf', '../../etc', 'a..b.com', '-evil.com', 'evil-.com', '..']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/configurations/dns-lab/external-hosts',
        headers: authHeader,
        payload: { fqdn: bad },
      });
      expect(res.statusCode).toBe(422);
      expect(JSON.parse(res.body).error.code).toBe('INVALID_FQDN');
    }
  });

  it('rejects a duplicate fqdn with 409 CONFLICT', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/external-hosts',
      headers: authHeader,
      payload: { fqdn: 'dup.example.com' },
    });
    expect(first.statusCode).toBe(201);

    const dup = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/external-hosts',
      headers: authHeader,
      payload: { fqdn: 'DUP.Example.COM' }, // case-insensitive dup
    });
    expect(dup.statusCode).toBe(409);
    expect(JSON.parse(dup.body).error.code).toBe('CONFLICT');
  });

  it('lists the created host', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/external-hosts',
      headers: authHeader,
      payload: { fqdn: 'listed.example.com' },
    });
    const host = JSON.parse(createRes.body);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/external-hosts',
      headers: authHeader,
    });
    expect(listRes.statusCode).toBe(200);
    const body = JSON.parse(listRes.body);
    expect(body.data.some((h: any) => h.id === host.id && h.fqdn === 'listed.example.com')).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  it('patches fqdn to a new value; rejects an invalid fqdn with 422', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/external-hosts',
      headers: authHeader,
      payload: { fqdn: 'old.example.com' },
    });
    const host = JSON.parse(createRes.body);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/dns-lab/external-hosts/${host.id}`,
      headers: authHeader,
      payload: { fqdn: 'new.example.com' },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(JSON.parse(patchRes.body).fqdn).toBe('new.example.com');
    expect(JSON.parse(patchRes.body).id).toBe(host.id);
    expect(JSON.parse(patchRes.body).configurationId).toBe('dns-lab');

    const badRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/dns-lab/external-hosts/${host.id}`,
      headers: authHeader,
      payload: { fqdn: 'bad..fqdn.com' },
    });
    expect(badRes.statusCode).toBe(422);
    expect(JSON.parse(badRes.body).error.code).toBe('INVALID_FQDN');
  });

  it('deletes an external host', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/external-hosts',
      headers: authHeader,
      payload: { fqdn: 'gone.example.com' },
    });
    const host = JSON.parse(createRes.body);

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/dns-lab/external-hosts/${host.id}`,
      headers: authHeader,
    });
    expect(delRes.statusCode).toBe(200);
    expect(JSON.parse(delRes.body)).toEqual({ deleted: true });
  });

  it('rejects delete of a host with referenceCount > 0 with 409 HAS_DEPENDENTS', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    // referenceCount is not live-maintained, so seed one via direct row insert.
    db.prepare('INSERT INTO external_hosts (id, configurationId, data) VALUES (?, ?, ?)').run(
      'eh-seeded',
      'dns-lab',
      JSON.stringify({
        id: 'eh-seeded',
        configurationId: 'dns-lab',
        fqdn: 'dep.example.com',
        referenceCount: 2,
      })
    );

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/configurations/dns-lab/external-hosts/eh-seeded',
      headers: authHeader,
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('HAS_DEPENDENTS');
  });

  it('returns 403 to a view-only actor on create', async () => {
    createUserWithRole('usr-viewer', 'viewer', [
      { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
    ]);
    const token = await loginAs('viewer', 'password123');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/external-hosts',
      headers: { authorization: `Bearer ${token}` },
      payload: { fqdn: 'nope.example.com' },
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

    const host = createExternalHost(db, 'config-a', { fqdn: 'scope.example.com' });

    const patchOther = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/config-b/external-hosts/${host.id}`,
      headers: authHeader,
      payload: { fqdn: 'other.example.com' },
    });
    expect(patchOther.statusCode).toBe(404);

    const deleteOther = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/config-b/external-hosts/${host.id}`,
      headers: authHeader,
    });
    expect(deleteOther.statusCode).toBe(404);
  });
});
