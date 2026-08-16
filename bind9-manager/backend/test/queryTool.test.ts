import { describe, it, expect, beforeEach } from 'vitest';
import { validateQuery, runQuery, ALLOWED_QTYPES } from '../src/server/queryTool';
import type { Runner } from '../src/server/deployEngine';
import type { Lab } from '../src/server/labStore';
import type { TopologyModel } from '../src/config-engine/topology';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import { createLab } from '../src/server/labStore';

const topology: TopologyModel = {
  name: 'mylab',
  mgmtSubnet: '10.70.0.0/24',
  nodes: [
    { name: 'ns1', kind: 'linux', intent: 'bind', image: 'dnsnode:1.0', mgmtIpv4: '10.70.0.11' },
    { name: 'cache', kind: 'linux', intent: 'bind', image: 'dnsnode:1.0', mgmtIpv4: '10.70.0.12' },
  ],
  links: [],
};

const lab: Lab = {
  id: 'lab-1',
  name: 'mylab',
  configurationId: 'dns-lab',
  topology,
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
};

const BIND_NODES = ['ns1', 'cache'];

describe('queryTool.validateQuery', () => {
  it('accepts valid input and defaults the qtype to A', () => {
    const v = validateQuery({ node: 'ns1', qname: 'example.com' }, BIND_NODES);
    expect(v.ok).toBe(true);
    expect(v.qtype).toBe('A');
  });

  it('upper-cases a provided qtype and accepts an optional server', () => {
    const v = validateQuery(
      { node: 'cache', qname: 'example.com', qtype: 'aaaa', server: '2001:db8::1' },
      BIND_NODES
    );
    expect(v.ok).toBe(true);
    expect(v.qtype).toBe('AAAA');
  });

  it('rejects a qname with shell metacharacters or empty labels as INVALID_NAME', () => {
    const evilNames = [
      'ex;ample.com',
      'exa mple.com',
      '$(rm -rf /)',
      '`id`',
      '..',
      'exa\nmple.com',
    ];
    for (const qname of evilNames) {
      const v = validateQuery({ node: 'ns1', qname }, BIND_NODES);
      expect(v.ok, `qname ${JSON.stringify(qname)} should fail`).toBe(false);
      expect(v.code).toBe('INVALID_NAME');
    }
  });

  it('rejects an over-long qname as INVALID_NAME', () => {
    const qname = 'a'.repeat(250) + '.com';
    expect(qname.length).toBeGreaterThan(253);
    const v = validateQuery({ node: 'ns1', qname }, BIND_NODES);
    expect(v.ok).toBe(false);
    expect(v.code).toBe('INVALID_NAME');
  });

  it('rejects a qtype outside the allow-list as INVALID_TYPE', () => {
    const v = validateQuery({ node: 'ns1', qname: 'example.com', qtype: 'FOO' }, BIND_NODES);
    expect(v.ok).toBe(false);
    expect(v.code).toBe('INVALID_TYPE');
  });

  it('rejects a node that is not a bind node in this lab as INVALID_NODE', () => {
    const v = validateQuery({ node: 'ns-evil', qname: 'example.com' }, BIND_NODES);
    expect(v.ok).toBe(false);
    expect(v.code).toBe('INVALID_NODE');
  });

  it('rejects a bad server target as INVALID_SERVER', () => {
    const v = validateQuery(
      { node: 'ns1', qname: 'example.com', server: '1.2.3.4; echo pwned' },
      BIND_NODES
    );
    expect(v.ok).toBe(false);
    expect(v.code).toBe('INVALID_SERVER');
  });

  it('exposes the full allow-list of qtypes', () => {
    expect(ALLOWED_QTYPES).toContain('ANY');
    expect(ALLOWED_QTYPES).toContain('A');
    expect(ALLOWED_QTYPES).toContain('CAA');
  });
});

