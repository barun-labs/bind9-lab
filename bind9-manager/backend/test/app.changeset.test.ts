import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import { createLab } from '../src/server/labStore';
import { buildConfigModel, createDeploymentOption, createDeploymentRole } from '../src/server/entityStore';
import { getBaselineModel, setBaselineModel } from '../src/server/changeSetStore';
import type { Runner } from '../src/server/deployEngine';
import type { TopologyModel } from '../src/config-engine/topology';

describe('change-set review & deploy API', () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;
  let runnerResult: { code: number; stdout: string; stderr: string };
  let failPush = false;
  let mockRunner: Runner;
  let scripts: string[] = [];
  let inspectOutput = 'ns1|mylab';

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
      { name: 'r1', kind: 'linux', intent: 'router', image: 'dnsnode:1.0', mgmtIpv4: '10.71.0.1' },
    ],
    links: [],
  };

  beforeEach(() => {
    db = openDb(':memory:');
    runnerResult = { code: 0, stdout: '', stderr: '' };
    failPush = false;
    scripts = [];
    inspectOutput = 'ns1|mylab';
    mockRunner = async (script) => {
      scripts.push(script);
      if (script.includes('docker inspect')) {
        return { code: 0, stdout: inspectOutput, stderr: '' };
      }
      if (failPush && script.includes('rndc reconfig')) {
        return { code: 1, stdout: '', stderr: 'rndc reload failed' };
      }
      return runnerResult;
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

  function dnsLabId(): string {
    return createLab(db, { name: 'mylab', configurationId: 'dns-lab', topology: dnsTopology }).id;
  }

  it('GET change-set: 403 without view permission, 200 with items+groups otherwise', async () => {
    createUserWithRole('usr-other', 'other-user', [
      { configurationId: 'other-config', role: 'admin', canDeploy: true },
    ]);
    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/change-set',
      headers: { authorization: `Bearer ${await loginAs('other-user', 'password123')}` },
    });
    expect(denied.statusCode).toBe(403);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/change-set',
      headers: { authorization: `Bearer ${await loginAs('admin', 'admin')}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((i: any) => i.configurationId === 'dns-lab')).toBe(true);
    expect(Array.isArray(body.groups)).toBe(true);
    expect(body.groups.every((g: any) => g.groupKey && g.objectType && Array.isArray(g.items))).toBe(true);
  });

  it('GET change-set returns empty items once the baseline matches the live model', async () => {
    const token = await loginAs('admin', 'admin');
    const header = { authorization: `Bearer ${token}` };

    const model = buildConfigModel(db, 'dns-lab');
    setBaselineModel(db, 'dns-lab', model);
    expect(getBaselineModel(db, 'dns-lab')).not.toBeNull();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/change-set',
      headers: header,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).items).toEqual([]);
  });

  it('GET change-set/diff renders unified and split views', async () => {
    const token = await loginAs('admin', 'admin');
    const header = { authorization: `Bearer ${token}` };

    const unified = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/change-set/diff?mode=unified',
      headers: header,
    });
    expect(unified.statusCode).toBe(200);
    const u = JSON.parse(unified.body);
    expect(u.mode).toBe('unified');
    expect(Array.isArray(u.diff)).toBe(true);
    expect(u.diff.every((l: any) => typeof l.kind === 'string' && typeof l.text === 'string')).toBe(true);

    const split = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/change-set/diff?mode=split',
      headers: header,
    });
    expect(split.statusCode).toBe(200);
    const s = JSON.parse(split.body);
    expect(s.mode).toBe('split');
    expect(Array.isArray(s.diff.left)).toBe(true);
    expect(Array.isArray(s.diff.right)).toBe(true);
  });

  it('GET rendered-config: 200 with per-server text, 403 without view, 404 for unknown config', async () => {
    createUserWithRole('usr-other', 'other-user', [
      { configurationId: 'other-config', role: 'admin', canDeploy: true },
    ]);
    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/rendered-config',
      headers: { authorization: `Bearer ${await loginAs('other-user', 'password123')}` },
    });
    expect(denied.statusCode).toBe(403);

    const header = { authorization: `Bearer ${await loginAs('admin', 'admin')}` };
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/rendered-config',
      headers: header,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    for (const el of body.data) {
      expect(typeof el.serverId).toBe('string');
      expect(typeof el.hostname).toBe('string');
      expect(typeof el.text).toBe('string');
      expect(el.text).toContain('# ----');
    }

    createUserWithRole('usr-ghost', 'ghost-user', [
      { configurationId: 'ghost-config', role: 'admin', canDeploy: true },
    ]);
    const missing = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/ghost-config/rendered-config',
      headers: { authorization: `Bearer ${await loginAs('ghost-user', 'password123')}` },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('POST deploy-jobs: preflight OK + push OK -> 201, job SUCCEEDED, baseline replaced (change set cleared)', async () => {
    const token = await loginAs('admin', 'admin');
    const header = { authorization: `Bearer ${token}` };
    const labId = dnsLabId();
    const serverId = `srv-${labId}-ns1`;

    // An option + role edit must surface as pending OPTION/ROLE items, then
    // clear from the change set once the deploy succeeds (baseline replaced).
    createDeploymentOption(db, 'dns-lab', { scope: 'VIEW', scopeId: 'view-internal', key: 'recursion', value: false });
    createDeploymentRole(db, 'dns-lab', { scope: 'ZONE', scopeId: 'zone-lab', serverId, role: 'PRIMARY' });

    const pendingRes = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/change-set',
      headers: header,
    });
    const pendingItems = JSON.parse(pendingRes.body).items;
    expect(pendingItems.filter((i: any) => i.objectType === 'OPTION')).toHaveLength(1);
    expect(pendingItems.filter((i: any) => i.objectType === 'ROLE')).toHaveLength(1);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/deploy-jobs',
      headers: header,
      payload: { targetServerIds: [serverId] },
    });
    expect(res.statusCode).toBe(201);
    const { jobId } = JSON.parse(res.body);
    expect(jobId.startsWith('csdj-')).toBe(true);

    const jobRes = await app.inject({
      method: 'GET',
      url: `/api/v1/configurations/dns-lab/deploy-jobs/${jobId}`,
      headers: header,
    });
    expect(jobRes.statusCode).toBe(200);
    const job = JSON.parse(jobRes.body);
    expect(job.status).toBe('SUCCEEDED');
    expect(job.serverResults).toHaveLength(1);
    expect(job.serverResults[0]).toMatchObject({ serverId, outcome: 'SUCCEEDED' });

    // Full success replaced the baseline, so the change set is now empty.
    const cleared = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/change-set',
      headers: header,
    });
    expect(JSON.parse(cleared.body).items).toEqual([]);
  });

  it('POST deploy-jobs: preflight FAIL -> 422 PREFLIGHT_FAILED and no job is created', async () => {
    const token = await loginAs('admin', 'admin');
    const header = { authorization: `Bearer ${token}` };
    const labId = dnsLabId();
    const serverId = `srv-${labId}-ns1`;
    runnerResult = { code: 1, stdout: '', stderr: 'syntax error near options' };

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/deploy-jobs',
      headers: header,
      payload: { targetServerIds: [serverId] },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('PREFLIGHT_FAILED');
  });

  it('POST deploy-jobs: preflight WARN without ack -> 422, with ack -> 201', async () => {
    const token = await loginAs('admin', 'admin');
    const header = { authorization: `Bearer ${token}` };
    const labId = dnsLabId();
    const serverId = `srv-${labId}-ns1`;
    runnerResult = { code: 0, stdout: '', stderr: 'warning: unset options block' };

    const unacked = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/deploy-jobs',
      headers: header,
      payload: { targetServerIds: [serverId] },
    });
    expect(unacked.statusCode).toBe(422);
    expect(JSON.parse(unacked.body).error.code).toBe('PREFLIGHT_WARNING_UNACK');

    const acked = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/deploy-jobs',
      headers: header,
      payload: { targetServerIds: [serverId], warningAck: true },
    });
    expect(acked.statusCode).toBe(201);
  });

  it('POST deploy-jobs: config with no lab -> 422 NO_LAB_FOR_CONFIG', async () => {
    createUserWithRole('usr-clean', 'clean-admin', [
      { configurationId: 'clean-fwd', role: 'admin', canDeploy: true },
    ]);
    const token = await loginAs('clean-admin', 'password123');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/clean-fwd/deploy-jobs',
      headers: { authorization: `Bearer ${token}` },
      payload: { targetServerIds: ['srv-x'] },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('NO_LAB_FOR_CONFIG');
  });

  it('POST deploy-jobs: non-DNS lab -> 422 NOT_A_DNS_LAB', async () => {
    const token = await loginAs('admin', 'admin');
    createLab(db, { name: 'routerlab', configurationId: 'dns-lab', topology: nonDnsTopology });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/deploy-jobs',
      headers: { authorization: `Bearer ${token}` },
      payload: { targetServerIds: ['srv-x'] },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('NOT_A_DNS_LAB');
  });

  it('GET deploy-jobs/:jobId returns 404 on configurationId mismatch', async () => {
    const adminToken = await loginAs('admin', 'admin');
    const labId = dnsLabId();
    const serverId = `srv-${labId}-ns1`;

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/deploy-jobs',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { targetServerIds: [serverId] },
    });
    const { jobId } = JSON.parse(created.body);

    // Actor with view on the OTHER config passes authorize, then the job's
    // configurationId no longer matches the URL configId -> 404.
    createUserWithRole('usr-split', 'split-viewer', [
      { configurationId: 'split-horizon', role: 'viewer', canDeploy: false },
    ]);
    const splitToken = await loginAs('split-viewer', 'password123');

    const wrong = await app.inject({
      method: 'GET',
      url: `/api/v1/configurations/split-horizon/deploy-jobs/${jobId}`,
      headers: { authorization: `Bearer ${splitToken}` },
    });
    expect(wrong.statusCode).toBe(404);
  });

  it('POST deploy-jobs/:jobId/retry: failed push then successful retry replaces the baseline', async () => {
    const token = await loginAs('admin', 'admin');
    const header = { authorization: `Bearer ${token}` };
    const labId = dnsLabId();
    const serverId = `srv-${labId}-ns1`;

    // Preflight passes (validate script has no "rndc reconfig"), push fails.
    failPush = true;

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/deploy-jobs',
      headers: header,
      payload: { targetServerIds: [serverId] },
    });
    expect(first.statusCode).toBe(201);
    const firstJobId = JSON.parse(first.body).jobId;

    const failedJob = JSON.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/configurations/dns-lab/deploy-jobs/${firstJobId}`,
          headers: header,
        })
      ).body
    );
    expect(failedJob.status).toBe('FAILED');
    expect(failedJob.serverResults[0].outcome).toBe('FAILED');

    // Baseline must NOT have been replaced on failure.
    const pending = JSON.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/configurations/dns-lab/change-set',
          headers: header,
        })
      ).body
    );
    expect(pending.items.length).toBeGreaterThan(0);

    // Now the push succeeds.
    failPush = false;

    const retry = await app.inject({
      method: 'POST',
      url: `/api/v1/configurations/dns-lab/deploy-jobs/${firstJobId}/retry`,
      headers: header,
      payload: {},
    });
    expect(retry.statusCode).toBe(201);
    const retryJobId = JSON.parse(retry.body).jobId;

    const retryJob = JSON.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/configurations/dns-lab/deploy-jobs/${retryJobId}`,
          headers: header,
        })
      ).body
    );
    expect(retryJob.status).toBe('SUCCEEDED');
    expect(retryJob.targetServerIds).toEqual([serverId]);

    const cleared = JSON.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/configurations/dns-lab/change-set',
          headers: header,
        })
      ).body
    );
    expect(cleared.items).toEqual([]);
  });

  it('POST deploy-jobs: a target id that is not a real server -> 422 UNKNOWN_SERVER, no push script runs', async () => {
    const token = await loginAs('admin', 'admin');
    dnsLabId();
    // A path-traversal id must never reach the push script. shellQuote would not
    // stop '../', so the route's allowlist is the control that blocks it.
    const evil = '../../../../tmp/pwn';

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/deploy-jobs',
      headers: { authorization: `Bearer ${token}` },
      payload: { targetServerIds: [evil] },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('UNKNOWN_SERVER');
    // Must-fail control: if the allowlist were removed, the push script would
    // contain the traversal path. Prove no runner script referenced it.
    expect(scripts.some((s) => s.includes('/tmp/pwn'))).toBe(false);
    // Baseline untouched, so the change set is still pending.
    const pending = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/change-set',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(JSON.parse(pending.body).items.length).toBeGreaterThan(0);
  });

  it('POST deploy-jobs/:jobId/retry: an unknown body.serverId -> 422 UNKNOWN_SERVER', async () => {
    const token = await loginAs('admin', 'admin');
    const header = { authorization: `Bearer ${token}` };
    const labId = dnsLabId();
    const serverId = `srv-${labId}-ns1`;

    // Make a real failed job first so the retry route reaches its target logic.
    failPush = true;
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/deploy-jobs',
      headers: header,
      payload: { targetServerIds: [serverId] },
    });
    const firstJobId = JSON.parse(first.body).jobId;
    failPush = false;

    const retry = await app.inject({
      method: 'POST',
      url: `/api/v1/configurations/dns-lab/deploy-jobs/${firstJobId}/retry`,
      headers: header,
      payload: { serverId: '../../etc/cron.d/x' },
    });
    expect(retry.statusCode).toBe(422);
    expect(JSON.parse(retry.body).error.code).toBe('UNKNOWN_SERVER');
  });

  it('POST deploy-jobs requires deploy permission -> 403 for a viewer', async () => {
    createUserWithRole('usr-viewer', 'viewer-user', [
      { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
    ]);
    const labId = dnsLabId();
    const token = await loginAs('viewer-user', 'password123');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/deploy-jobs',
      headers: { authorization: `Bearer ${token}` },
      payload: { targetServerIds: [`srv-${labId}-ns1`] },
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST deploy-jobs: a mismatched container label aborts the push (TARGET_UNTRUSTED, no rndc)', async () => {
    const token = await loginAs('admin', 'admin');
    const header = { authorization: `Bearer ${token}` };
    const labId = dnsLabId();
    const serverId = `srv-${labId}-ns1`;
    inspectOutput = 'other-node|mylab';

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/deploy-jobs',
      headers: header,
      payload: { targetServerIds: [serverId] },
    });
    expect(res.statusCode).toBe(201);
    const { jobId } = JSON.parse(res.body);

    const jobRes = await app.inject({
      method: 'GET',
      url: `/api/v1/configurations/dns-lab/deploy-jobs/${jobId}`,
      headers: header,
    });
    const job = JSON.parse(jobRes.body);
    expect(job.status).toBe('FAILED');
    expect(job.serverResults[0]).toMatchObject({
      serverId,
      outcome: 'FAILED',
      trust: 'TARGET_UNTRUSTED',
    });
    // Must-fail control: the push script (rndc) must never have run.
    expect(scripts.some((s) => s.includes('rndc reconfig'))).toBe(false);
  });

  it('POST deploy-jobs: matching label signs the push and ships .manager-manifest.json', async () => {
    const token = await loginAs('admin', 'admin');
    const header = { authorization: `Bearer ${token}` };
    const labId = dnsLabId();
    const serverId = `srv-${labId}-ns1`;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/deploy-jobs',
      headers: header,
      payload: { targetServerIds: [serverId] },
    });
    expect(res.statusCode).toBe(201);
    const { jobId } = JSON.parse(res.body);

    const jobRes = await app.inject({
      method: 'GET',
      url: `/api/v1/configurations/dns-lab/deploy-jobs/${jobId}`,
      headers: header,
    });
    const job = JSON.parse(jobRes.body);
    expect(job.status).toBe('SUCCEEDED');
    expect(job.serverResults[0]).toMatchObject({ serverId, outcome: 'SUCCEEDED', trust: 'SIGNED' });
    // The signed manifest flows through the existing base64 push path.
    expect(scripts.some((s) => s.includes('.manager-manifest.json'))).toBe(true);
  });
});
