import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import * as es from '../src/server/entityStore';

describe('Servers API routes & permissions', () => {
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

  const sampleTopology = {
    name: 'testlab',
    mgmtSubnet: '10.70.0.0/24',
    nodes: [
      {
        name: 'ns1',
        kind: 'linux' as const,
        intent: 'bind' as const,
        image: 'dnsnode:1.0',
        mgmtIpv4: '10.70.0.11',
        interfaces: [{ name: 'eth1', address: '10.70.0.11/24' }],
      },
    ],
    links: [],
  };

  it('lists servers for a configuration the actor can view', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/labs',
      headers: authHeader,
      payload: { name: 'server-lab', configurationId: 'dns-lab', topology: sampleTopology },
    });
    expect(createRes.statusCode).toBe(201);
    const lab = JSON.parse(createRes.body);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/servers',
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    const servers = JSON.parse(res.body);
    expect(servers.some((s: any) => s.id === `srv-${lab.id}-ns1`)).toBe(true);
  });

  it('returns 403 when listing servers the actor cannot view', async () => {
    createUserWithRole('usr-viewer', 'viewer', [
      { configurationId: 'other-config', role: 'viewer', canDeploy: false },
    ]);
    const token = await loginAs('viewer', 'password123');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/servers',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for an unknown server id', async () => {
    const token = await loginAs('admin', 'admin');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/servers/does-not-exist',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('does not leak a server across configurations (cross-config scope)', async () => {
    seedConfiguration('config-a');
    seedConfiguration('config-b');
    createUserWithRole('usr-dual', 'dual', [
      { configurationId: 'config-a', role: 'viewer', canDeploy: false },
      { configurationId: 'config-b', role: 'viewer', canDeploy: false },
    ]);
    es.upsertServer(db, {
      id: 'srv-a-1',
      configurationId: 'config-a',
      hostname: 'ns1',
      nodeName: 'ns1',
    } as any);

    const token = await loginAs('dual', 'password123');

    const okRes = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/config-a/servers/srv-a-1',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(okRes.statusCode).toBe(200);

    const leakRes = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/config-b/servers/srv-a-1',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(leakRes.statusCode).toBe(404);
  });
});
