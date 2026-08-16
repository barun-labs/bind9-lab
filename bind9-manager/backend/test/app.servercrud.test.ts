import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';

describe('Server CRUD API (create / update / delete)', () => {
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
    const body = JSON.parse(res.body);
    return body.token;
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

  it('creates a server and exposes it via the list route', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/servers',
      headers: authHeader,
      payload: {
        hostname: 'ns-a.example.com',
        mgmtAddress: '10.70.0.20',
        image: 'dnsnode:1.0',
        serviceInterfaces: [{ address: '10.70.0.20', port: 53 }],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const server = JSON.parse(createRes.body);
    expect(server.id.startsWith('srv-')).toBe(true);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/servers',
      headers: authHeader,
    });
    expect(listRes.statusCode).toBe(200);
    const servers = JSON.parse(listRes.body);
    expect(servers.some((s: any) => s.id === server.id)).toBe(true);
  });

  it('ignores a client-supplied id and always generates one server-side', async () => {
    const token = await loginAs('admin', 'admin');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/servers',
      headers: { authorization: `Bearer ${token}` },
      payload: { id: 'srv-evil', hostname: 'ns-injected.example.com' },
    });
    expect(res.statusCode).toBe(201);
    const server = JSON.parse(res.body);
    expect(server.id).not.toBe('srv-evil');
    expect(/^srv-[0-9a-f]{16}$/.test(server.id)).toBe(true);
  });

  it('rejects an invalid hostname and invalid nodeName with 422', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const badHost = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/servers',
      headers: authHeader,
      payload: { hostname: 'bad host!' },
    });
    expect(badHost.statusCode).toBe(422);
    expect(JSON.parse(badHost.body).error.code).toBe('INVALID_NAME');

    for (const nodeName of ['a;b', '../x']) {
      const badNode = await app.inject({
        method: 'POST',
        url: '/api/v1/configurations/dns-lab/servers',
        headers: authHeader,
        payload: { hostname: 'ns-ok.example.com', nodeName },
      });
      expect(badNode.statusCode).toBe(422);
      expect(JSON.parse(badNode.body).error.code).toBe('INVALID_NAME');
    }
  });

  it('returns 403 to a view-only actor on create, patch, and delete', async () => {
    createUserWithRole('usr-viewer', 'viewer', [
      { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
    ]);
    const token = await loginAs('viewer', 'password123');
    const authHeader = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/servers',
      headers: authHeader,
      payload: { hostname: 'ns-viewer.example.com' },
    });
    expect(createRes.statusCode).toBe(403);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/configurations/dns-lab/servers/srv-any',
      headers: authHeader,
      payload: { hostname: 'ns-renamed.example.com' },
    });
    expect(patchRes.statusCode).toBe(403);

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/configurations/dns-lab/servers/srv-any',
      headers: authHeader,
    });
    expect(deleteRes.statusCode).toBe(403);
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

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/config-a/servers',
      headers: authHeader,
      payload: { hostname: 'ns-scope.example.com' },
    });
    expect(createRes.statusCode).toBe(201);
    const server = JSON.parse(createRes.body);

    const patchOther = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/config-b/servers/${server.id}`,
      headers: authHeader,
      payload: { hostname: 'ns-hijacked.example.com' },
    });
    expect(patchOther.statusCode).toBe(404);

    const deleteOther = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/config-b/servers/${server.id}`,
      headers: authHeader,
    });
    expect(deleteOther.statusCode).toBe(404);

    const stillThere = await app.inject({
      method: 'GET',
      url: `/api/v1/configurations/config-a/servers/${server.id}`,
      headers: authHeader,
    });
    expect(stillThere.statusCode).toBe(200);
    expect(JSON.parse(stillThere.body).id).toBe(server.id);
  });

  it('deletes a server so a subsequent detail GET returns 404', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/servers',
      headers: authHeader,
      payload: { hostname: 'ns-delete.example.com' },
    });
    expect(createRes.statusCode).toBe(201);
    const server = JSON.parse(createRes.body);

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/dns-lab/servers/${server.id}`,
      headers: authHeader,
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(JSON.parse(deleteRes.body).deleted).toBe(true);

    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/v1/configurations/dns-lab/servers/${server.id}`,
      headers: authHeader,
    });
    expect(detailRes.statusCode).toBe(404);
  });

  it('normalizes an out-of-range adminState on PATCH to ENABLED', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/servers',
      headers: authHeader,
      payload: { hostname: 'ns-admin.example.com', adminState: 'DISABLED' },
    });
    const server = JSON.parse(createRes.body);
    expect(server.adminState).toBe('DISABLED');

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/dns-lab/servers/${server.id}`,
      headers: authHeader,
      payload: { adminState: 'HACKED' },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(JSON.parse(patchRes.body).adminState).toBe('ENABLED');
  });
});
