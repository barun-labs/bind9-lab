import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';

describe('RPZ API (CRUD + validation)', () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = openDb(':memory:');
    app = buildApp(db);
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

  function seedView(viewId: string, configId: string, name: string): void {
    db.prepare('INSERT INTO views (id, configurationId, data) VALUES (?, ?, ?)').run(
      viewId,
      configId,
      JSON.stringify({ id: viewId, configurationId: configId, name, order: 0, matchClients: [], zoneCount: 0 })
    );
  }

  function createPolicy(token: string, configId: string, payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/configurations/${configId}/rpz-policies`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
  }

  function createRule(token: string, configId: string, policyId: string, payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/configurations/${configId}/rpz-policies/${policyId}/rules`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
  }

  it('full CRUD round-trip for policies and rules', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };
    seedView('view-1', 'dns-lab', 'internal');

    const policyRes = await createPolicy(token, 'dns-lab', { viewId: 'view-1', name: 'blocklist', defaultPolicy: 'NXDOMAIN' });
    expect(policyRes.statusCode).toBe(201);
    const policy = JSON.parse(policyRes.body);
    expect(policy.id.startsWith('rpz-')).toBe(true);
    expect(policy.configurationId).toBe('dns-lab');
    expect(policy.name).toBe('blocklist');

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/rpz-policies',
      headers: authHeader,
    });
    expect(listRes.statusCode).toBe(200);
    expect(JSON.parse(listRes.body).some((p: any) => p.id === policy.id)).toBe(true);

    const ruleRes = await createRule(token, 'dns-lab', policy.id, {
      trigger: 'QNAME', value: 'evil.example', action: 'NXDOMAIN',
    });
    expect(ruleRes.statusCode).toBe(201);
    const rule = JSON.parse(ruleRes.body);
    expect(rule.id.startsWith('rpzr-')).toBe(true);
    expect(rule.policyId).toBe(policy.id);

    const rulesRes = await app.inject({
      method: 'GET',
      url: `/api/v1/configurations/dns-lab/rpz-policies/${policy.id}/rules`,
      headers: authHeader,
    });
    expect(rulesRes.statusCode).toBe(200);
    expect(JSON.parse(rulesRes.body).some((r: any) => r.id === rule.id)).toBe(true);

    const patchRuleRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/dns-lab/rpz-rules/${rule.id}`,
      headers: authHeader,
      payload: { action: 'DROP' },
    });
    expect(patchRuleRes.statusCode).toBe(200);
    expect(JSON.parse(patchRuleRes.body).action).toBe('DROP');

    const patchPolicyRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/dns-lab/rpz-policies/${policy.id}`,
      headers: authHeader,
      payload: { order: 5 },
    });
    expect(patchPolicyRes.statusCode).toBe(200);
    expect(JSON.parse(patchPolicyRes.body).order).toBe(5);

    const delRuleRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/dns-lab/rpz-rules/${rule.id}`,
      headers: authHeader,
    });
    expect(delRuleRes.statusCode).toBe(200);
    expect(JSON.parse(delRuleRes.body).deleted).toBe(true);

    const delPolicyRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/dns-lab/rpz-policies/${policy.id}`,
      headers: authHeader,
    });
    expect(delPolicyRes.statusCode).toBe(200);
    expect(JSON.parse(delPolicyRes.body).deleted).toBe(true);
  });

  it('rejects a QNAME rule with an invalid domain value (422)', async () => {
    const token = await loginAs('admin', 'admin');
    seedView('view-1', 'dns-lab', 'internal');
    const policy = JSON.parse((await createPolicy(token, 'dns-lab', { viewId: 'view-1', name: 'bl' })).body);

    const res = await createRule(token, 'dns-lab', policy.id, { trigger: 'QNAME', value: 'bad..name', action: 'NXDOMAIN' });
    expect(res.statusCode).toBe(422);
  });

  it('rejects a CLIENT_IP rule with a non-CIDR value (422)', async () => {
    const token = await loginAs('admin', 'admin');
    seedView('view-1', 'dns-lab', 'internal');
    const policy = JSON.parse((await createPolicy(token, 'dns-lab', { viewId: 'view-1', name: 'bl' })).body);

    const res = await createRule(token, 'dns-lab', policy.id, { trigger: 'CLIENT_IP', value: '10.0.0.999', action: 'DROP' });
    expect(res.statusCode).toBe(422);
  });

  it('rejects a CNAME action without a cname (422)', async () => {
    const token = await loginAs('admin', 'admin');
    seedView('view-1', 'dns-lab', 'internal');
    const policy = JSON.parse((await createPolicy(token, 'dns-lab', { viewId: 'view-1', name: 'bl' })).body);

    const res = await createRule(token, 'dns-lab', policy.id, { trigger: 'QNAME', value: 'evil.example', action: 'CNAME' });
    expect(res.statusCode).toBe(422);
  });

  it('rejects an NXDOMAIN rule carrying a cname (422)', async () => {
    const token = await loginAs('admin', 'admin');
    seedView('view-1', 'dns-lab', 'internal');
    const policy = JSON.parse((await createPolicy(token, 'dns-lab', { viewId: 'view-1', name: 'bl' })).body);

    const res = await createRule(token, 'dns-lab', policy.id, {
      trigger: 'QNAME', value: 'evil.example', action: 'NXDOMAIN', cname: 'target.example',
    });
    expect(res.statusCode).toBe(422);
  });

  it('returns 403 to a view-only actor on policy create', async () => {
    createUserWithRole('usr-viewer', 'viewer', [
      { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
    ]);
    const token = await loginAs('viewer', 'password123');
    const res = await createPolicy(token, 'dns-lab', { viewId: 'view-1', name: 'nope' });
    expect(res.statusCode).toBe(403);
  });

  it('scope-guards rule patch across configurations', async () => {
    db.prepare('INSERT INTO configurations (id, data) VALUES (?, ?)').run(
      'config-other',
      JSON.stringify({ id: 'config-other', name: 'other', isActive: true, createdFromTemplateId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), counts: { views: 0, zones: 0, records: 0, servers: 0 } })
    );
    createUserWithRole('usr-dual', 'dual', [
      { configurationId: 'dns-lab', role: 'editor', canDeploy: false },
      { configurationId: 'config-other', role: 'editor', canDeploy: false },
    ]);
    const token = await loginAs('dual', 'password123');
    const authHeader = { authorization: `Bearer ${token}` };
    seedView('view-1', 'dns-lab', 'internal');
    const policy = JSON.parse((await createPolicy(token, 'dns-lab', { viewId: 'view-1', name: 'bl' })).body);
    const rule = JSON.parse((await createRule(token, 'dns-lab', policy.id, { trigger: 'QNAME', value: 'evil.example', action: 'NXDOMAIN' })).body);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/config-other/rpz-rules/${rule.id}`,
      headers: authHeader,
      payload: { action: 'DROP' },
    });
    expect(res.statusCode).toBe(404);
  });
});
