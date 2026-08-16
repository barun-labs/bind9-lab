import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import { createLab } from '../src/server/labStore';
import type { Lab } from '../src/server/labStore';
import { runQuery } from '../src/server/queryTool';
import type { Runner } from '../src/server/deployEngine';
import type { TopologyModel } from '../src/config-engine/topology';

// Red-team suite. Independent of queryTool.test.ts. Do not trust the code under test.
// Every body field ends up in a `docker exec ... dig ...` command, so we capture the
// exact command the runner received and assert no dangerous value reaches it bare.

describe('query tool adversarial (red-team)', () => {
  let db: Database.Database;
  let executedScripts: string[];
  let mockRunner: Runner;
  let app: ReturnType<typeof buildApp>;

  const FAKE_DIG = ';; ->>HEADER<<- opcode: QUERY, status: NOERROR\n;; ANSWER SECTION:\nexample.com. 300 IN A 1.2.3.4\n';

  beforeEach(() => {
    db = openDb(':memory:');
    executedScripts = [];
    mockRunner = async (script: string) => {
      executedScripts.push(script);
      if (script.includes(' dig ')) {
        return { code: 0, stdout: FAKE_DIG, stderr: '' };
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

  // One bind node (ns1) + one non-bind node (router) in the SAME lab, so a body
  // can try to spoof `router` and still be inside the lab's node set.
  const mixedTopology: TopologyModel = {
    name: 'mylab',
    mgmtSubnet: '10.70.0.0/24',
    nodes: [
      { name: 'ns1', kind: 'linux', intent: 'bind', image: 'dnsnode:1.0', mgmtIpv4: '10.70.0.11' },
      { name: 'router', kind: 'linux', intent: 'router', image: 'router:1.0', mgmtIpv4: '10.70.0.20' },
    ],
    links: [],
  };

  function newLab(topo: TopologyModel = mixedTopology) {
    return createLab(db, { name: topo.name, configurationId: 'dns-lab', topology: topo });
  }

  async function postQuery(token: string, labId: string, payload: unknown) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/labs/${labId}/query`,
      headers: { authorization: `Bearer ${token}` },
      payload: payload as Record<string, unknown>,
    });
  }

  describe('case 1: qname injection', () => {
    const payloads = [
      'x;reboot',
      'x$(id)',
      'x`id`',
      'x|nc evil 1',
      'x&&rm',
      'x ns2',
      'x\nrm',
      '-x',
      '../etc',
      'a..b',
      '.leadingdot',
      'a'.repeat(300),
    ];

    it.each(payloads)('422 INVALID_NAME, no command reaches the runner for %j', async (qname) => {
      const token = await loginAs('admin', 'admin');
      const lab = newLab();

      const res = await postQuery(token, lab.id, { node: 'ns1', qname });

      expect(res.statusCode, `qname ${JSON.stringify(qname)}`).toBe(422);
      expect(JSON.parse(res.body).error.code).toBe('INVALID_NAME');
      expect(executedScripts.length).toBe(0);
    });
  });

  describe('case 2: qtype injection', () => {
    const payloads = ['A;id', 'A ANY', '-c', '`id`', 'ANY;rm'];

    it.each(payloads)('422 INVALID_TYPE, nothing runs for %j', async (qtype) => {
      const token = await loginAs('admin', 'admin');
      const lab = newLab();

      const res = await postQuery(token, lab.id, { node: 'ns1', qname: 'example.com', qtype });

      expect(res.statusCode).toBe(422);
      expect(JSON.parse(res.body).error.code).toBe('INVALID_TYPE');
      expect(executedScripts.length).toBe(0);
    });
  });

  describe('case 3: node spoofing', () => {
    const payloads = ['router', '../../etc', 'clab-otherlab-ns1', 'ns1; rm', ''];

    it.each(payloads)('422 INVALID_NODE, nothing runs for %j', async (node) => {
      const token = await loginAs('admin', 'admin');
      const lab = newLab();

      const res = await postQuery(token, lab.id, { node, qname: 'example.com' });

      expect(res.statusCode).toBe(422);
      expect(JSON.parse(res.body).error.code).toBe('INVALID_NODE');
      expect(executedScripts.length).toBe(0);
    });

    it('valid node is always targeted as clab-<topo>-<node>, never a body-supplied container', async () => {
      const token = await loginAs('admin', 'admin');
      const lab = newLab();

      const res = await postQuery(token, lab.id, { node: 'ns1', qname: 'example.com' });

      expect(res.statusCode).toBe(200);
      const script = executedScripts.find((s) => s.includes(' dig '));
      expect(script).toBeDefined();
      expect(script).toContain("'clab-mylab-ns1'");
      expect(script).not.toContain("'clab-mylab-router'");
      expect(JSON.parse(res.body).containerName).toBe('clab-mylab-ns1');
    });
  });

  describe('case 4: server injection', () => {
    const bad = ['1.2.3.4;rm', '$(id)', '1.2.3.4 -p', 'evil.com', '1.2.3.4|x'];

    it.each(bad)('422 INVALID_SERVER, nothing runs for %j', async (server) => {
      const token = await loginAs('admin', 'admin');
      const lab = newLab();

      const res = await postQuery(token, lab.id, { node: 'ns1', qname: 'example.com', server });

      expect(res.statusCode).toBe(422);
      expect(JSON.parse(res.body).error.code).toBe('INVALID_SERVER');
      expect(executedScripts.length).toBe(0);
    });

    it.each(['1.2.3.4', '2001:db8::1'])('valid server %j is allowed', async (server) => {
      const token = await loginAs('admin', 'admin');
      const lab = newLab();

      const res = await postQuery(token, lab.id, { node: 'ns1', qname: 'example.com', server });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).server).toBe(server);
    });
  });

  describe('case 5: defense-in-depth on runQuery directly', () => {
    it('shellQuote contains every dangerous value past validation', async () => {
      const lab: Lab = newLab();
      const scripts: string[] = [];
      const capturingRunner: Runner = async (script: string) => {
        scripts.push(script);
        return { code: 0, stdout: '', stderr: '' };
      };

      await runQuery(lab, capturingRunner, {
        node: 'ns1',
        qname: 'a;rm -rf /',
        qtype: 'A;x',
        server: '1.2.3.4;rm',
      });

      expect(scripts).toHaveLength(1);
      const script = scripts[0];

      // Container is derived server-side from the lab topology, not the body.
      expect(script).toContain("'clab-mylab-ns1'");
      expect(script).toContain('+time=3 +tries=1');

      // Each dangerous value appears ONLY inside a single-quoted argument.
      expect(script).toContain("'a;rm -rf /'");
      expect(script).toContain("'A;X'");
      expect(script).toContain("@'1.2.3.4;rm'");

      // And never bare: the shell must never see the metacharacters unquoted.
      expect(script).not.toMatch(/ a;rm -rf \/ /);
      expect(script).not.toMatch(/ A;X /);
      expect(script).not.toMatch(/@1\.2\.3\.4;rm/);
    });
  });

  describe('case 6: route guards', () => {
    it('404 for an unknown lab id', async () => {
      const token = await loginAs('admin', 'admin');
      const res = await postQuery(token, 'no-such-lab', { node: 'ns1', qname: 'example.com' });

      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND');
      expect(executedScripts.length).toBe(0);
    });

    it('403 for an actor without view on the lab config', async () => {
      createUserWithRole('usr-other', 'other-user', [
        { configurationId: 'other-config', role: 'viewer', canDeploy: false },
      ]);
      const lab = newLab();
      const token = await loginAs('other-user', 'password123');

      const res = await postQuery(token, lab.id, { node: 'ns1', qname: 'example.com' });

      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error.code).toBe('FORBIDDEN');
      expect(executedScripts.length).toBe(0);
    });

    it('422 NOT_A_DNS_LAB for a lab with no bind node', async () => {
      const nonDns: TopologyModel = {
        name: 'notdns',
        mgmtSubnet: '10.70.0.0/24',
        nodes: [{ name: 'r1', kind: 'linux', intent: 'router', image: 'router:1.0', mgmtIpv4: '10.70.0.11' }],
        links: [],
      };
      createUserWithRole('usr-dns', 'dns-user', [
        { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
      ]);
      const lab = newLab(nonDns);
      const token = await loginAs('dns-user', 'password123');

      const res = await postQuery(token, lab.id, { node: 'r1', qname: 'example.com' });

      expect(res.statusCode).toBe(422);
      expect(JSON.parse(res.body).error.code).toBe('NOT_A_DNS_LAB');
      expect(executedScripts.length).toBe(0);
    });

    it('200 for a valid query — dig output and exitCode echoed', async () => {
      const token = await loginAs('admin', 'admin');
      const lab = newLab();

      const res = await postQuery(token, lab.id, { node: 'ns1', qname: 'example.com' });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.containerName).toBe('clab-mylab-ns1');
      expect(body.exitCode).toBe(0);
      expect(body.output).toContain('ANSWER SECTION');
    });
  });

  describe('case 7: auth', () => {
    it('a view-only actor CAN query (query is a read)', async () => {
      createUserWithRole('usr-viewer', 'viewer-user', [
        { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
      ]);
      const lab = newLab();
      const token = await loginAs('viewer-user', 'password123');

      const res = await postQuery(token, lab.id, { node: 'ns1', qname: 'example.com' });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).exitCode).toBe(0);
    });

    it('no token -> 401, nothing runs', async () => {
      const lab = newLab();

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/query`,
        payload: { node: 'ns1', qname: 'example.com' },
      });

      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).error.code).toBe('UNAUTHORIZED');
      expect(executedScripts.length).toBe(0);
    });
  });
});
