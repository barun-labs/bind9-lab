import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import { createLab } from '../src/server/labStore';
import { getServer } from '../src/server/entityStore';
import type { Runner } from '../src/server/deployEngine';
import type { TopologyModel } from '../src/config-engine/topology';

describe('Telemetry logs/sync adversarial (red-team)', () => {
  let db: Database.Database;
  let executedScripts: string[];
  let mockRunner: Runner;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = openDb(':memory:');
    executedScripts = [];
    mockRunner = async (script: string) => {
      executedScripts.push(script);
      if (script.includes('containerlab inspect')) {
        return {
          code: 0,
          stdout: JSON.stringify({
            mylab: [
              {
                name: 'clab-mylab-ns1',
                container_id: 'ctr-ns1',
                state: 'running',
                status: 'Up 1 minute',
                ipv4_address: '10.70.0.11/24',
              },
            ],
          }),
          stderr: '',
        };
      }
      if (script.includes('docker stats')) {
        return {
          code: 0,
          stdout: JSON.stringify({
            Name: 'clab-mylab-ns1',
            CPUPerc: '0.10%',
            MemPerc: '0.50%',
            MemUsage: '10MiB / 1.9GiB',
            NetIO: '1kB / 0B',
            BlockIO: '0B / 0B',
            PIDs: '5',
          }),
          stderr: '',
        };
      }
      if (script.includes('docker logs')) {
        return { code: 0, stdout: 'fake log line\n', stderr: '' };
      }
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
    return JSON.parse(res.body).token;
  }

  function createUserWithRole(
    userId: string,
    username: string,
    roles: Array<{ configurationId: string; role: 'viewer' | 'editor' | 'admin'; canDeploy: boolean }>,
  ): void {
    const { salt, hash } = hashPassword('password123');
    db.prepare(`
      INSERT INTO users (id, username, displayName, isActive, roles, pwSalt, pwHash, createdAt)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?)
    `).run(userId, username, username, JSON.stringify(roles), salt, hash, new Date().toISOString());
  }

  const twoNodeTopology: TopologyModel = {
    name: 'mylab',
    mgmtSubnet: '10.70.0.0/24',
    nodes: [
      { name: 'ns1', kind: 'linux', intent: 'bind', image: 'dnsnode:1.0', mgmtIpv4: '10.70.0.11' },
      { name: 'cache', kind: 'linux', intent: 'bind', image: 'dnsnode:1.0', mgmtIpv4: '10.70.0.12' },
    ],
    links: [],
  };

  function newLab(topo: TopologyModel = twoNodeTopology) {
    return createLab(db, { name: topo.name, configurationId: 'dns-lab', topology: topo });
  }

  describe('case 1: command injection in :node', () => {
    const payloads = [
      'auth;rm -rf /',
      'auth&&whoami',
      'auth|cat',
      '$(whoami)',
      '`id`',
      'auth ns2',
      'auth\nns2',
    ];

    it.each(payloads)('400 for %j, nothing reaches the runner', async (payload) => {
      const token = await loginAs('admin', 'admin');
      const lab = newLab();

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/labs/${lab.id}/nodes/${encodeURIComponent(payload)}/logs`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('BAD_REQUEST');
      // No executed script may contain the raw payload, nor any docker logs call.
      const leaked = executedScripts.some(
        (s) => s.includes(payload) || s.includes('docker logs'),
      );
      expect(leaked).toBe(false);
    });
  });

  describe('case 2: path traversal in :node', () => {
    const slashPayloads = ['../../etc/passwd', '..%2F..%2Fx'];

    it.each(slashPayloads)('400 for %j, no docker logs emitted', async (payload) => {
      const token = await loginAs('admin', 'admin');
      const lab = newLab();

      // For the raw traversal we send it encoded; for the literal ..%2F..%2Fx
      // form, send the string as-is (the router sees the %2F).
      const urlPath = payload.includes('%') ? payload : encodeURIComponent(payload);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/labs/${lab.id}/nodes/${urlPath}/logs`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(400);
      expect(executedScripts.some((s) => s.includes('docker logs'))).toBe(false);
    });

    it.each(['.', '..'])(
      'bare %j is normalized away by the router and never reaches the handler',
      async (payload) => {
        const token = await loginAs('admin', 'admin');
        const lab = newLab();

        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/labs/${lab.id}/nodes/${payload}/logs`,
          headers: { authorization: `Bearer ${token}` },
        });

        // A bare "." / ".." segment is resolved by the router (path
        // normalization) so the URL no longer matches the :node route —
        // 404, and the handler never ran, so nothing reached the runner.
        expect(res.statusCode).toBe(404);
        expect(executedScripts.some((s) => s.includes('docker logs'))).toBe(false);
      },
    );
  });

  describe('case 3: valid charset but not in topology', () => {
    it('400 Unknown node, no docker logs emitted', async () => {
      const token = await loginAs('admin', 'admin');
      const lab = newLab();

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/labs/${lab.id}/nodes/ns999/logs`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('BAD_REQUEST');
      expect(JSON.parse(res.body).error.message).toBe('Unknown node');
      expect(executedScripts.some((s) => s.includes('docker logs'))).toBe(false);
    });
  });

  describe('case 4: happy path still reachable', () => {
    it('200 text/plain, server-derived container name, shell-quoted', async () => {
      const token = await loginAs('admin', 'admin');
      const lab = newLab();

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/labs/${lab.id}/nodes/ns1/logs`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');

      const logsScript = executedScripts.find((s) => s.includes('docker logs'));
      expect(logsScript).toBeDefined();
      // Container name is derived server-side and single-quoted.
      expect(logsScript).toContain(`'clab-mylab-ns1'`);
      expect(logsScript).toContain(`docker logs --tail`);
    });
  });

  describe('case 5: tail clamp', () => {
    it.each([
      ['100000', 1000],
      ['-5', 1],
      ['abc', 200],
    ])('?tail=%s clamps to %d (or default)', async (tail, _expected) => {
      const token = await loginAs('admin', 'admin');
      const lab = newLab();

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/labs/${lab.id}/nodes/ns1/logs?tail=${tail}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);

      const logsScript = executedScripts.find((s) => s.includes('docker logs'));
      expect(logsScript).toBeDefined();
      const m = /--tail (\d+)/.exec(logsScript!);
      expect(m).not.toBeNull();
      const n = Number(m![1]);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(1000);
    });
  });

  describe('case 6: sync does not touch another lab', () => {
    it('reconciles only its own srv-<lab.id>-* rows', async () => {
      const token = await loginAs('admin', 'admin');
      const authHeader = { authorization: `Bearer ${token}` };

      const labA = newLab({
        name: 'labA',
        mgmtSubnet: '10.71.0.0/24',
        nodes: [{ name: 'ns1', kind: 'linux', intent: 'bind', image: 'dnsnode:1.0', mgmtIpv4: '10.71.0.11' }],
        links: [],
      });
      const labB = newLab({
        name: 'labB',
        mgmtSubnet: '10.72.0.0/24',
        nodes: [{ name: 'nsB', kind: 'linux', intent: 'bind', image: 'dnsnode:1.0', mgmtIpv4: '10.72.0.11' }],
        links: [],
      });

      const beforeB = getServer(db, `srv-${labB.id}-nsB`) as any;
      expect(beforeB.syncState).toBe('PENDING');
      expect(beforeB.containerId).toBeUndefined();

      // Runner whose inspect returns ONLY lab A's container.
      const crossRunner: Runner = async (script: string) => {
        executedScripts.push(script);
        if (script.includes('containerlab inspect')) {
          return {
            code: 0,
            stdout: JSON.stringify({
              labA: [
                {
                  name: 'clab-labA-ns1',
                  container_id: 'ctr-labA-ns1',
                  state: 'running',
                  status: 'Up 1 minute',
                  ipv4_address: '10.71.0.11/24',
                },
              ],
            }),
            stderr: '',
          };
        }
        return { code: 0, stdout: 'OK', stderr: '' };
      };
      const crossApp = buildApp(db, { runner: crossRunner });

      const res = await crossApp.inject({
        method: 'POST',
        url: `/api/v1/labs/${labA.id}/sync`,
        headers: authHeader,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body)).toBe(true);
      expect(body.every((s: any) => s.id.startsWith(`srv-${labA.id}-`))).toBe(true);

      // Lab A's node reconciled to SYNCED with the containerId.
      const afterA = getServer(db, `srv-${labA.id}-ns1`) as any;
      expect(afterA.syncState).toBe('SYNCED');
      expect(afterA.containerId).toBe('ctr-labA-ns1');

      // Lab B's Server rows must be completely unchanged.
      const afterB = getServer(db, `srv-${labB.id}-nsB`) as any;
      expect(afterB.syncState).toBe('PENDING');
      expect(afterB.containerId).toBeUndefined();
      expect(afterB.lastDeployedAt).toBeUndefined();
    });
  });

  describe('case 7: auth gate', () => {
    let lab: ReturnType<typeof createLab>;

    beforeEach(() => {
      createUserWithRole('usr-other', 'other-user', [
        { configurationId: 'other-config', role: 'viewer', canDeploy: false },
      ]);
      lab = newLab();
    });

    async function tokenForOther() {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: { username: 'other-user', password: 'password123' },
      });
      return JSON.parse(res.body).token;
    }

    it('logs, telemetry, sync: 403 for actor without view on the config', async () => {
      const token = await tokenForOther();
      const authHeader = { authorization: `Bearer ${token}` };

      const logsRes = await app.inject({
        method: 'GET',
        url: `/api/v1/labs/${lab.id}/nodes/ns1/logs`,
        headers: authHeader,
      });
      expect(logsRes.statusCode).toBe(403);

      const telRes = await app.inject({
        method: 'GET',
        url: `/api/v1/labs/${lab.id}/telemetry`,
        headers: authHeader,
      });
      expect(telRes.statusCode).toBe(403);

      const syncRes = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/sync`,
        headers: authHeader,
      });
      expect(syncRes.statusCode).toBe(403);

      // Nothing must have reached the runner.
      expect(executedScripts.length).toBe(0);
    });

    it('logs, telemetry, sync: 404 for unknown lab id', async () => {
      const token = await tokenForOther();
      const authHeader = { authorization: `Bearer ${token}` };

      const logsRes = await app.inject({
        method: 'GET',
        url: '/api/v1/labs/no-such-lab/nodes/ns1/logs',
        headers: authHeader,
      });
      expect(logsRes.statusCode).toBe(404);
      expect(JSON.parse(logsRes.body).error.code).toBe('NOT_FOUND');

      const telRes = await app.inject({
        method: 'GET',
        url: '/api/v1/labs/no-such-lab/telemetry',
        headers: authHeader,
      });
      expect(telRes.statusCode).toBe(404);

      const syncRes = await app.inject({
        method: 'POST',
        url: '/api/v1/labs/no-such-lab/sync',
        headers: authHeader,
      });
      expect(syncRes.statusCode).toBe(404);

      expect(executedScripts.length).toBe(0);
    });
  });
});
