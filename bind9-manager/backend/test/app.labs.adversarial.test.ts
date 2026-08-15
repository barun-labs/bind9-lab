import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import * as es from '../src/server/entityStore';

type App = ReturnType<typeof buildApp>;

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

function seedUser(
  db: Database.Database,
  id: string,
  username: string,
  password: string,
  roles: Array<{ configurationId: string; role: 'viewer' | 'editor' | 'admin'; canDeploy: boolean }>
): void {
  const { salt, hash } = hashPassword(password);
  db.prepare(`
    INSERT INTO users (id, username, displayName, isActive, roles, pwSalt, pwHash, createdAt)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?)
  `).run(id, username, username, JSON.stringify(roles), salt, hash, new Date().toISOString());
}

async function login(app: App, username: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    payload: { username, password },
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body).token as string;
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
    {
      name: 'r1',
      kind: 'linux' as const,
      intent: 'router' as const,
      image: 'dnsnode:1.0',
      mgmtIpv4: '10.70.0.1',
    },
  ],
  links: [{ endpoints: ['ns1:eth1', 'r1:eth1'] as [string, string] }],
};

describe('Labs API — adversarial', () => {
  let db: Database.Database;
  let app: App;

  beforeEach(() => {
    db = openDb(':memory:');
    app = buildApp(db);
  });

  describe('authentication: every /labs route -> 401 unauth', () => {
    it('no Authorization header on every /labs verb -> 401', async () => {
      const attempts: Array<{ method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; payload?: any }> = [
        { method: 'GET', url: '/api/v1/labs' },
        { method: 'GET', url: '/api/v1/labs/lab-1' },
        { method: 'POST', url: '/api/v1/labs', payload: { name: 'x', configurationId: 'dns-lab', topology: sampleTopology } },
        { method: 'PATCH', url: '/api/v1/labs/lab-1', payload: { name: 'x' } },
        { method: 'DELETE', url: '/api/v1/labs/lab-1' },
      ];
      for (const a of attempts) {
        const res = await app.inject({ method: a.method, url: a.url, payload: a.payload });
        expect(res.statusCode, `${a.method} ${a.url}`).toBe(401);
      }
    });

    it('garbage / malformed bearer -> 401', async () => {
      for (const h of ['Bearer nope', 'Bearer ', 'Basic x', 'admin']) {
        const res = await app.inject({ method: 'GET', url: '/api/v1/labs', headers: { authorization: h } });
        expect(res.statusCode, `auth=${h}`).toBe(401);
      }
    });
  });

  describe('authorization: viewer 200 on GET, 403 on POST/PATCH/DELETE', () => {
    beforeEach(() => {
      seedUser(db, 'usr-viewer', 'viewer1', 'viewerpass', [
        { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
      ]);
    });

    it('viewer: GET list + GET by id -> 200; mutations -> 403', async () => {
      const adminToken = await login(app, 'admin', 'admin');
      const viewerToken = await login(app, 'viewer1', 'viewerpass');

      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/labs',
        headers: bearer(adminToken),
        payload: { name: 'lab', configurationId: 'dns-lab', topology: sampleTopology },
      });
      expect(created.statusCode).toBe(201);
      const labId = JSON.parse(created.body).id as string;

      const list = await app.inject({ method: 'GET', url: '/api/v1/labs?configurationId=dns-lab', headers: bearer(viewerToken) });
      expect(list.statusCode).toBe(200);
      expect((JSON.parse(list.body) as Array<{ id: string }>).some((l) => l.id === labId)).toBe(true);

      const get = await app.inject({ method: 'GET', url: `/api/v1/labs/${labId}`, headers: bearer(viewerToken) });
      expect(get.statusCode).toBe(200);

      const post = await app.inject({ method: 'POST', url: '/api/v1/labs', headers: bearer(viewerToken), payload: { name: 'x', configurationId: 'dns-lab', topology: sampleTopology } });
      expect(post.statusCode).toBe(403);

      const patch = await app.inject({ method: 'PATCH', url: `/api/v1/labs/${labId}`, headers: bearer(viewerToken), payload: { name: 'x' } });
      expect(patch.statusCode).toBe(403);

      const del = await app.inject({ method: 'DELETE', url: `/api/v1/labs/${labId}`, headers: bearer(viewerToken) });
      expect(del.statusCode).toBe(403);
    });

    it('viewer: GET by id of a lab in an unauthorized config -> 403', async () => {
      // Admin cannot create in split-horizon (admin role is dns-lab only), so seed directly.
      const { createLab } = await import('../src/server/labStore');
      const lab = createLab(db, { name: 'split-lab', configurationId: 'split-horizon', topology: { name: 'x', nodes: [], links: [] } });

      const viewerToken = await login(app, 'viewer1', 'viewerpass');
      const res = await app.inject({ method: 'GET', url: `/api/v1/labs/${lab.id}`, headers: bearer(viewerToken) });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('admin: full access + create-then-get round-trip', () => {
    it('admin creates (201), lists, gets, patches, deletes (200) a lab', async () => {
      const token = await login(app, 'admin', 'admin');

      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/labs',
        headers: bearer(token),
        payload: { name: 'lab', configurationId: 'dns-lab', topology: sampleTopology },
      });
      expect(created.statusCode).toBe(201);
      const lab = JSON.parse(created.body);
      expect(lab.name).toBe('lab');
      expect(lab.configurationId).toBe('dns-lab');

      const get = await app.inject({ method: 'GET', url: `/api/v1/labs/${lab.id}`, headers: bearer(token) });
      expect(get.statusCode).toBe(200);
      expect(JSON.parse(get.body).id).toBe(lab.id);
      expect(JSON.parse(get.body).name).toBe('lab');

      const patch = await app.inject({ method: 'PATCH', url: `/api/v1/labs/${lab.id}`, headers: bearer(token), payload: { name: 'renamed' } });
      expect(patch.statusCode).toBe(200);
      expect(JSON.parse(patch.body).name).toBe('renamed');

      const del = await app.inject({ method: 'DELETE', url: `/api/v1/labs/${lab.id}`, headers: bearer(token) });
      expect(del.statusCode).toBe(200);
      expect(JSON.parse(del.body)).toEqual({ deleted: true });

      const getAfter = await app.inject({ method: 'GET', url: `/api/v1/labs/${lab.id}`, headers: bearer(token) });
      expect(getAfter.statusCode).toBe(404);
    });

    it('missing lab id on GET/PATCH/DELETE -> 404', async () => {
      const token = await login(app, 'admin', 'admin');
      expect((await app.inject({ method: 'GET', url: '/api/v1/labs/missing', headers: bearer(token) })).statusCode).toBe(404);
      expect((await app.inject({ method: 'PATCH', url: '/api/v1/labs/missing', headers: bearer(token), payload: { name: 'x' } })).statusCode).toBe(404);
      expect((await app.inject({ method: 'DELETE', url: '/api/v1/labs/missing', headers: bearer(token) })).statusCode).toBe(404);
    });
  });

  describe('no secret leakage from /labs responses', () => {
    it('create + list + get bodies contain no token/keyHash/pwHash/pwSalt/password', async () => {
      const token = await login(app, 'admin', 'admin');
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/labs',
        headers: bearer(token),
        payload: { name: 'lab', configurationId: 'dns-lab', topology: sampleTopology },
      });
      expect(created.statusCode).toBe(201);

      const list = await app.inject({ method: 'GET', url: '/api/v1/labs?configurationId=dns-lab', headers: bearer(token) });
      const get = await app.inject({ method: 'GET', url: `/api/v1/labs/${JSON.parse(created.body).id}`, headers: bearer(token) });

      const needles = ['"token"', '"keyhash"', '"pwhash"', '"pwsalt"', '"password"', 'bnd_'];
      for (const [label, res] of [
        ['create', created],
        ['list', list],
        ['get', get],
      ] as const) {
        expect([200, 201], label).toContain(res.statusCode);
        const body = res.body.toLowerCase();
        for (const n of needles) {
          expect(body, `${label} leaks ${n}`).not.toContain(n);
        }
      }
    });
  });

  describe('JSON safety via API', () => {
    it('lab name + node name with quotes/unicode round-trips through POST + GET intact', async () => {
      const token = await login(app, 'admin', 'admin');
      const name = 'lab "un é" 😀 <&>';
      const nodeName = 'ns-"ünïcode"😀';
      const topology = {
        ...sampleTopology,
        nodes: [{ ...sampleTopology.nodes[0], name: nodeName }],
      };

      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/labs',
        headers: bearer(token),
        payload: { name, configurationId: 'dns-lab', topology },
      });
      expect(created.statusCode).toBe(201);
      const labId = JSON.parse(created.body).id as string;

      const get = await app.inject({ method: 'GET', url: `/api/v1/labs/${labId}`, headers: bearer(token) });
      expect(get.statusCode).toBe(200);
      const lab = JSON.parse(get.body);
      expect(lab.name).toBe(name);
      expect(lab.topology.nodes[0].name).toBe(nodeName);

      const [srv] = es.listServers(db, 'dns-lab').filter((s) => s.nodeName === nodeName);
      expect(srv).toBeDefined();
      expect(srv.hostname).toBe(nodeName);
    });
  });
});
