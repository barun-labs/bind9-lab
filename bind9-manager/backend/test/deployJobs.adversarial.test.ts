import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import { createLab } from '../src/server/labStore';
import { createApiKey } from '../src/server/authStore';
import { getDeployJob, type DeployJob } from '../src/server/deployJobs';
import type { Runner } from '../src/server/deployEngine';
import type { TopologyModel } from '../src/config-engine/topology';

type App = ReturnType<typeof buildApp>;

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const ok = { code: 0, stdout: 'OK', stderr: '' };

// A runner that records every bash script it is handed and returns a
// caller-supplied reply (default: success). The recorded scripts are the
// authoritative proof of whether `containerlab deploy` was ever reached.
function recordingRunner(
  reply: (script: string) => { code: number; stdout: string; stderr: string } = () => ok,
): { run: Runner; scripts: string[] } {
  const scripts: string[] = [];
  const run: Runner = async (script) => {
    scripts.push(script);
    return reply(script);
  };
  return { run, scripts };
}

function seedUser(
  db: Database.Database,
  id: string,
  username: string,
  password: string,
  roles: Array<{ configurationId: string; role: 'viewer' | 'editor' | 'admin'; canDeploy: boolean }>,
): void {
  const { salt, hash } = hashPassword(password);
  db.prepare(`
    INSERT INTO users (id, username, displayName, isActive, roles, pwSalt, pwHash, createdAt)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?)
  `).run(id, username, username, JSON.stringify(roles), salt, hash, new Date().toISOString());
}

async function login(app: App, username: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    payload: { username, password },
  });
  expect(res.statusCode, `login ${username}`).toBe(200);
  return JSON.parse(res.body).token as string;
}

