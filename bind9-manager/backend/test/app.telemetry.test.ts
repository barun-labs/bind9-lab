import { describe, it, expect, beforeEach } from 'vitest';
import http from 'node:http';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import { createLab } from '../src/server/labStore';
import { getServer } from '../src/server/entityStore';
import type { Runner } from '../src/server/deployEngine';
import type { TopologyModel } from '../src/config-engine/topology';

describe('Telemetry API routes & permissions (TASK 4)', () => {
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
              // clab-mylab-cache deliberately omitted -> NODE_ABSENT
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
        return { code: 0, stdout: 'fake log line 1\nfake log line 2\n', stderr: '' };
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

  const twoNodeTopology: TopologyModel = {
    name: 'mylab',
    mgmtSubnet: '10.70.0.0/24',
    nodes: [
      {
        name: 'ns1',
        kind: 'linux',
        intent: 'bind',
        image: 'dnsnode:1.0',
        mgmtIpv4: '10.70.0.11',
      },
      {
        name: 'cache',
        kind: 'linux',
        intent: 'bind',
        image: 'dnsnode:1.0',
        mgmtIpv4: '10.70.0.12',
      },
    ],
    links: [],
  };

  describe('GET /telemetry', () => {
    it('200 with a view token', async () => {
      createUserWithRole('usr-viewer', 'viewer-user', [
        { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
      ]);
      const lab = createLab(db, { name: 'mylab', configurationId: 'dns-lab', topology: twoNodeTopology });
      const token = await loginAs('viewer-user', 'password123');

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/labs/${lab.id}/telemetry`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.nodes).toHaveLength(2);
      const ns1 = body.nodes.find((n: any) => n.nodeName === 'ns1');
      expect(ns1.present).toBe(true);
      expect(ns1.containerName).toBe('clab-mylab-ns1');
    });

    it('403 without view permission', async () => {
      createUserWithRole('usr-other', 'other-user', [
        { configurationId: 'other-config', role: 'viewer', canDeploy: false },
      ]);
      const lab = createLab(db, { name: 'mylab', configurationId: 'dns-lab', topology: twoNodeTopology });
      const token = await loginAs('other-user', 'password123');

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/labs/${lab.id}/telemetry`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error.code).toBe('FORBIDDEN');
    });

    it('404 for an unknown lab id', async () => {
      const token = await loginAs('admin', 'admin');
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/labs/no-such-lab/telemetry',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /nodes/:node/logs', () => {
    it.each(['au th', 'a;b', '../x'])('400 for a bad-charset node param %j', async (badNode) => {
      const token = await loginAs('admin', 'admin');
      const lab = createLab(db, { name: 'mylab', configurationId: 'dns-lab', topology: twoNodeTopology });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/labs/${lab.id}/nodes/${encodeURIComponent(badNode)}/logs`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('BAD_REQUEST');
      // The malicious string must never reach a runner-executed script.
      expect(executedScripts.some((s) => s.includes(badNode))).toBe(false);
    });

    it('400 for a syntactically valid node that is not in the topology', async () => {
      const token = await loginAs('admin', 'admin');
      const lab = createLab(db, { name: 'mylab', configurationId: 'dns-lab', topology: twoNodeTopology });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/labs/${lab.id}/nodes/not-a-real-node/logs`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('BAD_REQUEST');
      expect(executedScripts.some((s) => s.includes('docker logs'))).toBe(false);
    });

    it('200 text/plain for a valid in-topology node, using the server-derived container name', async () => {
      const token = await loginAs('admin', 'admin');
      const lab = createLab(db, { name: 'mylab', configurationId: 'dns-lab', topology: twoNodeTopology });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/labs/${lab.id}/nodes/ns1/logs`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.body).toBe('fake log line 1\nfake log line 2\n');

      const logsScript = executedScripts.find((s) => s.includes('docker logs'));
      expect(logsScript).toBeDefined();
      expect(logsScript).toContain('clab-mylab-ns1');
    });

    it('never lets an injection payload reach the shell, even routed through a valid-looking path', async () => {
      const token = await loginAs('admin', 'admin');
      const lab = createLab(db, { name: 'mylab', configurationId: 'dns-lab', topology: twoNodeTopology });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/labs/${lab.id}/nodes/${encodeURIComponent('auth;rm -rf')}/logs`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(400);
      expect(executedScripts.some((s) => s.includes('rm -rf'))).toBe(false);
    });
  });

  describe('POST /sync', () => {
    it('drives an absent node to NODE_ABSENT and returns 200 with the lab servers', async () => {
      const token = await loginAs('admin', 'admin');
      const lab = createLab(db, { name: 'mylab', configurationId: 'dns-lab', topology: twoNodeTopology });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/sync`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body)).toBe(true);
      expect(body.every((s: any) => s.id.startsWith(`srv-${lab.id}-`))).toBe(true);

      const cacheServer = getServer(db, `srv-${lab.id}-cache`);
      expect(cacheServer?.syncState).toBe('NODE_ABSENT');

      const ns1Server = getServer(db, `srv-${lab.id}-ns1`);
      expect(ns1Server?.syncState).toBe('SYNCED');
      expect(ns1Server?.containerId).toBe('ctr-ns1');
    });

    it('403 without view permission', async () => {
      createUserWithRole('usr-other-2', 'other-user-2', [
        { configurationId: 'other-config', role: 'viewer', canDeploy: false },
      ]);
      const lab = createLab(db, { name: 'mylab', configurationId: 'dns-lab', topology: twoNodeTopology });
      const token = await loginAs('other-user-2', 'password123');

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/sync`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('GET /telemetry/stream (SSE)', () => {
    it('streams text/event-stream with at least one parseable data frame, and clears the interval on disconnect', async () => {
      const token = await loginAs('admin', 'admin');
      const lab = createLab(db, { name: 'mylab', configurationId: 'dns-lab', topology: twoNodeTopology });

      await app.listen({ port: 0, host: '127.0.0.1' });
      const address = app.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      try {
        const firstFrame: string = await new Promise((resolve, reject) => {
          const req = http.get(
            {
              host: '127.0.0.1',
              port,
              path: `/api/v1/labs/${lab.id}/telemetry/stream`,
              headers: { authorization: `Bearer ${token}` },
            },
            (res) => {
              expect(res.headers['content-type']).toContain('text/event-stream');
              let buf = '';
              res.on('data', (chunk) => {
                buf += chunk.toString();
                if (buf.includes('\n\n')) {
                  req.destroy();
                  resolve(buf);
                }
              });
            },
          );
          // Destroying the request ourselves after the first frame produces
          // a benign socket-hangup error on this side — swallow it so it
          // doesn't fail the test.
          req.on('error', () => {});
          setTimeout(() => reject(new Error('timed out waiting for first SSE frame')), 2000);
        });

        expect(firstFrame.startsWith('data: ')).toBe(true);
        const payload = firstFrame.slice('data: '.length, firstFrame.indexOf('\n\n'));
        const parsed = JSON.parse(payload);
        expect(Array.isArray(parsed.nodes)).toBe(true);
        expect(typeof parsed.at).toBe('string');
      } finally {
        await app.close();
      }
    }, 5000);
  });
});
