import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import { createLab, getLab, setLabLifecycle, listLabs } from '../src/server/labStore';
import { getServer } from '../src/server/entityStore';
import type { Runner } from '../src/server/deployEngine';
import type { TopologyModel } from '../src/config-engine/topology';

/**
 * Adversarial attack on POST /api/v1/labs/:id/destroy and the DNS-lab guard.
 *
 * Every case below asserts the SAFE outcome. A failing assertion is a real
 * security/consistency bug, not a test problem.
 */
describe('destroy route + DNS-lab isolation (adversarial)', () => {
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

  function dnsTopologyNamed(name: string): TopologyModel {
    return {
      name,
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
  }

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

  function syncStateOf(labId: string, nodeName: string): string | undefined {
    const srv = getServer(db, 'srv-' + labId + '-' + nodeName) as any;
    return srv?.syncState;
  }

  // Case 1 — view-only actor must not tear anything down.
  it('view-only user (view but NOT deploy) -> destroy 403, runner never invoked', async () => {
    createUserWithRole('usr-viewer', 'viewer-user', [
      { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
    ]);

    const token = await loginAs('viewer-user', 'password123');
    const authHeader = { authorization: `Bearer ${token}` };

    const lab = createLab(db, {
      name: 'mylab',
      configurationId: 'dns-lab',
      topology: dnsTopologyNamed('mylab'),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/labs/${lab.id}/destroy`,
      headers: authHeader,
    });

    expect(res.statusCode).toBe(403);
    expect(executedScripts.some((s) => s.includes('containerlab destroy'))).toBe(false);
    // Nothing about the lab changed.
    expect(getLab(db, lab.id)!.lifecycleState).toBe('NEVER_DEPLOYED');
    expect(syncStateOf(lab.id, 'ns1')).not.toBe('NODE_ABSENT');
  });

  // Case 2 — a non-DNS lab is untouchable across every runtime surface.
  it('non-DNS lab -> deploy/destroy/telemetry/sync/logs all 422 NOT_A_DNS_LAB, runner never invoked', async () => {
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

    const telemetryRes = await app.inject({
      method: 'GET',
      url: `/api/v1/labs/${lab.id}/telemetry`,
      headers: adminHeader,
    });
    expect(telemetryRes.statusCode).toBe(422);
    expect(JSON.parse(telemetryRes.body).error.code).toBe('NOT_A_DNS_LAB');

    const syncRes = await app.inject({
      method: 'POST',
      url: `/api/v1/labs/${lab.id}/sync`,
      headers: adminHeader,
    });
    expect(syncRes.statusCode).toBe(422);
    expect(JSON.parse(syncRes.body).error.code).toBe('NOT_A_DNS_LAB');

    const logsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/labs/${lab.id}/nodes/r1/logs`,
      headers: adminHeader,
    });
    expect(logsRes.statusCode).toBe(422);
    expect(JSON.parse(logsRes.body).error.code).toBe('NOT_A_DNS_LAB');

    expect(executedScripts.length).toBe(0);
  });

  // Case 3 — a traversing/command-injecting topology.name is rejected at CREATE,
  // so no lab with such a name can ever exist to be destroyed.
  it('CREATE rejects traversal/injection topology.name (422 INVALID_NAME); no such lab exists', async () => {
    const adminToken = await loginAs('admin', 'admin');
    const adminHeader = { authorization: `Bearer ${adminToken}` };

    const badNames = ['../../etc', 'a; rm -rf /', 'foo/bar'];
    for (const bad of badNames) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/labs',
        headers: adminHeader,
        payload: {
          name: 'evil',
          configurationId: 'dns-lab',
          topology: { ...dnsTopologyNamed('mylab'), name: bad },
        },
      });
      expect(res.statusCode).toBe(422);
      expect(JSON.parse(res.body).error.code).toBe('INVALID_NAME');
    }

    // No lab with a traversing topology name ever landed in the store.
    const traversing = listLabs(db).filter((l) => badNames.includes(l.topology.name));
    expect(traversing.length).toBe(0);
  });

  // Case 4 — destroy targets ONLY this lab's own topo file, never --all or a foreign name.
  it('destroy script is scoped to this lab\'s topo.clab.yml; no --all, no container name, no sibling name', async () => {
    const adminToken = await loginAs('admin', 'admin');
    const adminHeader = { authorization: `Bearer ${adminToken}` };

    const lab = createLab(db, {
      name: 'mylab',
      configurationId: 'dns-lab',
      topology: dnsTopologyNamed('mylab'),
    });
    // A sibling lab in the same config must never appear in this lab's destroy script.
    createLab(db, {
      name: 'sibling-lab',
      configurationId: 'dns-lab',
      topology: dnsTopologyNamed('siblinglab'),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/labs/${lab.id}/destroy`,
      headers: adminHeader,
    });
    expect(res.statusCode).toBe(200);

    const destroyScripts = executedScripts.filter((s) => s.includes('containerlab destroy'));
    expect(destroyScripts.length).toBe(1);
    const destroyScript = destroyScripts[0];

    expect(destroyScript).toContain('/home/lun/mylab/topo.clab.yml');
    expect(destroyScript).not.toContain('--all');
    expect(destroyScript).not.toContain('clab-mylab-ns1');
    expect(destroyScript).not.toContain('clab-siblinglab-ns1');
    expect(destroyScript).not.toContain('siblinglab');
  });

  // Case 5 — a failing runner must not flip lifecycle or force NODE_ABSENT.
  it('destroy runner failure -> 502 DESTROY_FAILED, lifecycle stays, servers NOT NODE_ABSENT', async () => {
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
      topology: dnsTopologyNamed('mylab'),
    });

    const res = await failingApp.inject({
      method: 'POST',
      url: `/api/v1/labs/${lab.id}/destroy`,
      headers: adminHeader,
    });

    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error.code).toBe('DESTROY_FAILED');

    const reread = getLab(db, lab.id)!;
    expect(reread.lifecycleState).not.toBe('DESTROYED');
    expect(reread.lifecycleState).toBe('NEVER_DEPLOYED');
    expect(reread.lastDestroyedAt).toBeUndefined();
    expect(syncStateOf(lab.id, 'ns1')).not.toBe('NODE_ABSENT');
  });

  // Case 6 — destroying lab A must not touch lab B's lifecycle or Server rows.
  it('destroy of lab A leaves sibling lab B lifecycle + Server rows untouched', async () => {
    const adminToken = await loginAs('admin', 'admin');
    const adminHeader = { authorization: `Bearer ${adminToken}` };

    const labA = createLab(db, {
      name: 'lab-a',
      configurationId: 'dns-lab',
      topology: dnsTopologyNamed('lab-a'),
    });
    const labB = createLab(db, {
      name: 'lab-b',
      configurationId: 'dns-lab',
      topology: dnsTopologyNamed('lab-b'),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/labs/${labA.id}/destroy`,
      headers: adminHeader,
    });
    expect(res.statusCode).toBe(200);

    // A is destroyed, its server absent.
    expect(getLab(db, labA.id)!.lifecycleState).toBe('DESTROYED');
    expect(syncStateOf(labA.id, 'ns1')).toBe('NODE_ABSENT');

    // B is untouched.
    expect(getLab(db, labB.id)!.lifecycleState).toBe('NEVER_DEPLOYED');
    expect(syncStateOf(labB.id, 'ns1')).not.toBe('NODE_ABSENT');
    expect(syncStateOf(labB.id, 'ns1')).toBe('PENDING');
  });

  // Case 7 — success path shape and state transitions.
  it('destroy a deployed DNS lab -> 200, DESTROYED + lastDestroyedAt, servers NODE_ABSENT, {lab, servers} body', async () => {
    const adminToken = await loginAs('admin', 'admin');
    const adminHeader = { authorization: `Bearer ${adminToken}` };

    const lab = createLab(db, {
      name: 'mylab',
      configurationId: 'dns-lab',
      topology: dnsTopologyNamed('mylab'),
    });
    setLabLifecycle(db, lab.id, 'DEPLOYED');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/labs/${lab.id}/destroy`,
      headers: adminHeader,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.lab).toBeDefined();
    expect(body.lab.lifecycleState).toBe('DESTROYED');
    expect(body.lab.lastDestroyedAt).toBeDefined();
    expect(Array.isArray(body.servers)).toBe(true);
    expect(body.servers.some((s: any) => s.id === 'srv-' + lab.id + '-ns1')).toBe(true);

    expect(getLab(db, lab.id)!.lifecycleState).toBe('DESTROYED');
    expect(getLab(db, lab.id)!.lastDestroyedAt).toBeDefined();
    expect(syncStateOf(lab.id, 'ns1')).toBe('NODE_ABSENT');
  });
});
