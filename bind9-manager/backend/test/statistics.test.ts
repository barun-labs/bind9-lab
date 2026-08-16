import { describe, it, expect, beforeEach } from 'vitest';
import { parseNamedStats, statisticsSnapshot } from '../src/server/statistics';
import type { Runner } from '../src/server/deployEngine';
import type { Lab } from '../src/server/labStore';
import type { TopologyModel } from '../src/config-engine/topology';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import { createLab } from '../src/server/labStore';

// Verbatim dump captured from a live BIND 9.18 node.
const NAMED_STATS = [
  '+++ Statistics Dump +++ (1786848817)',
  '++ Incoming Requests ++',
  '                   4 QUERY',
  '++ Incoming Queries ++',
  '                   3 A',
  '                   1 AAAA',
  '++ Outgoing Rcodes ++',
  '                   2 NOERROR',
  '                   2 REFUSED',
  '++ Name Server Statistics ++',
  '                   4 IPv4 requests received',
  '                   2 recursive queries rejected',
  '                   4 responses sent',
  '++ Cache Statistics ++',
  '[View: main (Cache: main)]',
  '                   5 cache hits',
  '                   3 cache misses',
  '                   1 cache hits (from query)',
  '[View: _bind (Cache: _bind)]',
  '                   0 cache hits',
  '                   0 cache misses',
].join('\n');

