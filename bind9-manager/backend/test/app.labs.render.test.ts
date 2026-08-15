import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import * as es from '../src/server/entityStore';
import type { Runner } from '../src/config-engine';

describe('Labs render, YAML, import & validate routes (DECLARATIVE-LAB Task 2)', () => {
  let db: Database.Database;
  let mockRunner: Runner;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = openDb(':memory:');
    mockRunner = async (_script: string) => ({
      code: 0,
      stdout: 'OK',
      stderr: '',
    });
    app = buildApp(db, { runner: mockRunner });
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

  const sample2NodeTopology = {
    name: 'two-node-lab',
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
        name: 'ns2',
        kind: 'linux' as const,
        intent: 'bind' as const,
        image: 'dnsnode:1.0',
        mgmtIpv4: '10.70.0.12',
        interfaces: [{ name: 'eth1', address: '10.70.0.12/24' }],
      },
    ],
    links: [
      { endpoints: ['ns1:eth1', 'ns2:eth1'] as [string, string] },
    ],
  };

  describe('Render & YAML export routes', () => {
    it('creates a lab with 2 nodes via API, POST /labs/:id/render returns 200 and body.yaml contains topology and both node names', async () => {
      const token = await loginAs('admin', 'admin');
      const authHeader = { authorization: `Bearer ${token}` };

      // 1. Create a lab with 2 nodes
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/labs',
        headers: authHeader,
        payload: {
          name: 'two-node-lab',
          configurationId: 'dns-lab',
          topology: sample2NodeTopology,
        },
      });
      expect(createRes.statusCode).toBe(201);
      const lab = JSON.parse(createRes.body);

      // 2. POST /api/v1/labs/:id/render -> 200
      const renderRes = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/render`,
        headers: authHeader,
      });
      expect(renderRes.statusCode).toBe(200);
      const renderBody = JSON.parse(renderRes.body);
      expect(renderBody.yaml).toBeDefined();
      expect(typeof renderBody.yaml).toBe('string');
      expect(renderBody.yaml).toContain('topology:');
      expect(renderBody.yaml).toContain('ns1:');
      expect(renderBody.yaml).toContain('ns2:');
    });

    it('GET /api/v1/labs/:id/yaml returns 200 with text/yaml content-type', async () => {
      const token = await loginAs('admin', 'admin');
      const authHeader = { authorization: `Bearer ${token}` };

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/labs',
        headers: authHeader,
        payload: {
          name: 'yaml-test-lab',
          configurationId: 'dns-lab',
          topology: sample2NodeTopology,
        },
      });
      const lab = JSON.parse(createRes.body);

      const yamlRes = await app.inject({
        method: 'GET',
        url: `/api/v1/labs/${lab.id}/yaml`,
        headers: authHeader,
      });

      expect(yamlRes.statusCode).toBe(200);
      expect(yamlRes.headers['content-type']).toMatch(/text\/yaml/);
      expect(yamlRes.body).toContain('name: two-node-lab');
      expect(yamlRes.body).toContain('ns1:');
      expect(yamlRes.body).toContain('ns2:');
    });

    it('returns 404 for non-existent lab on render and yaml endpoints', async () => {
      const token = await loginAs('admin', 'admin');
      const authHeader = { authorization: `Bearer ${token}` };

      const renderRes = await app.inject({
        method: 'POST',
        url: '/api/v1/labs/non-existent-lab/render',
        headers: authHeader,
      });
      expect(renderRes.statusCode).toBe(404);

      const yamlRes = await app.inject({
        method: 'GET',
        url: '/api/v1/labs/non-existent-lab/yaml',
        headers: authHeader,
      });
      expect(yamlRes.statusCode).toBe(404);
    });
  });

  describe('Import containerlab YAML route (POST /api/v1/labs/import)', () => {
    it('imports a small valid clab.yml string -> 201, returned lab has parsed nodes and bind node reconciles to a Server', async () => {
      const token = await loginAs('admin', 'admin');
      const authHeader = { authorization: `Bearer ${token}` };

      const validClabYaml = `
name: imported-clab
mgmt:
  network: clab-mgmt
  ipv4-subnet: 10.70.0.0/24
topology:
  nodes:
    ns-primary:
      kind: linux
      image: dnsnode:1.0
      mgmt-ipv4: 10.70.0.10
      binds:
        - /var/bind:/etc/bind
    r1:
      kind: linux
      image: dnsnode:1.0
      mgmt-ipv4: 10.70.0.1
      ip-forward: true
    br0:
      kind: bridge
  links:
    - endpoints: ["ns-primary:eth1", "r1:eth1"]
`;

      const importRes = await app.inject({
        method: 'POST',
        url: '/api/v1/labs/import',
        headers: authHeader,
        payload: {
          name: 'My Imported Lab',
          configurationId: 'dns-lab',
          yaml: validClabYaml,
        },
      });

      expect(importRes.statusCode).toBe(201);
      const importedLab = JSON.parse(importRes.body);
      expect(importedLab.id).toBeDefined();
      expect(importedLab.name).toBe('My Imported Lab');
      expect(importedLab.configurationId).toBe('dns-lab');
      expect(importedLab.topology.name).toBe('imported-clab');
      expect(importedLab.topology.mgmtSubnet).toBe('10.70.0.0/24');
      expect(importedLab.topology.nodes).toHaveLength(3);

      const nsPrimaryNode = importedLab.topology.nodes.find((n: any) => n.name === 'ns-primary');
      expect(nsPrimaryNode).toBeDefined();
      expect(nsPrimaryNode.intent).toBe('bind');
      expect(nsPrimaryNode.image).toBe('dnsnode:1.0');
      expect(nsPrimaryNode.mgmtIpv4).toBe('10.70.0.10');
      expect(nsPrimaryNode.binds).toEqual(['/var/bind:/etc/bind']);

      const r1Node = importedLab.topology.nodes.find((n: any) => n.name === 'r1');
      expect(r1Node).toBeDefined();
      expect(r1Node.intent).toBe('router');

      const br0Node = importedLab.topology.nodes.find((n: any) => n.name === 'br0');
      expect(br0Node).toBeDefined();
      expect(br0Node.intent).toBe('bridge');

      // Check Server reconciliation in entityStore / DB
      const servers = es.listServers(db, 'dns-lab');
      const nsPrimaryServer = servers.find((s) => s.nodeName === 'ns-primary');
      expect(nsPrimaryServer).toBeDefined();
      expect(nsPrimaryServer?.id).toBe(`srv-${importedLab.id}-ns-primary`);
      expect(nsPrimaryServer?.mgmtAddress).toBe('10.70.0.10');
      // Router and bridge are not reconciled to servers
      expect(servers.find((s) => s.nodeName === 'r1')).toBeUndefined();
      expect(servers.find((s) => s.nodeName === 'br0')).toBeUndefined();
    });

    it('returns 422 with BAD_YAML when given malformed yaml (":::not yaml")', async () => {
      const token = await loginAs('admin', 'admin');
      const authHeader = { authorization: `Bearer ${token}` };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/labs/import',
        headers: authHeader,
        payload: {
          name: 'bad-yaml-lab',
          configurationId: 'dns-lab',
          yaml: ':::not yaml',
        },
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.body);
      expect(body.error?.code).toBe('BAD_YAML');
      expect(body.error?.message).toBeDefined();
    });

    it('returns 422 with INVALID_TOPOLOGY when given a link referencing an undefined node', async () => {
      const token = await loginAs('admin', 'admin');
      const authHeader = { authorization: `Bearer ${token}` };

      const invalidTopologyYaml = `
name: bad-link-lab
topology:
  nodes:
    ns1:
      kind: linux
      image: dnsnode:1.0
      mgmt-ipv4: 10.70.0.11
  links:
    - endpoints: ["ns1:eth1", "ghost-node:eth1"]
`;

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/labs/import',
        headers: authHeader,
        payload: {
          name: 'bad-link-lab',
          configurationId: 'dns-lab',
          yaml: invalidTopologyYaml,
        },
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.body);
      expect(body.error?.code).toBe('INVALID_TOPOLOGY');
      expect(Array.isArray(body.error?.details)).toBe(true);
      expect(body.error.details.some((d: string) => d.includes('ghost-node'))).toBe(true);
    });

    it('returns 400 when configurationId or yaml is missing from import body', async () => {
      const token = await loginAs('admin', 'admin');
      const authHeader = { authorization: `Bearer ${token}` };

      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/labs/import',
        headers: authHeader,
        payload: { yaml: 'name: test' },
      });
      expect(res1.statusCode).toBe(400);

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/labs/import',
        headers: authHeader,
        payload: { configurationId: 'dns-lab' },
      });
      expect(res2.statusCode).toBe(400);
    });
  });

  describe('Validate lab route (POST /api/v1/labs/:id/validate)', () => {
    it('returns 200 with topology: [] and perServer validation results on a clean lab with mock runner ok', async () => {
      const token = await loginAs('admin', 'admin');
      const authHeader = { authorization: `Bearer ${token}` };

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/labs',
        headers: authHeader,
        payload: {
          name: 'clean-lab',
          configurationId: 'dns-lab',
          topology: sample2NodeTopology,
        },
      });
      const lab = JSON.parse(createRes.body);

      const validateRes = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/validate`,
        headers: authHeader,
      });

      expect(validateRes.statusCode).toBe(200);
      const valBody = JSON.parse(validateRes.body);
      expect(valBody.topology).toEqual([]);
      expect(Array.isArray(valBody.perServer)).toBe(true);
      expect(valBody.perServer).toHaveLength(2);
      expect(valBody.perServer[0].serverId).toBe(`srv-${lab.id}-ns1`);
      expect(valBody.perServer[0].ok).toBe(true);
      expect(valBody.perServer[1].serverId).toBe(`srv-${lab.id}-ns2`);
      expect(valBody.perServer[1].ok).toBe(true);
    });

    it('returns perServer validation errors if runner reports named-checkconf failure', async () => {
      const failingRunner: Runner = async () => ({
        code: 1,
        stdout: '',
        stderr: '/etc/bind/named.conf:10: unknown option "invalid_syntax"',
      });
      const failingApp = buildApp(db, { runner: failingRunner });

      const adminToken = await loginAs('admin', 'admin');
      const authHeader = { authorization: `Bearer ${adminToken}` };

      const createRes = await failingApp.inject({
        method: 'POST',
        url: '/api/v1/labs',
        headers: authHeader,
        payload: {
          name: 'fail-lab',
          configurationId: 'dns-lab',
          topology: sample2NodeTopology,
        },
      });
      const lab = JSON.parse(createRes.body);

      const validateRes = await failingApp.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/validate`,
        headers: authHeader,
      });

      expect(validateRes.statusCode).toBe(200);
      const valBody = JSON.parse(validateRes.body);
      expect(valBody.perServer[0].ok).toBe(false);
      expect(valBody.perServer[0].errors.length).toBeGreaterThan(0);
      expect(valBody.perServer[0].errors[0]).toContain('unknown option');
    });

    it('returns 404 when validating a non-existent lab', async () => {
      const token = await loginAs('admin', 'admin');
      const authHeader = { authorization: `Bearer ${token}` };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/labs/non-existent-lab/validate',
        headers: authHeader,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('Viewer permissions (auth enforcement)', () => {
    beforeEach(() => {
      createUserWithRole('usr-viewer', 'viewer', [
        { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
      ]);
    });

    it('a VIEWER bearer -> 403 on import; 200 on render, yaml, and validate (view)', async () => {
      const adminToken = await loginAs('admin', 'admin');
      const viewerToken = await loginAs('viewer', 'password123');

      // Admin creates a lab
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/labs',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'perm-test-lab',
          configurationId: 'dns-lab',
          topology: sample2NodeTopology,
        },
      });
      expect(createRes.statusCode).toBe(201);
      const lab = JSON.parse(createRes.body);

      // Viewer tries import -> 403
      const importRes = await app.inject({
        method: 'POST',
        url: '/api/v1/labs/import',
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: {
          name: 'viewer-import',
          configurationId: 'dns-lab',
          yaml: 'name: test\ntopology:\n  nodes:\n    ns1:\n      kind: linux\n      image: dnsnode:1.0\n',
        },
      });
      expect(importRes.statusCode).toBe(403);

      // Viewer calls POST /render -> 200
      const renderRes = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/render`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(renderRes.statusCode).toBe(200);

      // Viewer calls GET /yaml -> 200
      const yamlRes = await app.inject({
        method: 'GET',
        url: `/api/v1/labs/${lab.id}/yaml`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(yamlRes.statusCode).toBe(200);

      // Viewer calls POST /validate -> 200
      const validateRes = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/validate`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(validateRes.statusCode).toBe(200);
    });

    it('unauthenticated requests without bearer token return 401 on all endpoints', async () => {
      const renderRes = await app.inject({ method: 'POST', url: '/api/v1/labs/lab-1/render' });
      expect(renderRes.statusCode).toBe(401);

      const yamlRes = await app.inject({ method: 'GET', url: '/api/v1/labs/lab-1/yaml' });
      expect(yamlRes.statusCode).toBe(401);

      const importRes = await app.inject({ method: 'POST', url: '/api/v1/labs/import', payload: {} });
      expect(importRes.statusCode).toBe(401);

      const validateRes = await app.inject({ method: 'POST', url: '/api/v1/labs/lab-1/validate' });
      expect(validateRes.statusCode).toBe(401);
    });
  });
});