const validTopology: TopologyModel = {
  name: 'advlab',
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

async function waitForJob(
  app: App,
  jobId: string,
  authHeader: { authorization: string },
  maxTries = 200,
): Promise<DeployJob> {
  for (let i = 0; i < maxTries; i++) {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/deploy-jobs/${jobId}`,
      headers: authHeader,
    });
    if (res.statusCode === 200) {
      const job = JSON.parse(res.body) as DeployJob;
      if (job.status === 'SUCCEEDED' || job.status === 'FAILED') return job;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`job ${jobId} did not finish`);
}

describe('Deploy jobs & deploy endpoint — adversarial', () => {
  let db: Database.Database;
  let app: App;
  let scripts: string[];

  beforeEach(() => {
    db = openDb(':memory:');
    const rec = recordingRunner();
    scripts = rec.scripts;
    app = buildApp(db, { runner: rec.run });
  });

  // ---------------------------------------------------------------------------
  // Gate 1: deploy permission required. No deploy without it.
  // ---------------------------------------------------------------------------
  describe('deploy authorization: no deploy without the deploy permission', () => {
    it('viewer -> 403 and the runner never receives containerlab deploy', async () => {
      seedUser(db, 'usr-viewer', 'viewer1', 'viewerpass', [
        { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
      ]);
      const token = await login(app, 'viewer1', 'viewerpass');
      const lab = createLab(db, { name: 'advlab', configurationId: 'dns-lab', topology: validTopology });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: bearer(token),
      });

      expect(res.statusCode).toBe(403);
      expect(scripts.some((s) => s.includes('containerlab deploy'))).toBe(false);
      expect(scripts).toHaveLength(0);
    });

    it('editor without canDeploy -> 403 and no deploy script', async () => {
      seedUser(db, 'usr-editor', 'editor1', 'editorpass', [
        { configurationId: 'dns-lab', role: 'editor', canDeploy: false },
      ]);
      const token = await login(app, 'editor1', 'editorpass');
      const lab = createLab(db, { name: 'advlab', configurationId: 'dns-lab', topology: validTopology });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: bearer(token),
      });

      expect(res.statusCode).toBe(403);
      expect(scripts.some((s) => s.includes('containerlab deploy'))).toBe(false);
    });

    it('admin (has deploy) -> 201 {jobId} and the job reaches the runner', async () => {
      const token = await login(app, 'admin', 'admin');
      const lab = createLab(db, { name: 'advlab', configurationId: 'dns-lab', topology: validTopology });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: bearer(token),
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(typeof body.jobId).toBe('string');
      expect(body.jobId.length).toBeGreaterThan(0);

      const job = await waitForJob(app, body.jobId, bearer(token));
      expect(job.status).toBe('SUCCEEDED');
      expect(scripts.some((s) => s.includes('containerlab deploy'))).toBe(true);
    });

    it('editor with canDeploy -> 201 (boundary: deploy, not edit, is the gate)', async () => {
      seedUser(db, 'usr-editor2', 'editor2', 'editorpass', [
        { configurationId: 'dns-lab', role: 'editor', canDeploy: true },
      ]);
      const token = await login(app, 'editor2', 'editorpass');
      const lab = createLab(db, { name: 'advlab', configurationId: 'dns-lab', topology: validTopology });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: bearer(token),
      });

      expect(res.statusCode).toBe(201);
      const { jobId } = JSON.parse(res.body);
      await waitForJob(app, jobId, bearer(token));
      expect(scripts.some((s) => s.includes('containerlab deploy'))).toBe(true);
    });

    it('viewer can view (GET the job) but the same viewer cannot deploy', async () => {
      seedUser(db, 'usr-viewer2', 'viewer2', 'viewerpass', [
        { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
      ]);
      const adminToken = await login(app, 'admin', 'admin');
      const lab = createLab(db, { name: 'advlab', configurationId: 'dns-lab', topology: validTopology });

      const deploy = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: bearer(adminToken),
      });
      expect(deploy.statusCode).toBe(201);
      const { jobId } = JSON.parse(deploy.body);

      const viewerToken = await login(app, 'viewer2', 'viewerpass');
      const get = await app.inject({
        method: 'GET',
        url: `/api/v1/deploy-jobs/${jobId}`,
        headers: bearer(viewerToken),
      });
      expect(get.statusCode).toBe(200);

      const deny = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: bearer(viewerToken),
      });
      expect(deny.statusCode).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Gate 2: read-only API key can never trigger a deploy, even if its owner can.
  // ---------------------------------------------------------------------------
  describe('read-only api key cannot deploy even if its owner can', () => {
    it('readOnly key (with deploy scope) of a deploy-capable owner -> 403, no deploy', async () => {
      seedUser(db, 'usr-owner', 'owner1', 'ownerpass', [
        { configurationId: 'dns-lab', role: 'admin', canDeploy: true },
      ]);

      const key = createApiKey(db, 'usr-owner', {
        name: 'ro-deploy',
        scopes: ['read', 'deploy'],
        readOnly: true,
      });

      const lab = createLab(db, { name: 'advlab', configurationId: 'dns-lab', topology: validTopology });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: bearer(key.token),
      });

      expect(res.statusCode).toBe(403);
      expect(scripts.some((s) => s.includes('containerlab deploy'))).toBe(false);
    });

    it('readOnly key without deploy scope -> 403 as well', async () => {
      seedUser(db, 'usr-owner2', 'owner2', 'ownerpass', [
        { configurationId: 'dns-lab', role: 'admin', canDeploy: true },
      ]);

      const key = createApiKey(db, 'usr-owner2', {
        name: 'ro-read',
        scopes: ['read'],
        readOnly: true,
      });

      const lab = createLab(db, { name: 'advlab', configurationId: 'dns-lab', topology: validTopology });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: bearer(key.token),
      });

      expect(res.statusCode).toBe(403);
      expect(scripts.some((s) => s.includes('containerlab deploy'))).toBe(false);
    });

    it('non-readOnly key with deploy scope does deploy (control: readOnly is the blocker)', async () => {
      seedUser(db, 'usr-owner3', 'owner3', 'ownerpass', [
        { configurationId: 'dns-lab', role: 'admin', canDeploy: true },
      ]);

      const key = createApiKey(db, 'usr-owner3', {
        name: 'rw-deploy',
        scopes: ['read', 'write', 'deploy'],
        readOnly: false,
      });

      const lab = createLab(db, { name: 'advlab', configurationId: 'dns-lab', topology: validTopology });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: bearer(key.token),
      });

      expect(res.statusCode).toBe(201);
      const { jobId } = JSON.parse(res.body);
      await waitForJob(app, jobId, bearer(key.token));
      expect(scripts.some((s) => s.includes('containerlab deploy'))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Gate 3: pre-flight validation failure aborts the job before any deploy.
  // ---------------------------------------------------------------------------
  describe('pre-flight gate: invalid config aborts the job, no deploy reaches runner', () => {
    it('named-checkconf failure -> job FAILED, result.aborted set, no containerlab deploy', async () => {
      const rec = recordingRunner((script) =>
        script.includes('named-checkconf')
          ? { code: 1, stdout: '', stderr: 'zone syntax error' }
          : ok,
      );
      const failingApp = buildApp(db, { runner: rec.run });

      const token = await login(failingApp, 'admin', 'admin');
      const lab = createLab(db, { name: 'advlab', configurationId: 'dns-lab', topology: validTopology });

      const res = await failingApp.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: bearer(token),
      });
      expect(res.statusCode).toBe(201);
      const { jobId } = JSON.parse(res.body);

      const job = await waitForJob(failingApp, jobId, bearer(token));
      expect(job.status).toBe('FAILED');
      expect(job.result?.aborted).toBe('pre-flight failed');
      expect(job.result?.validated.some((v) => !v.ok)).toBe(true);
      expect(rec.scripts.some((s) => s.includes('containerlab deploy'))).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Gate 4: reserved topology names are refused by the engine, reflected in job.
  // ---------------------------------------------------------------------------
  describe('reserved-name refusal: engine aborts, job reflects it, no deploy', () => {
    it.each(['dns', 'clab-dns', 'clab-other'])(
      'topology.name %s -> job FAILED with abort, runner never called',
      async (name) => {
        const token = await login(app, 'admin', 'admin');
        const lab = createLab(db, {
          name,
          configurationId: 'dns-lab',
          topology: { ...validTopology, name },
        });

        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/labs/${lab.id}/deploy`,
          headers: bearer(token),
        });
        expect(res.statusCode).toBe(201);
        const { jobId } = JSON.parse(res.body);

        const job = await waitForJob(app, jobId, bearer(token));
        expect(job.status).toBe('FAILED');
        expect(job.result?.aborted).toContain('refusing to target a reserved/production lab name');
        // The engine aborts before any pre-flight or deploy, so nothing is run.
        expect(scripts.some((s) => s.includes('containerlab deploy'))).toBe(false);
      },
    );
  });

  // ---------------------------------------------------------------------------
  // Gate 5: job isolation / IDOR.
  // ---------------------------------------------------------------------------
  describe('job isolation / IDOR', () => {
    it('GET /deploy-jobs/:id for a job in a config the actor cannot view -> 403', async () => {
      seedUser(db, 'usr-split-admin', 'splitadmin', 'splitpass', [
        { configurationId: 'split-horizon', role: 'admin', canDeploy: true },
      ]);
      seedUser(db, 'usr-dns-viewer', 'dnsviewer', 'dnsviewerpass', [
        { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
      ]);

      const lab = createLab(db, {
        name: 'split-lab',
        configurationId: 'split-horizon',
        topology: validTopology,
      });

      const splitToken = await login(app, 'splitadmin', 'splitpass');
      const deploy = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: bearer(splitToken),
      });
      expect(deploy.statusCode).toBe(201);
      const { jobId } = JSON.parse(deploy.body);

      // Owner of the config can read it (control).
      const own = await app.inject({
        method: 'GET',
        url: `/api/v1/deploy-jobs/${jobId}`,
        headers: bearer(splitToken),
      });
      expect(own.statusCode).toBe(200);

      // A dns-lab-only viewer cannot see a job on split-horizon.
      const dnsToken = await login(app, 'dnsviewer', 'dnsviewerpass');
      const leak = await app.inject({
        method: 'GET',
        url: `/api/v1/deploy-jobs/${jobId}`,
        headers: bearer(dnsToken),
      });
      expect(leak.statusCode).toBe(403);
    });

    it('GET /deploy-jobs/:id for a nonexistent job -> 404 (not 500)', async () => {
      const token = await login(app, 'admin', 'admin');
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/deploy-jobs/job-does-not-exist',
        headers: bearer(token),
      });
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // Gate 6: unauthenticated -> 401, and no secret leakage.
  // ---------------------------------------------------------------------------
  describe('unauthenticated 401 and no secret leakage', () => {
    it('unauth POST /deploy and GET /deploy-jobs/:id -> 401', async () => {
      const lab = createLab(db, { name: 'advlab', configurationId: 'dns-lab', topology: validTopology });

      const post = await app.inject({ method: 'POST', url: `/api/v1/labs/${lab.id}/deploy` });
      expect(post.statusCode).toBe(401);

      const get = await app.inject({ method: 'GET', url: '/api/v1/deploy-jobs/job-any' });
      expect(get.statusCode).toBe(401);

      expect(scripts.some((s) => s.includes('containerlab deploy'))).toBe(false);
    });

    it('deploy + job responses never leak token/keyHash/pwHash/pwSalt', async () => {
      const token = await login(app, 'admin', 'admin');
      const key = createApiKey(db, 'usr-admin', {
        name: 'secret-check',
        scopes: ['read', 'write', 'deploy'],
        readOnly: false,
      });

      const lab = createLab(db, { name: 'advlab', configurationId: 'dns-lab', topology: validTopology });
      const deploy = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: bearer(token),
      });
      expect(deploy.statusCode).toBe(201);
      const { jobId } = JSON.parse(deploy.body);

      const get = await app.inject({
        method: 'GET',
        url: `/api/v1/deploy-jobs/${jobId}`,
        headers: bearer(token),
      });
      expect(get.statusCode).toBe(200);

      const needles = ['pwHash', 'pwSalt', 'keyHash', token, key.token];
      for (const [label, res] of [
        ['deploy', deploy],
        ['job', get],
      ] as const) {
        for (const n of needles) {
          expect(res.body, `${label} leaks ${n.slice(0, 8)}…`).not.toContain(n);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Gate 7: robustness — 404 on missing lab, 4xx (not 500) on malformed body.
  // ---------------------------------------------------------------------------
  describe('robustness: missing lab 404, malformed body 4xx not 500', () => {
    it('deploy on a nonexistent lab -> 404', async () => {
      const token = await login(app, 'admin', 'admin');
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/labs/lab-no-such/deploy',
        headers: bearer(token),
      });
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND');
    });

    it('malformed JSON body -> 4xx, never 500', async () => {
      const token = await login(app, 'admin', 'admin');
      const lab = createLab(db, { name: 'advlab', configurationId: 'dns-lab', topology: validTopology });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: '{ not valid json',
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
    });

    it('non-object JSON body (array / scalar) is tolerated without a 500', async () => {
      const token = await login(app, 'admin', 'admin');
      const lab = createLab(db, { name: 'advlab', configurationId: 'dns-lab', topology: validTopology });

      for (const payload of [[1, 2, 3], 'just-a-string', 12345]) {
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/labs/${lab.id}/deploy`,
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          payload: JSON.stringify(payload),
        });
        expect(res.statusCode, `payload ${JSON.stringify(payload)}`).toBeLessThan(500);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Gate 8: Path traversal protection on deploy trigger & lab names
  // ---------------------------------------------------------------------------
  describe('path traversal protection: server-side labDir derivation & name validation', () => {
    it('deploy request with body.labDir="/etc" does not cause any script to reference /etc (server-derived /home/lun/<name> is used)', async () => {
      const token = await login(app, 'admin', 'admin');
      const lab = createLab(db, { name: 'advlab', configurationId: 'dns-lab', topology: validTopology });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: bearer(token),
        payload: { labDir: '/etc' },
      });

      expect(res.statusCode).toBe(201);
      const { jobId } = JSON.parse(res.body);
      const job = await waitForJob(app, jobId, bearer(token));
      expect(job.status).toBe('SUCCEEDED');

      // Assert that the server-derived path /home/lun/advlab was used
      expect(scripts.some((s) => s.includes('/home/lun/advlab/topo.clab.yml'))).toBe(true);
      expect(scripts.some((s) => s.includes("mkdir -p '/home/lun/advlab'"))).toBe(true);

      // Assert that caller-provided labDir '/etc' was not used in any directory or topo creation
      expect(scripts.some((s) => s.includes("'/etc/topo.clab.yml'"))).toBe(false);
      expect(scripts.some((s) => s.includes("mkdir -p '/etc'") || s.includes("mkdir -p '/etc/configs'"))).toBe(false);
    });

    it('creating a lab with topology.name containing path traversal ("../../../etc" or "/") -> 422 INVALID_NAME', async () => {
      const token = await login(app, 'admin', 'admin');
      for (const badName of ['../../../etc', 'evil/name', '../evil', 'foo/bar', 'bad..name']) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/labs',
          headers: bearer(token),
          payload: {
            name: 'valid-lab-name',
            configurationId: 'dns-lab',
            topology: { ...validTopology, name: badName },
          },
        });
        expect(res.statusCode, `POST /labs with topology.name=${badName}`).toBe(422);
        const body = JSON.parse(res.body);
        expect(body.error?.code).toBe('INVALID_NAME');
      }
    });

    it('importing a lab with topology.name containing path traversal ("../../../etc" or "/") -> 422 INVALID_NAME', async () => {
      const token = await login(app, 'admin', 'admin');
      for (const badName of ['../../../etc', 'evil/name', '../evil']) {
        const yaml = `
name: "${badName}"
mgmt:
  network: clab-mgmt
  ipv4-subnet: 10.70.0.0/24
topology:
  nodes:
    ns1:
      kind: linux
      image: dnsnode:1.0
`;
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/labs/import',
          headers: bearer(token),
          payload: {
            configurationId: 'dns-lab',
            yaml,
          },
        });
        expect(res.statusCode, `POST /labs/import with name=${badName}`).toBe(422);
        const body = JSON.parse(res.body);
        expect(body.error?.code).toBe('INVALID_NAME');
      }
    });

    it('the deployEngine refuses a topology whose name is ../evil (aborted, no containerlab deploy script)', async () => {
      const token = await login(app, 'admin', 'admin');
      const lab = createLab(db, {
        name: 'evil-lab',
        configurationId: 'dns-lab',
        topology: { ...validTopology, name: '../evil' },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: bearer(token),
      });
      expect(res.statusCode).toBe(201);
      const { jobId } = JSON.parse(res.body);

      const job = await waitForJob(app, jobId, bearer(token));
      expect(job.status).toBe('FAILED');
      expect(job.result?.aborted).toContain('refusing to target a reserved/production lab name');
      expect(scripts.some((s) => s.includes('containerlab deploy'))).toBe(false);
    });
  });
});