const topology: TopologyModel = {
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

const lab: Lab = {
  id: 'lab-1',
  name: 'mylab',
  configurationId: 'dns-lab',
  topology,
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
};

describe('statistics.parseNamedStats', () => {
  it('extracts queries, rcodes, summed cache stats, and recursion count from a real dump', () => {
    const parsed = parseNamedStats(NAMED_STATS);

    expect(parsed.totalQueries).toBe(4);
    expect(parsed.responseCodes).toEqual({ NOERROR: 2, NXDOMAIN: 0, SERVFAIL: 0, REFUSED: 2 });
    expect(parsed.cacheHits).toBe(5);
    expect(parsed.cacheMisses).toBe(3);
    expect(parsed.cacheHitRatio).toBeCloseTo(5 / 8, 10);
    expect(parsed.recursionCount).toBe(2);
  });

  it('sums cache hits across views and never counts `cache hits (from query)`', () => {
    const parsed = parseNamedStats(NAMED_STATS);
    // main view contributes 5 hits, 3 misses; `1 cache hits (from query)` must
    // be excluded (hits stays 5, not 6), and _bind's 0/0 adds nothing.
    expect(parsed.cacheHits).toBe(5);
    expect(parsed.cacheMisses).toBe(3);
  });

  it('empty/garbage input leaves every field undefined and never throws', () => {
    expect(parseNamedStats('')).toEqual({});
    expect(parseNamedStats('not a stats dump\njust some words\n')).toEqual({});
    expect(() => parseNamedStats('{{{not json')).not.toThrow();
  });
});

describe('statistics.statisticsSnapshot', () => {
  it('returns one entry per bind node, present:true with parsed fields, from the server-derived container', async () => {
    const run: Runner = async (script: string) => {
      if (script.includes('docker exec')) {
        return { code: 0, stdout: NAMED_STATS, stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };

    const snap = await statisticsSnapshot(lab, run, '/home/lun/mylab');

    expect(snap.servers).toHaveLength(2);

    const ns1 = snap.servers.find((s) => s.nodeName === 'ns1');
    expect(ns1?.present).toBe(true);
    expect(ns1?.serverId).toBe('ns1');
    expect(ns1?.containerName).toBe('clab-mylab-ns1');
    expect(ns1?.totalQueries).toBe(4);
    expect(ns1?.cacheHitRatio).toBeCloseTo(5 / 8, 10);

    const cache = snap.servers.find((s) => s.nodeName === 'cache');
    expect(cache?.present).toBe(true);
    expect(cache?.containerName).toBe('clab-mylab-cache');

    expect(snap.runtimeError).toBeUndefined();
    expect(typeof snap.at).toBe('string');
  });

  it('targets only server-derived container names, shell-quoted — no request-driven target, no injection', async () => {
    const scripts: string[] = [];
    const run: Runner = async (script: string) => {
      scripts.push(script);
      return { code: 0, stdout: NAMED_STATS, stderr: '' };
    };

    // A topology whose node name carries shell metacharacters. The container
    // name is derived from it server-side, so the ONLY defense is shellQuote.
    const evilTopology: TopologyModel = {
      name: 'mylab',
      mgmtSubnet: '10.70.0.0/24',
      nodes: [{ name: "a; rm -rf /", kind: 'linux', intent: 'bind', image: 'dnsnode:1.0', mgmtIpv4: '10.70.0.11' }],
      links: [],
    };
    const evilLab: Lab = { ...lab, topology: evilTopology };

    await statisticsSnapshot(evilLab, run, '/home/lun/mylab');

    expect(scripts).toHaveLength(1);
    const script = scripts[0];
    // The metachars must be inside a single-quoted argument, never bare.
    expect(script).not.toMatch(/docker exec clab-mylab-a; rm/);
    expect(script).toContain("'clab-mylab-a; rm -rf /'");
    // The inner `sh -c '...'` payload is a constant — the container name is
    // never interpolated into it.
    expect(script).toContain("sh -c 'rndc stats");
  });

  it('a failed exec marks only that node present:false, other nodes unaffected, no throw', async () => {
    const run: Runner = async (script: string) => {
      if (script.includes('clab-mylab-cache')) {
        return { code: 1, stdout: '', stderr: 'no such container' };
      }
      if (script.includes('docker exec')) {
        return { code: 0, stdout: NAMED_STATS, stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };

    const snap = await statisticsSnapshot(lab, run, '/home/lun/mylab');

    expect(snap.servers).toHaveLength(2);

    const ns1 = snap.servers.find((s) => s.nodeName === 'ns1');
    expect(ns1?.present).toBe(true);
    expect(ns1?.totalQueries).toBe(4);

    const cache = snap.servers.find((s) => s.nodeName === 'cache');
    expect(cache?.present).toBe(false);
    expect(cache?.totalQueries).toBeUndefined();
    expect(cache?.containerName).toBe('clab-mylab-cache');
  });
});

describe('GET /api/v1/labs/:id/statistics route', () => {
  let db: Database.Database;
  let mockRunner: Runner;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = openDb(':memory:');
    mockRunner = async (script: string) => {
      if (script.includes('docker exec')) {
        return { code: 0, stdout: NAMED_STATS, stderr: '' };
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
    roles: Array<{ configurationId: string; role: 'viewer' | 'editor' | 'admin'; canDeploy: boolean }>
  ): void {
    const { salt, hash } = hashPassword('password123');
    db.prepare(`
      INSERT INTO users (id, username, displayName, isActive, roles, pwSalt, pwHash, createdAt)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?)
    `).run(userId, username, username, JSON.stringify(roles), salt, hash, new Date().toISOString());
  }

  it('200 with a view token on a DNS lab', async () => {
    createUserWithRole('usr-viewer', 'viewer-user', [
      { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
    ]);
    const l = createLab(db, { name: 'mylab', configurationId: 'dns-lab', topology });
    const token = await loginAs('viewer-user', 'password123');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/labs/${l.id}/statistics`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.servers).toHaveLength(2);
    const ns1 = body.servers.find((s: any) => s.nodeName === 'ns1');
    expect(ns1.present).toBe(true);
    expect(ns1.containerName).toBe('clab-mylab-ns1');
    expect(ns1.totalQueries).toBe(4);
    expect(typeof body.at).toBe('string');
  });

  it('404 for an unknown lab id', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/labs/no-such-lab/statistics',
      headers: { authorization: `Bearer ${token}` },
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
      method: 'GET',
      url: `/api/v1/labs/${l.id}/statistics`,
      headers: { authorization: `Bearer ${token}` },
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
      method: 'GET',
      url: `/api/v1/labs/${l.id}/statistics`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('NOT_A_DNS_LAB');
  });
});
