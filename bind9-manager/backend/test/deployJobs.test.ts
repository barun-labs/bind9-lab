import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import { createLab } from '../src/server/labStore';
import { createApiKey } from '../src/server/authStore';
import { startDeployJob, getDeployJob, type DeployJob } from '../src/server/deployJobs';
import type { Runner } from '../src/server/deployEngine';
import type { TopologyModel } from '../src/config-engine/topology';
import { getServer } from '../src/server/entityStore';

describe('Deploy Jobs & Deploy Endpoint (DECLARATIVE-LAB Task 3)', () => {
  let db: Database.Database;
  let executedScripts: string[];
  let mockRunner: Runner;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = openDb(':memory:');
    executedScripts = [];
    mockRunner = async (script: string) => {
      executedScripts.push(script);
      if (script.includes('containerlab deploy')) {
        let out = '';
        const matches = script.matchAll(/NODE_ID='([^']+)'/g);
        for (const match of matches) {
          out += `__BIND9MGR_NODE_BEGIN__ ${match[1]}\nOK\n__BIND9MGR_NODE_END__ ${match[1]} 0\n`;
        }
        return {
          code: 0,
          stdout: out || 'OK',
          stderr: '',
        };
      }
      return {
        code: 0,
        stdout: 'OK',
        stderr: '',
      };
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

  const validTopology: TopologyModel = {
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

  async function waitForJob(jobId: string, authHeader: any, maxTries = 50): Promise<DeployJob> {
    for (let i = 0; i < maxTries; i++) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/deploy-jobs/${jobId}`,
        headers: authHeader,
      });
      if (res.statusCode === 200) {
        const job = JSON.parse(res.body) as DeployJob;
        if (job.status === 'SUCCEEDED' || job.status === 'FAILED') {
          return job;
        }
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`Job ${jobId} did not complete in time`);
  }

  describe('Authentication & Authorization', () => {
    it('returns 401 for unauthenticated POST /deploy and GET /deploy-jobs/:id', async () => {
      const lab = createLab(db, {
        name: 'test-lab',
        configurationId: 'dns-lab',
        topology: validTopology,
      });

      const postRes = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
      });
      expect(postRes.statusCode).toBe(401);

      const getRes = await app.inject({
        method: 'GET',
        url: '/api/v1/deploy-jobs/job-123',
      });
      expect(getRes.statusCode).toBe(401);

      // Verify no deploy script was run
      expect(executedScripts.some((s) => s.includes('containerlab deploy'))).toBe(false);
    });

    it('returns 403 for user WITHOUT deploy permission (viewer) and never runs containerlab deploy', async () => {
      createUserWithRole('usr-viewer', 'viewer-user', [
        { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
      ]);

      const token = await loginAs('viewer-user', 'password123');
      const authHeader = { authorization: `Bearer ${token}` };

      const lab = createLab(db, {
        name: 'test-lab',
        configurationId: 'dns-lab',
        topology: validTopology,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: authHeader,
      });

      expect(res.statusCode).toBe(403);
      expect(executedScripts.length).toBe(0);
      expect(executedScripts.some((s) => s.includes('containerlab deploy'))).toBe(false);
    });

    it('returns 403 for editor WITHOUT canDeploy flag', async () => {
      createUserWithRole('usr-editor-no-deploy', 'editor-no-deploy', [
        { configurationId: 'dns-lab', role: 'editor', canDeploy: false },
      ]);

      const token = await loginAs('editor-no-deploy', 'password123');
      const authHeader = { authorization: `Bearer ${token}` };

      const lab = createLab(db, {
        name: 'test-lab',
        configurationId: 'dns-lab',
        topology: validTopology,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: authHeader,
      });

      expect(res.statusCode).toBe(403);
      expect(executedScripts.length).toBe(0);
    });

    it('allows a viewer to GET /deploy-jobs/:id if they have view perm on the lab config', async () => {
      createUserWithRole('usr-viewer-2', 'viewer-user-2', [
        { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
      ]);

      const lab = createLab(db, {
        name: 'test-lab',
        configurationId: 'dns-lab',
        topology: validTopology,
      });

      const adminToken = await loginAs('admin', 'admin');
      const adminHeader = { authorization: `Bearer ${adminToken}` };

      const deployRes = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: adminHeader,
      });
      expect(deployRes.statusCode).toBe(201);
      const { jobId } = JSON.parse(deployRes.body);

      // Now viewer fetches the job
      const viewerToken = await loginAs('viewer-user-2', 'password123');
      const viewerHeader = { authorization: `Bearer ${viewerToken}` };

      const job = await waitForJob(jobId, viewerHeader);
      expect(job.id).toBe(jobId);
      expect(job.labId).toBe(lab.id);
      expect(job.status).toBe('SUCCEEDED');
    });

    it('returns 403 on GET /deploy-jobs/:id if user has no view perm on configuration', async () => {
      createUserWithRole('usr-other-config', 'other-user', [
        { configurationId: 'other-lab', role: 'viewer', canDeploy: false },
      ]);

      const lab = createLab(db, {
        name: 'test-lab',
        configurationId: 'dns-lab',
        topology: validTopology,
      });

      const adminToken = await loginAs('admin', 'admin');
      const deployRes = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const { jobId } = JSON.parse(deployRes.body);

      const otherToken = await loginAs('other-user', 'password123');
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/deploy-jobs/${jobId}`,
        headers: { authorization: `Bearer ${otherToken}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('response never leaks secrets (token, keyHash, pwHash, pwSalt)', async () => {
      const adminToken = await loginAs('admin', 'admin');
      const adminHeader = { authorization: `Bearer ${adminToken}` };

      const lab = createLab(db, {
        name: 'secret-test-lab',
        configurationId: 'dns-lab',
        topology: validTopology,
      });

      const deployRes = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: adminHeader,
      });
      expect(deployRes.statusCode).toBe(201);
      const { jobId } = JSON.parse(deployRes.body);

      const jobRes = await app.inject({
        method: 'GET',
        url: `/api/v1/deploy-jobs/${jobId}`,
        headers: adminHeader,
      });

      const bodyStr = jobRes.body;
      expect(bodyStr).not.toContain('pwHash');
      expect(bodyStr).not.toContain('pwSalt');
      expect(bodyStr).not.toContain('keyHash');
      expect(bodyStr).not.toContain(adminToken);
    });

    it('API key without deploy scope returns 403 on POST /deploy', async () => {
      createUserWithRole('usr-key-owner', 'key-owner', [
        { configurationId: 'dns-lab', role: 'admin', canDeploy: true },
      ]);

      const key = createApiKey(db, 'usr-key-owner', {
        name: 'write-only-key',
        scopes: ['read', 'write'],
        readOnly: false,
      });

      const lab = createLab(db, {
        name: 'test-lab',
        configurationId: 'dns-lab',
        topology: validTopology,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: { authorization: `Bearer ${key.token}` },
      });

      expect(res.statusCode).toBe(403);
      expect(executedScripts.length).toBe(0);
    });

    it('readOnly API key returns 403 on POST /deploy even if deploy scope is set', async () => {
      createUserWithRole('usr-ro-owner', 'ro-owner', [
        { configurationId: 'dns-lab', role: 'admin', canDeploy: true },
      ]);

      const key = createApiKey(db, 'usr-ro-owner', {
        name: 'ro-deploy-key',
        scopes: ['read', 'deploy'],
        readOnly: true,
      });

      const lab = createLab(db, {
        name: 'test-lab',
        configurationId: 'dns-lab',
        topology: validTopology,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: { authorization: `Bearer ${key.token}` },
      });

      expect(res.statusCode).toBe(403);
    });

    it('API key with deploy scope successfully triggers deploy -> 201 {jobId}', async () => {
      createUserWithRole('usr-deploy-key-owner', 'deploy-key-owner', [
        { configurationId: 'dns-lab', role: 'admin', canDeploy: true },
      ]);

      const key = createApiKey(db, 'usr-deploy-key-owner', {
        name: 'deploy-key',
        scopes: ['read', 'write', 'deploy'],
        readOnly: false,
      });

      const lab = createLab(db, {
        name: 'test-lab',
        configurationId: 'dns-lab',
        topology: validTopology,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: { authorization: `Bearer ${key.token}` },
      });

      expect(res.statusCode).toBe(201);
      const { jobId } = JSON.parse(res.body);
      const job = await waitForJob(jobId, { authorization: `Bearer ${key.token}` });
      expect(job.status).toBe('SUCCEEDED');
    });
  });

  describe('Successful Deployment', () => {
    it('admin deploys lab -> 201 {jobId}; GET shows SUCCEEDED with per-server deployed results', async () => {
      const adminToken = await loginAs('admin', 'admin');
      const adminHeader = { authorization: `Bearer ${adminToken}` };

      const lab = createLab(db, {
        name: 'mylab',
        configurationId: 'dns-lab',
        topology: validTopology,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: adminHeader,
      });

      expect(res.statusCode).toBe(201);
      const { jobId } = JSON.parse(res.body);
      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');

      const job = await waitForJob(jobId, adminHeader);
      expect(job.status).toBe('SUCCEEDED');
      expect(job.labId).toBe(lab.id);
      expect(job.result).toBeDefined();
      expect(job.result?.validated).toBeDefined();
      expect(job.result?.deployed).toBeDefined();
      expect(job.result?.aborted).toBeUndefined();

      expect(executedScripts.some((s) => s.includes('containerlab deploy'))).toBe(true);
    });

    it('editor WITH canDeploy deploys lab -> 201 {jobId}', async () => {
      createUserWithRole('usr-editor-deploy', 'editor-deploy', [
        { configurationId: 'dns-lab', role: 'editor', canDeploy: true },
      ]);

      const token = await loginAs('editor-deploy', 'password123');
      const authHeader = { authorization: `Bearer ${token}` };

      const lab = createLab(db, {
        name: 'editor-lab',
        configurationId: 'dns-lab',
        topology: validTopology,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: authHeader,
      });

      expect(res.statusCode).toBe(201);
      const { jobId } = JSON.parse(res.body);
      const job = await waitForJob(jobId, authHeader);
      expect(job.status).toBe('SUCCEEDED');
    });

    it('POST /deploy derives labDir server-side as /home/lun/<name> and ignores body.labDir', async () => {
      const adminToken = await loginAs('admin', 'admin');
      const adminHeader = { authorization: `Bearer ${adminToken}` };

      const lab = createLab(db, {
        name: 'custom-dir-lab',
        configurationId: 'dns-lab',
        topology: validTopology,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: adminHeader,
        payload: { labDir: '/tmp/custom-lab-dir-123' },
      });

      expect(res.statusCode).toBe(201);
      const { jobId } = JSON.parse(res.body);
      const job = await waitForJob(jobId, adminHeader);
      expect(job.status).toBe('SUCCEEDED');

      const deployScript = executedScripts.find((s) => s.includes('containerlab deploy'));
      expect(deployScript).toBeDefined();
      expect(deployScript).not.toContain('/tmp/custom-lab-dir-123');
      expect(deployScript).toContain('/home/lun/mylab');
    });

    it('SUCCEEDED job reconciles the bind Server row to SYNCED with a populated containerId', async () => {
      const adminToken = await loginAs('admin', 'admin');
      const adminHeader = { authorization: `Bearer ${adminToken}` };

      const lab = createLab(db, {
        name: 'mylab',
        configurationId: 'dns-lab',
        topology: validTopology,
      });

      const runnerWithInspect: Runner = async (script: string) => {
        executedScripts.push(script);
        if (script.includes('containerlab deploy')) {
          let out = '';
          const matches = script.matchAll(/NODE_ID='([^']+)'/g);
          for (const match of matches) {
            out += `__BIND9MGR_NODE_BEGIN__ ${match[1]}\nOK\n__BIND9MGR_NODE_END__ ${match[1]} 0\n`;
          }
          return { code: 0, stdout: out || 'OK', stderr: '' };
        }
        if (script.includes('containerlab inspect')) {
          return {
            code: 0,
            stdout: JSON.stringify({
              mylab: [
                {
                  name: 'clab-mylab-ns1',
                  container_id: 'runtime-abc123',
                  state: 'running',
                  status: 'Up 1 minute',
                  ipv4_address: '10.70.0.11/24',
                },
              ],
            }),
            stderr: '',
          };
        }
        return { code: 0, stdout: 'OK', stderr: '' };
      };

      const inspectApp = buildApp(db, { runner: runnerWithInspect });

      const res = await inspectApp.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: adminHeader,
      });

      expect(res.statusCode).toBe(201);
      const { jobId } = JSON.parse(res.body);
      const job = await waitForJob(jobId, adminHeader);
      expect(job.status).toBe('SUCCEEDED');

      const srv = getServer(db, 'srv-' + lab.id + '-ns1') as any;
      expect(srv.syncState).toBe('SYNCED');
      expect(srv.containerId).toBe('runtime-abc123');
    });
  });

  describe('Pre-flight Failure & Safety Gates', () => {
    it('invalid configuration fails validation -> job FAILED / result.aborted set, NO containerlab deploy reached runner', async () => {
      // Mock runner that fails named-checkconf validation
      const failingRunner: Runner = async (script: string) => {
        executedScripts.push(script);
        if (script.includes('named-checkconf')) {
          return { code: 1, stdout: '', stderr: 'zone syntax error' };
        }
        return { code: 0, stdout: 'OK', stderr: '' };
      };

      const failingApp = buildApp(db, { runner: failingRunner });

      const adminToken = await loginAs('admin', 'admin');
      const adminHeader = { authorization: `Bearer ${adminToken}` };

      const lab = createLab(db, {
        name: 'broken-lab',
        configurationId: 'dns-lab',
        topology: validTopology,
      });

      const res = await failingApp.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: adminHeader,
      });

      expect(res.statusCode).toBe(201);
      const { jobId } = JSON.parse(res.body);

      // Wait for job completion
      let job: DeployJob | null = null;
      for (let i = 0; i < 50; i++) {
        const jobRes = await failingApp.inject({
          method: 'GET',
          url: `/api/v1/deploy-jobs/${jobId}`,
          headers: adminHeader,
        });
        if (jobRes.statusCode === 200) {
          const j = JSON.parse(jobRes.body);
          if (j.status === 'FAILED' || j.status === 'SUCCEEDED') {
            job = j;
            break;
          }
        }
        await new Promise((r) => setTimeout(r, 10));
      }

      expect(job).not.toBeNull();
      expect(job?.status).toBe('FAILED');
      expect(job?.result?.aborted).toBe('pre-flight failed');
      expect(job?.result?.validated.some((v) => !v.ok)).toBe(true);

      // Ensure NO containerlab deploy script was executed!
      expect(executedScripts.some((s) => s.includes('containerlab deploy'))).toBe(false);
    });

    it('reserved topology name (dns) is refused -> job FAILED / result.aborted set, NO deploy run', async () => {
      const adminToken = await loginAs('admin', 'admin');
      const adminHeader = { authorization: `Bearer ${adminToken}` };

      const reservedTopology: TopologyModel = {
        ...validTopology,
        name: 'dns',
      };

      const lab = createLab(db, {
        name: 'dns',
        configurationId: 'dns-lab',
        topology: reservedTopology,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: adminHeader,
      });

      expect(res.statusCode).toBe(201);
      const { jobId } = JSON.parse(res.body);

      const job = await waitForJob(jobId, adminHeader);
      expect(job.status).toBe('FAILED');
      expect(job.result?.aborted).toContain('refusing to target a reserved/production lab name');
      expect(executedScripts.some((s) => s.includes('containerlab deploy'))).toBe(false);
    });

    it('reserved topology name starting with clab- is refused', async () => {
      const adminToken = await loginAs('admin', 'admin');
      const adminHeader = { authorization: `Bearer ${adminToken}` };

      const reservedTopology: TopologyModel = {
        ...validTopology,
        name: 'clab-custom',
      };

      const lab = createLab(db, {
        name: 'clab-custom',
        configurationId: 'dns-lab',
        topology: reservedTopology,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/labs/${lab.id}/deploy`,
        headers: adminHeader,
      });

      expect(res.statusCode).toBe(201);
      const { jobId } = JSON.parse(res.body);

      const job = await waitForJob(jobId, adminHeader);
      expect(job.status).toBe('FAILED');
      expect(job.result?.aborted).toContain('refusing to target a reserved/production lab name');
      expect(executedScripts.some((s) => s.includes('containerlab deploy'))).toBe(false);
    });
  });

  describe('Not Found 404 Handlers', () => {
    it('returns 404 when trying to deploy a non-existent lab', async () => {
      const adminToken = await loginAs('admin', 'admin');
      const adminHeader = { authorization: `Bearer ${adminToken}` };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/labs/non-existent-lab-id/deploy',
        headers: adminHeader,
      });

      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when fetching a non-existent deploy job', async () => {
      const adminToken = await loginAs('admin', 'admin');
      const adminHeader = { authorization: `Bearer ${adminToken}` };

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/deploy-jobs/non-existent-job-id',
        headers: adminHeader,
      });

      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND');
    });
  });

  describe('Direct deployJobs store tests', () => {
    it('getDeployJob returns null for non-existent job', () => {
      expect(getDeployJob(db, 'unknown-id')).toBeNull();
    });

    it('startDeployJob handles runner exception and records error with status FAILED', async () => {
      const lab = createLab(db, {
        name: 'throw-lab',
        configurationId: 'dns-lab',
        topology: validTopology,
      });

      const throwingRunner: Runner = async () => {
        throw new Error('SSH connection severed');
      };

      const job = startDeployJob(db, lab, {
        run: throwingRunner,
        labDir: '/tmp/throw-test',
      });

      expect(job.id).toBeDefined();
      expect(job.labId).toBe(lab.id);

      // Wait for async execution
      for (let i = 0; i < 50; i++) {
        const stored = getDeployJob(db, job.id);
        if (stored && (stored.status === 'FAILED' || stored.status === 'SUCCEEDED')) {
          expect(stored.status).toBe('FAILED');
          expect(stored.error).toContain('SSH connection severed');
          return;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error('Async job did not finish in time');
    });
  });
});
