import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import { createLab, getLab } from '../src/server/labStore';
import { getServer } from '../src/server/entityStore';
import type { Runner } from '../src/server/deployEngine';
import type { TopologyModel } from '../src/config-engine/topology';

describe('POST /api/v1/labs/:id/destroy + DNS-lab guard', () => {
  let db: Database.Database;
  let executedScripts: string[];
  let mockRunner: Runner;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = openDb(':memory:');
    executedScripts = [];
    mockRunner = async (script: string) => {
      executedScripts.push(script);
      return { code: 0, stdout: 'OK', stderr: '' };
    };
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

  const dnsTopology: TopologyModel = {
    name: 'mylab',
    mgmtSubnet: '10.70.0.0/24',
    nodes: [
      {
        name: 'ns1',
        kind: 'linux',
        intent: 'bind',
        image: 'dnsnode:1.0',
        mgmtIpv4: '10.70.0.11',
        interfaces: [{ name: 'eth1', address: '10.70.0.11/24' }],
      },
    ],
    links: [],
  };

  const nonDnsTopology: TopologyModel = {
    name: 'routerlab',
    mgmtSubnet: '10.71.0.0/24',
    nodes: [
      {
        name: 'r1',
        kind: 'linux',
        intent: 'router',
        image: 'dnsnode:1.0',
        mgmtIpv4: '10.71.0.1',
      },
    ],
    links: [],
  };

  it('destroy with a deploy-capable token -> 200; runner receives containerlab destroy against the lab\'s own topo.clab.yml and no foreign container name; lab DESTROYED; bind Server NODE_ABSENT', async () => {
    const adminToken = await loginAs('admin', 'admin');
    const adminHeader = { authorization: `Bearer ${adminToken}` };

    const lab = createLab(db, {
      name: 'mylab',
      configurationId: 'dns-lab',
      topology: dnsTopology,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/labs/${lab.id}/destroy`,
      headers: adminHeader,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.lab.lifecycleState).toBe('DESTROYED');
    expect(body.lab.lastDestroyedAt).toBeDefined();

    const destroyScript = executedScripts.find((s) => s.includes('containerlab destroy'));
    expect(destroyScript).toBeDefined();
    expect(destroyScript).toContain('/home/lun/mylab/topo.clab.yml');
    expect(destroyScript).not.toContain('--all');
    // No foreign container name — the script only names the lab's own topo file, not any container.
    expect(destroyScript).not.toContain('clab-mylab-ns1');
    expect(destroyScript).not.toContain('other-lab');

    const reread = getLab(db, lab.id);
    expect(reread!.lifecycleState).toBe('DESTROYED');

    const srv = getServer(db, 'srv-' + lab.id + '-ns1') as any;
    expect(srv.syncState).toBe('NODE_ABSENT');

    expect(Array.isArray(body.servers)).toBe(true);
    expect(body.servers.some((s: any) => s.id === 'srv-' + lab.id + '-ns1')).toBe(true);
  });

  it('destroy without deploy permission -> 403', async () => {
    createUserWithRole('usr-viewer', 'viewer-user', [
      { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
    ]);

    const token = await loginAs('viewer-user', 'password123');
    const authHeader = { authorization: `Bearer ${token}` };

    const lab = createLab(db, {
      name: 'mylab',
      configurationId: 'dns-lab',
      topology: dnsTopology,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/labs/${lab.id}/destroy`,
      headers: authHeader,
    });

    expect(res.statusCode).toBe(403);
    expect(executedScripts.some((s) => s.includes('containerlab destroy'))).toBe(false);
  });

  it('destroy of an unknown lab -> 404', async () => {
    const adminToken = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/labs/non-existent-lab-id/destroy',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND');
  });

  it('DNS-lab guard control: a non-bind lab returns 422 NOT_A_DNS_LAB from BOTH /deploy and /destroy, and the runner is never invoked', async () => {
    const adminToken = await loginAs('admin', 'admin');
    const adminHeader = { authorization: `Bearer ${adminToken}` };

    const lab = createLab(db, {
      name: 'routerlab',
      configurationId: 'dns-lab',
      topology: nonDnsTopology,
    });

    const deployRes = await app.inject({
      method: 'POST',
      url: `/api/v1/labs/${lab.id}/deploy`,
      headers: adminHeader,
    });
    expect(deployRes.statusCode).toBe(422);
    expect(JSON.parse(deployRes.body).error.code).toBe('NOT_A_DNS_LAB');

    const destroyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/labs/${lab.id}/destroy`,
      headers: adminHeader,
    });
    expect(destroyRes.statusCode).toBe(422);
    expect(JSON.parse(destroyRes.body).error.code).toBe('NOT_A_DNS_LAB');

    // The must-fail control: the runner was never invoked for either route.
    expect(executedScripts.length).toBe(0);
    expect(executedScripts.some((s) => s.includes('containerlab'))).toBe(false);
  });

  it('destroy runner failure -> 502 DESTROY_FAILED, lab lifecycle NOT flipped to DESTROYED', async () => {
    const failingRunner: Runner = async (script: string) => {
      executedScripts.push(script);
      if (script.includes('containerlab destroy')) {
        return { code: 1, stdout: '', stderr: 'destroy failed: containers busy' };
      }
      return { code: 0, stdout: 'OK', stderr: '' };
    };
    const failingApp = buildApp(db, { runner: failingRunner });

    const adminToken = await loginAs('admin', 'admin');
    const adminHeader = { authorization: `Bearer ${adminToken}` };

    const lab = createLab(db, {
      name: 'mylab',
      configurationId: 'dns-lab',
      topology: dnsTopology,
    });

    const res = await failingApp.inject({
      method: 'POST',
      url: `/api/v1/labs/${lab.id}/destroy`,
      headers: adminHeader,
    });

    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error.code).toBe('DESTROY_FAILED');

    const reread = getLab(db, lab.id);
    expect(reread!.lifecycleState).not.toBe('DESTROYED');
  });
});
