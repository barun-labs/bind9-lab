import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';

// ADVERSARIAL: red-team the three new server CRUD routes. Assert the SAFE
// outcome. A failed assertion here = a real vulnerability in src/server/app.ts.
describe('Server CRUD — adversarial', () => {
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

  async function listServers(token: string, configId: string): Promise<any[]> {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/configurations/${configId}/servers`,
      headers: { authorization: `Bearer ${token}` },
    });
    return JSON.parse(res.body);
  }

  // --- Case 1: id injection -------------------------------------------------
  it('CASE 1 — client-supplied id is ignored on POST and cannot be changed on PATCH', async () => {
    const token = await loginAs('admin', 'admin');
    const auth = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/servers',
      headers: auth,
      payload: { hostname: 'ok', id: 'srv-lab-EVIL-ns1' },
    });
    expect(createRes.statusCode).toBe(201);
    const created = JSON.parse(createRes.body);
    expect(created.id).not.toBe('srv-lab-EVIL-ns1');
    expect(/^srv-[0-9a-f]{16}$/.test(created.id)).toBe(true);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/dns-lab/servers/${created.id}`,
      headers: auth,
      payload: { id: 'srv-other' },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(JSON.parse(patchRes.body).id).toBe(created.id);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/configurations/dns-lab/servers/${created.id}`,
      headers: auth,
    });
    expect(JSON.parse(detail.body).id).toBe(created.id);
  });

  // --- Case 2: configurationId body override -------------------------------
  it('CASE 2 — body configurationId cannot move a server into another config', async () => {
    seedConfiguration('cfg-a');
    seedConfiguration('other-cfg');
    createUserWithRole('usr-c2', 'c2', [
      { configurationId: 'cfg-a', role: 'editor', canDeploy: false },
      { configurationId: 'other-cfg', role: 'editor', canDeploy: false },
    ]);
    const token = await loginAs('c2', 'password123');
    const auth = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/cfg-a/servers',
      headers: auth,
      payload: { hostname: 'ok', configurationId: 'other-cfg' },
    });
    expect(createRes.statusCode).toBe(201);
    const created = JSON.parse(createRes.body);
    expect(created.configurationId).toBe('cfg-a');
    expect(created.configurationId).not.toBe('other-cfg');

    const inA = await listServers(token, 'cfg-a');
    const inOther = await listServers(token, 'other-cfg');
    expect(inA.some((s: any) => s.id === created.id)).toBe(true);
    expect(inOther.some((s: any) => s.id === created.id)).toBe(false);
  });

  // --- Case 3: hostname charset bypass -------------------------------------
  it('CASE 3 — hostile hostnames are rejected 422 and never created', async () => {
    const token = await loginAs('admin', 'admin');
    const auth = { authorization: `Bearer ${token}` };
    const hostile = ['a;rm -rf /', 'a b', '../../etc', 'a$(id)', '', 'a\nb'];

    for (const hostname of hostile) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/configurations/dns-lab/servers',
        headers: auth,
        payload: { hostname },
      });
      expect(res.statusCode, `hostname ${JSON.stringify(hostname)} should be 422`).toBe(422);
      expect(JSON.parse(res.body).error.code).toBe('INVALID_NAME');
    }

    const servers = await listServers(token, 'dns-lab');
    for (const hostname of hostile) {
      expect(servers.some((s: any) => s.hostname === hostname)).toBe(false);
    }
  });

  // --- Case 4: nodeName charset bypass -------------------------------------
  it('CASE 4 — hostile nodeNames are rejected 422', async () => {
    const token = await loginAs('admin', 'admin');
    const auth = { authorization: `Bearer ${token}` };
    const hostile = ['a;b', '../x', 'a b', 'clab-x/y'];

    for (const nodeName of hostile) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/configurations/dns-lab/servers',
        headers: auth,
        payload: { hostname: 'ok', nodeName },
      });
      expect(res.statusCode, `nodeName ${JSON.stringify(nodeName)} should be 422`).toBe(422);
      expect(JSON.parse(res.body).error.code).toBe('INVALID_NAME');
    }
  });

  // --- Case 5: scope escape -------------------------------------------------
  it('CASE 5 — PATCH/DELETE/GET across config B cannot reach a server in config A', async () => {
    seedConfiguration('config-a');
    seedConfiguration('config-b');
    createUserWithRole('usr-c5', 'c5', [
      { configurationId: 'config-a', role: 'editor', canDeploy: false },
      { configurationId: 'config-b', role: 'editor', canDeploy: false },
    ]);
    const token = await loginAs('c5', 'password123');
    const auth = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/config-a/servers',
      headers: auth,
      payload: { hostname: 'ns-scope.example.com' },
    });
    expect(createRes.statusCode).toBe(201);
    const server = JSON.parse(createRes.body);

    const patchB = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/config-b/servers/${server.id}`,
      headers: auth,
      payload: { hostname: 'ns-hijacked.example.com' },
    });
    expect(patchB.statusCode).toBe(404);

    const deleteB = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/config-b/servers/${server.id}`,
      headers: auth,
    });
    expect(deleteB.statusCode).toBe(404);

    const getB = await app.inject({
      method: 'GET',
      url: `/api/v1/configurations/config-b/servers/${server.id}`,
      headers: auth,
    });
    expect(getB.statusCode).toBe(404);

    const still = await app.inject({
      method: 'GET',
      url: `/api/v1/configurations/config-a/servers/${server.id}`,
      headers: auth,
    });
    expect(still.statusCode).toBe(200);
    expect(JSON.parse(still.body).hostname).toBe('ns-scope.example.com');
  });

  // --- Case 6: authz --------------------------------------------------------
  it('CASE 6 — view-only actor gets 403, anonymous gets 401 (never 2xx)', async () => {
    createUserWithRole('usr-viewer', 'viewer', [
      { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
    ]);
    const viewToken = await loginAs('viewer', 'password123');
    const viewAuth = { authorization: `Bearer ${viewToken}` };

    const post = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/servers',
      headers: viewAuth,
      payload: { hostname: 'ns-x.example.com' },
    });
    expect(post.statusCode).toBe(403);

    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/v1/configurations/dns-lab/servers/srv-any',
      headers: viewAuth,
      payload: { hostname: 'ns-y.example.com' },
    });
    expect(patch.statusCode).toBe(403);

    const del = await app.inject({
      method: 'DELETE',
      url: '/api/v1/configurations/dns-lab/servers/srv-any',
      headers: viewAuth,
    });
    expect(del.statusCode).toBe(403);

    const anon = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/servers',
      payload: { hostname: 'ns-anon.example.com' },
    });
    expect(anon.statusCode).toBe(401);
  });

  // --- Case 7: prototype pollution -----------------------------------------
  it('CASE 7 — __proto__ payload does not pollute Object.prototype', async () => {
    const token = await loginAs('admin', 'admin');
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    const top = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/servers',
      headers: auth,
      payload: '{"hostname":"ok","__proto__":{"polluted":true}}',
    });
    // Fastify may reject __proto__ bodies at parse time (400) — that is safe too.
    expect(top.statusCode).toBeLessThan(500);
    expect(({} as any).polluted).toBeUndefined();

    const nested = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/servers',
      headers: auth,
      payload: '{"hostname":"ok","serviceInterfaces":[{"address":"x","__proto__":{"y":1}}]}',
    });
    expect(nested.statusCode).toBeLessThan(500);
    expect(({} as any).polluted).toBeUndefined();
    expect(({} as any).y).toBeUndefined();
  });

  // --- Case 8: serviceInterfaces garbage -----------------------------------
  it('CASE 8 — garbage serviceInterfaces never crash, only well-formed entries survive', async () => {
    const token = await loginAs('admin', 'admin');
    const auth = { authorization: `Bearer ${token}` };

    const garbage = ['not-an-array', 123, [null, 5, {}], [{ address: 123 }]];
    for (const si of garbage) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/configurations/dns-lab/servers',
        headers: auth,
        payload: { hostname: 'ok', serviceInterfaces: si },
      });
      expect(res.statusCode, `serviceInterfaces ${JSON.stringify(si)} should not 500`).toBeLessThan(500);
      if (res.statusCode === 201) {
        expect(JSON.parse(res.body).serviceInterfaces).toEqual([]);
      }
    }

    // Mixed: only well-formed {address:string, port:number} entries survive.
    const mixed = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/servers',
      headers: auth,
      payload: {
        hostname: 'ok',
        serviceInterfaces: [
          { address: '10.0.0.1', port: 53 },
          { address: 123 },
          'garbage',
          { address: '10.0.0.2' },
          null,
        ],
      },
    });
    expect(mixed.statusCode).toBe(201);
    expect(JSON.parse(mixed.body).serviceInterfaces).toEqual([
      { address: '10.0.0.1', port: 53 },
      { address: '10.0.0.2', port: 53 },
    ]);
  });
});