describe('queryTool.runQuery', () => {
  it('targets the server-derived container and keeps dig +time=3 +tries=1', async () => {
    const scripts: string[] = [];
    const run: Runner = async (script: string) => {
      scripts.push(script);
      return { code: 0, stdout: ';; ANSWER SECTION:\nexample.com. 300 IN A 1.2.3.4\n', stderr: '' };
    };

    const result = await runQuery(lab, run, { node: 'ns1', qname: 'example.com', qtype: 'A' });

    expect(scripts).toHaveLength(1);
    const script = scripts[0];
    expect(script).toContain("'clab-mylab-ns1'");
    expect(script).toContain('+time=3 +tries=1');
    expect(script).toContain("'A'");
    expect(script).toContain("'example.com'");

    expect(result.containerName).toBe('clab-mylab-ns1');
    expect(result.node).toBe('ns1');
    expect(result.qtype).toBe('A');
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('ANSWER SECTION');
  });

  it('single-quotes a malicious qname/server even if it bypasses validation', async () => {
    const scripts: string[] = [];
    const run: Runner = async (script: string) => {
      scripts.push(script);
      return { code: 0, stdout: '', stderr: '' };
    };

    const evilQname = 'example.com; rm -rf /';
    const evilServer = '8.8.8.8; touch /tmp/pwned';

    await runQuery(lab, run, { node: 'ns1', qname: evilQname, qtype: 'A', server: evilServer });

    const script = scripts[0];
    // The metacharacters must be wrapped inside a single-quoted argument, never bare.
    expect(script).toContain("'example.com; rm -rf /'");
    expect(script).toContain("@'8.8.8.8; touch /tmp/pwned'");
    expect(script).not.toMatch(/example\.com; rm -rf \/ /);
  });
});

describe('POST /api/v1/labs/:id/query route', () => {
  let db: Database.Database;
  let mockRunner: Runner;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = openDb(':memory:');
    mockRunner = async (_script: string) => ({
      code: 0,
      stdout: ';; ->>HEADER<<- opcode: QUERY, status: NOERROR\n',
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

  it('200 with a valid query — container derived server-side, dig output returned', async () => {
    createUserWithRole('usr-viewer', 'viewer-user', [
      { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
    ]);
    const l = createLab(db, { name: 'mylab', configurationId: 'dns-lab', topology });
    const token = await loginAs('viewer-user', 'password123');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/labs/${l.id}/query`,
      headers: { authorization: `Bearer ${token}` },
      payload: { node: 'ns1', qname: 'example.com', qtype: 'a', server: '8.8.8.8' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.node).toBe('ns1');
    expect(body.containerName).toBe('clab-mylab-ns1');
    expect(body.qtype).toBe('A');
    expect(body.server).toBe('8.8.8.8');
    expect(body.exitCode).toBe(0);
    expect(body.output).toContain('HEADER');
  });

  it('404 for an unknown lab id', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/labs/no-such-lab/query',
      headers: { authorization: `Bearer ${token}` },
      payload: { node: 'ns1', qname: 'example.com' },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND');
  });

  it('403 without view permission', async () => {
    createUserWithRole('usr-other', 'other-user', [
      { configurationId: 'other-config', role: 'viewer', canDeploy: false },
    ]);
    const l = createLab(db, { name: 'mylab', configurationId: 'dns-lab', topology });
    const token = await loginAs('other-user', 'password123');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/labs/${l.id}/query`,
      headers: { authorization: `Bearer ${token}` },
      payload: { node: 'ns1', qname: 'example.com' },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('FORBIDDEN');
  });

  it('422 for a non-DNS lab', async () => {
    const nonDnsTopology: TopologyModel = {
      name: 'notdns',
      mgmtSubnet: '10.70.0.0/24',
      nodes: [{ name: 'r1', kind: 'linux', intent: 'router', image: 'router:1.0', mgmtIpv4: '10.70.0.11' }],
      links: [],
    };
    createUserWithRole('usr-dns', 'dns-user', [
      { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
    ]);
    const l = createLab(db, { name: 'notdns', configurationId: 'dns-lab', topology: nonDnsTopology });
    const token = await loginAs('dns-user', 'password123');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/labs/${l.id}/query`,
      headers: { authorization: `Bearer ${token}` },
      payload: { node: 'r1', qname: 'example.com' },
    });

    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('NOT_A_DNS_LAB');
  });

  it('422 for each invalid field', async () => {
    createUserWithRole('usr-viewer', 'viewer-user', [
      { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
    ]);
    const l = createLab(db, { name: 'mylab', configurationId: 'dns-lab', topology });
    const token = await loginAs('viewer-user', 'password123');
    const headers = { authorization: `Bearer ${token}` };

    const cases: Array<{ payload: Record<string, unknown>; code: string }> = [
      { payload: { node: 'ns-evil', qname: 'example.com' }, code: 'INVALID_NODE' },
      { payload: { node: 'ns1', qname: 'bad;name' }, code: 'INVALID_NAME' },
      { payload: { node: 'ns1', qname: 'example.com', qtype: 'FOO' }, code: 'INVALID_TYPE' },
      { payload: { node: 'ns1', qname: 'example.com', server: '1.2.3.4; echo pwned' }, code: 'INVALID_SERVER' },
    ];

    for (const { payload, code } of cases) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${l.id}/query`,
        headers,
        payload,
      });
      expect(res.statusCode, `payload ${JSON.stringify(payload)}`).toBe(422);
      expect(JSON.parse(res.body).error.code).toBe(code);
    }
  });
});
