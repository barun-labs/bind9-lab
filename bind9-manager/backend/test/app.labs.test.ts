import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import * as es from '../src/server/entityStore';

describe('Labs API routes & permissions (DECLARATIVE-LAB Task 1)', () => {
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
      {
        name: 'br0',
        kind: 'bridge' as const,
        intent: 'bridge' as const,
      },
    ],
    links: [
      { endpoints: ['ns1:eth1', 'r1:eth1'] as [string, string] },
    ],
  };

  describe('Authentication enforcement', () => {
    it('returns 401 when no token is supplied', async () => {
      const getRes = await app.inject({ method: 'GET', url: '/api/v1/labs' });
      expect(getRes.statusCode).toBe(401);

      const postRes = await app.inject({
        method: 'POST',
        url: '/api/v1/labs',
        payload: { name: 'lab', configurationId: 'dns-lab', topology: sampleTopology },
      });
      expect(postRes.statusCode).toBe(401);

      const getByIdRes = await app.inject({ method: 'GET', url: '/api/v1/labs/lab-123' });
      expect(getByIdRes.statusCode).toBe(401);

      const patchRes = await app.inject({
        method: 'PATCH',
        url: '/api/v1/labs/lab-123',
        payload: { name: 'new' },
      });
      expect(patchRes.statusCode).toBe(401);

      const delRes = await app.inject({ method: 'DELETE', url: '/api/v1/labs/lab-123' });
      expect(delRes.statusCode).toBe(401);
    });

    it('returns 401 for invalid/malformed bearer token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/labs',
        headers: { authorization: 'Bearer invalid_token_123' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('Authorization enforcement (Admin vs Viewer)', () => {
    beforeEach(() => {
      createUserWithRole('usr-viewer', 'viewer', [
        { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
      ]);
    });

    it('viewer can view labs but cannot mutate (POST/PATCH/DELETE return 403)', async () => {
      const adminToken = await loginAs('admin', 'admin');
      const viewerToken = await loginAs('viewer', 'password123');

      // Admin creates a lab
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/labs',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'admin-created-lab',
          configurationId: 'dns-lab',
          topology: sampleTopology,
        },
      });
      expect(createRes.statusCode).toBe(201);
      const createdLab = JSON.parse(createRes.body);

      // Viewer lists labs -> 200
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/labs?configurationId=dns-lab',
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(listRes.statusCode).toBe(200);
      const labs = JSON.parse(listRes.body);
      expect(labs.some((l: any) => l.id === createdLab.id)).toBe(true);

      // Viewer gets lab by ID -> 200
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/labs/${createdLab.id}`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(getRes.statusCode).toBe(200);
      expect(JSON.parse(getRes.body).name).toBe('admin-created-lab');

      // Viewer tries to create a lab -> 403
      const viewerCreateRes = await app.inject({
        method: 'POST',
        url: '/api/v1/labs',
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: {
          name: 'viewer-lab',
          configurationId: 'dns-lab',
          topology: sampleTopology,
        },
      });
      expect(viewerCreateRes.statusCode).toBe(403);

      // Viewer tries to patch the lab -> 403
      const viewerPatchRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/labs/${createdLab.id}`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: { name: 'viewer-modified' },
      });
      expect(viewerPatchRes.statusCode).toBe(403);

      // Viewer tries to delete the lab -> 403
      const viewerDelRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/labs/${createdLab.id}`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(viewerDelRes.statusCode).toBe(403);
    });

    it('viewer cannot access labs of unauthorized configurations', async () => {
      const viewerToken = await loginAs('viewer', 'password123');

      // Viewer only has access to dns-lab, not split-horizon
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/labs?configurationId=split-horizon',
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(listRes.statusCode).toBe(403);
    });
  });

  describe('Happy path CRUD & reconciliation via API (Admin)', () => {
    it('creates, lists, gets, patches, and deletes a lab, reconciling servers', async () => {
      const token = await loginAs('admin', 'admin');
      const authHeader = { authorization: `Bearer ${token}` };

      // 1. POST /api/v1/labs -> 201
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/labs',
        headers: authHeader,
        payload: {
          name: 'anycast-dns-lab',
          configurationId: 'dns-lab',
          topology: sampleTopology,
        },
      });
      expect(createRes.statusCode).toBe(201);
      const created = JSON.parse(createRes.body);
      expect(created.id).toBeDefined();
      expect(created.name).toBe('anycast-dns-lab');
      expect(created.configurationId).toBe('dns-lab');
      expect(created.createdAt).toBeDefined();
      expect(created.updatedAt).toBeDefined();

      // Verify bind node was reconciled to a Server in DB
      const servers = es.listServers(db, 'dns-lab');
      const ns1Server = servers.find((s) => s.nodeName === 'ns1');
      expect(ns1Server).toBeDefined();
      expect(ns1Server?.id).toBe(`srv-${created.id}-ns1`);
      expect(ns1Server?.hostname).toBe('ns1');
      expect(ns1Server?.mgmtAddress).toBe('10.70.0.11');
      expect(ns1Server?.serviceInterfaces).toEqual([{ address: '10.70.0.11', port: 53 }]);
      // r1 (router) and br0 (bridge) should NOT be servers
      expect(servers.find((s) => s.nodeName === 'r1')).toBeUndefined();
      expect(servers.find((s) => s.nodeName === 'br0')).toBeUndefined();

      // 2. GET /api/v1/labs?configurationId=dns-lab -> 200
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/labs?configurationId=dns-lab',
        headers: authHeader,
      });
      expect(listRes.statusCode).toBe(200);
      const list = JSON.parse(listRes.body);
      expect(list.some((l: any) => l.id === created.id)).toBe(true);

      // 3. GET /api/v1/labs/:id -> 200
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/labs/${created.id}`,
        headers: authHeader,
      });
      expect(getRes.statusCode).toBe(200);
      const fetched = JSON.parse(getRes.body);
      expect(fetched.id).toBe(created.id);
      expect(fetched.name).toBe('anycast-dns-lab');

      // 4. PATCH /api/v1/labs/:id -> 200 (update name and remove bind node)
      const updatedTopology = {
        ...sampleTopology,
        nodes: sampleTopology.nodes.filter((n) => n.name !== 'ns1'),
      };
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/labs/${created.id}`,
        headers: authHeader,
        payload: {
          name: 'renamed-lab',
          topology: updatedTopology,
        },
      });
      expect(patchRes.statusCode).toBe(200);
      const patched = JSON.parse(patchRes.body);
      expect(patched.name).toBe('renamed-lab');

      // Verify ns1 Server was unlinked after removal from topology
      const serversAfterPatch = es.listServers(db, 'dns-lab');
      expect(serversAfterPatch.find((s) => s.nodeName === 'ns1')).toBeUndefined();

      // 5. DELETE /api/v1/labs/:id -> 200
      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/labs/${created.id}`,
        headers: authHeader,
      });
      expect(delRes.statusCode).toBe(200);
      expect(JSON.parse(delRes.body)).toEqual({ deleted: true });

      // 6. GET after delete -> 404
      const getDeletedRes = await app.inject({
        method: 'GET',
        url: `/api/v1/labs/${created.id}`,
        headers: authHeader,
      });
      expect(getDeletedRes.statusCode).toBe(404);
    });
  });

  describe('Validation and error handling', () => {
    it('returns 400 when creating lab with invalid body', async () => {
      const token = await loginAs('admin', 'admin');
      const authHeader = { authorization: `Bearer ${token}` };

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/labs',
        headers: authHeader,
        payload: { name: 'missing-fields' },
      });
      expect(res1.statusCode).toBe(400);
      expect(JSON.parse(res1.body).error?.code).toBe('BAD_REQUEST');

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/labs',
        headers: authHeader,
        payload: {},
      });
      expect(res2.statusCode).toBe(400);
      expect(JSON.parse(res2.body).error?.code).toBe('BAD_REQUEST');
    });

    it('returns 404 for non-existent lab on GET / PATCH / DELETE', async () => {
      const token = await loginAs('admin', 'admin');
      const authHeader = { authorization: `Bearer ${token}` };

      const getRes = await app.inject({
        method: 'GET',
        url: '/api/v1/labs/non-existent-lab',
        headers: authHeader,
      });
      expect(getRes.statusCode).toBe(404);

      const patchRes = await app.inject({
        method: 'PATCH',
        url: '/api/v1/labs/non-existent-lab',
        headers: authHeader,
        payload: { name: 'new-name' },
      });
      expect(patchRes.statusCode).toBe(404);

      const delRes = await app.inject({
        method: 'DELETE',
        url: '/api/v1/labs/non-existent-lab',
        headers: authHeader,
      });
      expect(delRes.statusCode).toBe(404);
    });
  });
});
