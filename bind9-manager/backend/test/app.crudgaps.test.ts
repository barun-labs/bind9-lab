import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import { buildConfigModel } from '../src/server/entityStore';

describe('CRUD gaps API (views, zones, deploy-jobs list, search)', () => {
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

  function seedConfiguration(id: string): void {
    db.prepare('INSERT INTO configurations (id, data) VALUES (?, ?)').run(
      id,
      JSON.stringify({
        id,
        name: id,
        isActive: true,
        createdFromTemplateId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        counts: { views: 0, zones: 0, records: 0, servers: 0 },
      })
    );
  }

  async function createView(
    token: string,
    configId: string,
    payload: Record<string, unknown>
  ): Promise<{ statusCode: number; body: any }> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/configurations/${configId}/views`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    return { statusCode: res.statusCode, body: JSON.parse(res.body) };
  }

  it('creates a view, ignores an injected id, and exposes it in the config model', async () => {
    const token = await loginAs('admin', 'admin');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/views',
      headers: { authorization: `Bearer ${token}` },
      payload: { id: 'view-evil', name: 'internal-test' },
    });
    expect(res.statusCode).toBe(201);
    const view = JSON.parse(res.body);
    expect(view.id.startsWith('view-')).toBe(true);
    expect(view.id).not.toBe('view-evil');
    expect(view.name).toBe('internal-test');
    expect(view.configurationId).toBe('dns-lab');

    const model = buildConfigModel(db, 'dns-lab');
    expect(model.views.some((v) => v.id === view.id)).toBe(true);
  });

  it('rejects invalid and empty view names with 422', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    for (const name of ['bad name!', '']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/configurations/dns-lab/views',
        headers: authHeader,
        payload: { name },
      });
      expect(res.statusCode).toBe(422);
      expect(JSON.parse(res.body).error.code).toBe('INVALID_NAME');
    }
  });

  it('updates a view name, deletes an empty view, and 409s a view with zones', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const { body: view } = await createView(token, 'dns-lab', { name: 'rename-me' });

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/dns-lab/views/${view.id}`,
      headers: authHeader,
      payload: { name: 'renamed' },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(JSON.parse(patchRes.body).name).toBe('renamed');

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/dns-lab/views/${view.id}`,
      headers: authHeader,
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(JSON.parse(deleteRes.body).deleted).toBe(true);

    // View with a zone cannot be deleted.
    const { body: parent } = await createView(token, 'dns-lab', { name: 'occupied' });
    const zoneRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/zones',
      headers: authHeader,
      payload: { viewId: parent.id, name: 'occupied.example.com' },
    });
    expect(zoneRes.statusCode).toBe(201);

    const blocked = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/dns-lab/views/${parent.id}`,
      headers: authHeader,
    });
    expect(blocked.statusCode).toBe(409);
    expect(JSON.parse(blocked.body).error.code).toBe('HAS_DEPENDENTS');
  });

  it('creates a zone in a config view, increments zoneCount, and rejects foreign viewId and bad name', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const { body: view } = await createView(token, 'dns-lab', { name: 'zonehost' });
    expect(buildConfigModel(db, 'dns-lab').views.find((v) => v.id === view.id)?.zoneCount).toBe(0);

    const zoneRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/zones',
      headers: authHeader,
      payload: { viewId: view.id, name: 'example.com' },
    });
    expect(zoneRes.statusCode).toBe(201);
    const zone = JSON.parse(zoneRes.body);
    expect(zone.id.startsWith('zone-')).toBe(true);
    expect(zone.configurationId).toBe('dns-lab');
    expect(zone.viewId).toBe(view.id);

    const after = buildConfigModel(db, 'dns-lab').views.find((v) => v.id === view.id);
    expect(after?.zoneCount).toBe(1);

    // Invalid name.
    const badName = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/zones',
      headers: authHeader,
      payload: { viewId: view.id, name: 'bad name!' },
    });
    expect(badName.statusCode).toBe(422);
    expect(JSON.parse(badName.body).error.code).toBe('INVALID_NAME');
  });

  it('rejects a zone whose viewId belongs to another configuration', async () => {
    seedConfiguration('config-a');
    seedConfiguration('config-b');
    createUserWithRole('usr-dual', 'dual', [
      { configurationId: 'config-a', role: 'editor', canDeploy: false },
      { configurationId: 'config-b', role: 'editor', canDeploy: false },
    ]);
    const token = await loginAs('dual', 'password123');
    const authHeader = { authorization: `Bearer ${token}` };

    const { body: viewA } = await createView(token, 'config-a', { name: 'view-a' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/config-b/zones',
      headers: authHeader,
      payload: { viewId: viewA.id, name: 'cross.example.com' },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_VIEW');
  });

  it('returns 403 to a view-only actor on view create, zone create, and view delete', async () => {
    createUserWithRole('usr-viewer', 'viewer', [
      { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
    ]);
    const token = await loginAs('viewer', 'password123');
    const authHeader = { authorization: `Bearer ${token}` };

    const createViewRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/views',
      headers: authHeader,
      payload: { name: 'nope' },
    });
    expect(createViewRes.statusCode).toBe(403);

    const createZoneRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/zones',
      headers: authHeader,
      payload: { viewId: 'view-internal', name: 'nope.example.com' },
    });
    expect(createZoneRes.statusCode).toBe(403);

    const deleteViewRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/configurations/dns-lab/views/view-internal',
      headers: authHeader,
    });
    expect(deleteViewRes.statusCode).toBe(403);
  });

  it('scope-guards patch and delete of a view across configurations', async () => {
    seedConfiguration('config-a');
    seedConfiguration('config-b');
    createUserWithRole('usr-dual', 'dual', [
      { configurationId: 'config-a', role: 'editor', canDeploy: false },
      { configurationId: 'config-b', role: 'editor', canDeploy: false },
    ]);
    const token = await loginAs('dual', 'password123');
    const authHeader = { authorization: `Bearer ${token}` };

    const { body: viewA } = await createView(token, 'config-a', { name: 'scope-view' });

    const patchOther = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/config-b/views/${viewA.id}`,
      headers: authHeader,
      payload: { name: 'hijacked' },
    });
    expect(patchOther.statusCode).toBe(404);

    const deleteOther = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/config-b/views/${viewA.id}`,
      headers: authHeader,
    });
    expect(deleteOther.statusCode).toBe(404);

    const stillThere = buildConfigModel(db, 'config-a');
    expect(stillThere.views.some((v) => v.id === viewA.id)).toBe(true);
  });

  it('lists deploy jobs as an array (empty when none started)', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/deploy-jobs',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('scopes the deploy-jobs list to configs the actor can view', async () => {
    // Seed a lab in dns-lab and a deploy job for it.
    db.prepare('INSERT INTO labs (id, configurationId, data) VALUES (?, ?, ?)').run(
      'lab-x',
      'dns-lab',
      JSON.stringify({ id: 'lab-x', configurationId: 'dns-lab', name: 'lab-x' })
    );
    db.prepare('INSERT INTO deploy_jobs (id, data) VALUES (?, ?)').run(
      'dj-1',
      JSON.stringify({ id: 'dj-1', labId: 'lab-x', status: 'SUCCEEDED', createdAt: '2026-08-16T00:00:00Z' })
    );

    const adminToken = await loginAs('admin', 'admin');
    const adminRes = await app.inject({
      method: 'GET',
      url: '/api/v1/deploy-jobs',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(JSON.parse(adminRes.body).data.some((j: any) => j.id === 'dj-1')).toBe(true);

    // A user whose only role is on another config must NOT see the dns-lab job.
    createUserWithRole('usr-other', 'other', [
      { configurationId: 'other-cfg', role: 'viewer', canDeploy: false },
    ]);
    const otherToken = await loginAs('other', 'password123');
    const otherRes = await app.inject({
      method: 'GET',
      url: '/api/v1/deploy-jobs',
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(otherRes.statusCode).toBe(200);
    expect(JSON.parse(otherRes.body).data).toEqual([]);
  });

  it('searches zones by case-insensitive substring and returns empty results for empty q', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const { body: view } = await createView(token, 'dns-lab', { name: 'search-view' });
    const zoneRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/zones',
      headers: authHeader,
      payload: { viewId: view.id, name: 'example.com' },
    });
    const zone = JSON.parse(zoneRes.body);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/search?q=example',
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.results.zones.some((z: any) => z.id === zone.id)).toBe(true);

    const emptyRes = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/search?q=',
      headers: authHeader,
    });
    expect(emptyRes.statusCode).toBe(200);
    const emptyBody = JSON.parse(emptyRes.body);
    expect(emptyBody.results.zones).toEqual([]);
    expect(emptyBody.results.records).toEqual([]);
    expect(emptyBody.results.views).toEqual([]);
    expect(emptyBody.results.servers).toEqual([]);
    expect(emptyBody.results.externalHosts).toEqual([]);
  });

  it('lists and fetches views, and scope-guards a foreign-config view detail', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/views',
      headers: authHeader,
      payload: { name: 'get-test' },
    });
    const view = JSON.parse(createRes.body);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/views',
      headers: authHeader,
    });
    expect(listRes.statusCode).toBe(200);
    expect(JSON.parse(listRes.body).some((v: any) => v.id === view.id)).toBe(true);

    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/v1/configurations/dns-lab/views/${view.id}`,
      headers: authHeader,
    });
    expect(detailRes.statusCode).toBe(200);
    expect(JSON.parse(detailRes.body).name).toBe('get-test');

    // admin's role is scoped to dns-lab only, so a foreign config is blocked
    // at the authz gate (403) before the scope-guard 404 is reached.
    seedConfiguration('other-cfg');
    const foreignRes = await app.inject({
      method: 'GET',
      url: `/api/v1/configurations/other-cfg/views/${view.id}`,
      headers: authHeader,
    });
    expect(foreignRes.statusCode).toBe(403);
  });
});
