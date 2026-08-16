import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import { createView, createZone } from '../src/server/entityStore';

describe('Configurations API', () => {
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

  const authHeader = (token: string) => ({ authorization: `Bearer ${token}` });

  it('creates a valid configuration as admin, server-generates the id', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations',
      headers: authHeader(token),
      payload: { name: 'brand-new' },
    });
    expect(res.statusCode).toBe(201);
    const config = JSON.parse(res.body);
    expect(config.id.startsWith('cfg-')).toBe(true);
    expect(config.name).toBe('brand-new');
    expect(config.isActive).toBe(true);
    expect(config.createdFromTemplateId).toBeNull();
    expect(config.counts).toEqual({ views: 0, zones: 0, records: 0, servers: 0 });
  });

  it('rejects a configuration name with shell/zone metachars or path traversal (MUST-FAIL CONTROL)', async () => {
    const token = await loginAs('admin', 'admin');

    for (const bad of ['evil; rm -rf', '../../etc', 'has space', 'semi;colon', 'new\nline']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/configurations',
        headers: authHeader(token),
        payload: { name: bad },
      });
      expect(res.statusCode).toBe(422);
      expect(JSON.parse(res.body).error.code).toBe('INVALID_NAME');
    }
  });

  it('rejects a duplicate name with 409 CONFLICT', async () => {
    const token = await loginAs('admin', 'admin');
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations',
      headers: authHeader(token),
      payload: { name: 'dup-config' },
    });
    expect(first.statusCode).toBe(201);

    const dup = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations',
      headers: authHeader(token),
      payload: { name: 'DUP-CONFIG' }, // case-insensitive dup
    });
    expect(dup.statusCode).toBe(409);
    expect(JSON.parse(dup.body).error.code).toBe('CONFLICT');
  });

  it('rejects an explicit duplicate id with 409 CONFLICT', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations',
      headers: authHeader(token),
      payload: { name: 'custom-id', id: 'cfg-dupid' },
    });
    expect(res.statusCode).toBe(201);

    const dup = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations',
      headers: authHeader(token),
      payload: { name: 'other-name', id: 'cfg-dupid' },
    });
    expect(dup.statusCode).toBe(409);
    expect(JSON.parse(dup.body).error.code).toBe('CONFLICT');
  });

  it('returns 403 to a non-admin (viewer and editor) on create', async () => {
    createUserWithRole('usr-viewer', 'viewer', [
      { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
    ]);
    const viewerToken = await loginAs('viewer', 'password123');
    const viewerRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations',
      headers: authHeader(viewerToken),
      payload: { name: 'nope-viewer' },
    });
    expect(viewerRes.statusCode).toBe(403);

    createUserWithRole('usr-editor', 'editor', [
      { configurationId: 'dns-lab', role: 'editor', canDeploy: false },
    ]);
    const editorToken = await loginAs('editor', 'password123');
    const editorRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations',
      headers: authHeader(editorToken),
      payload: { name: 'nope-editor' },
    });
    expect(editorRes.statusCode).toBe(403);
  });

  it('patches a configuration rename; updatedAt moves; rejects an invalid name with 422', async () => {
    const token = await loginAs('admin', 'admin');
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations',
      headers: authHeader(token),
      payload: { name: 'rename-me' },
    });
    const created = JSON.parse(createRes.body);
    expect(createRes.statusCode).toBe(201);

    // Grant the actor an edit role on the new config so PATCH authorizes.
    createUserWithRole('usr-edit', 'edituser', [
      { configurationId: created.id, role: 'editor', canDeploy: false },
    ]);
    const editToken = await loginAs('edituser', 'password123');

    await new Promise((r) => setTimeout(r, 5));
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/${created.id}`,
      headers: authHeader(editToken),
      payload: { name: 'renamed-config' },
    });
    expect(patchRes.statusCode).toBe(200);
    const patched = JSON.parse(patchRes.body);
    expect(patched.name).toBe('renamed-config');
    expect(patched.id).toBe(created.id);
    expect(patched.isActive).toBe(true);
    expect(new Date(patched.updatedAt).getTime()).toBeGreaterThan(
      new Date(created.updatedAt).getTime()
    );

    const badRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/${created.id}`,
      headers: authHeader(editToken),
      payload: { name: 'bad/name' },
    });
    expect(badRes.statusCode).toBe(422);
    expect(JSON.parse(badRes.body).error.code).toBe('INVALID_NAME');
  });

  it('rejects a rename to another config name with 409 CONFLICT', async () => {
    const token = await loginAs('admin', 'admin');
    const a = JSON.parse((await app.inject({
      method: 'POST',
      url: '/api/v1/configurations',
      headers: authHeader(token),
      payload: { name: 'taken-name' },
    })).body);
    const b = JSON.parse((await app.inject({
      method: 'POST',
      url: '/api/v1/configurations',
      headers: authHeader(token),
      payload: { name: 'free-name' },
    })).body);

    createUserWithRole('usr-dup', 'dupuser', [
      { configurationId: a.id, role: 'admin', canDeploy: false },
      { configurationId: b.id, role: 'admin', canDeploy: false },
    ]);
    const dupToken = await loginAs('dupuser', 'password123');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/${b.id}`,
      headers: authHeader(dupToken),
      payload: { name: 'TAKEN-NAME' },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('CONFLICT');
  });

  it('deletes a configuration and refuses to delete the last remaining one', async () => {
    const token = await loginAs('admin', 'admin');
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations',
      headers: authHeader(token),
      payload: { name: 'doomed' },
    });
    const created = JSON.parse(createRes.body);
    expect(createRes.statusCode).toBe(201);

    // Grant an actor admin on every config currently present (created + seeded).
    const ids = (db.prepare('SELECT id FROM configurations').all() as { id: string }[]).map((r) => r.id);
    createUserWithRole('usr-del', 'deluser', ids.map((id) => ({
      configurationId: id,
      role: 'admin' as const,
      canDeploy: false,
    })));
    const delToken = await loginAs('deluser', 'password123');

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/${created.id}`,
      headers: authHeader(delToken),
    });
    expect(delRes.statusCode).toBe(200);
    expect(JSON.parse(delRes.body)).toEqual({ deleted: true });

    // Delete every remaining config except one.
    const remaining = (db.prepare('SELECT id FROM configurations').all() as { id: string }[]).map((r) => r.id);
    for (const id of remaining.slice(1)) {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/configurations/${id}`,
        headers: authHeader(delToken),
      });
      expect(res.statusCode).toBe(200);
    }

    const last = (db.prepare('SELECT id FROM configurations').all() as { id: string }[])[0];
    const lastRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/${last.id}`,
      headers: authHeader(delToken),
    });
    expect(lastRes.statusCode).toBe(409);
    expect(JSON.parse(lastRes.body).error.code).toBe('LAST_CONFIG');
  });

  it('cascades deletes of views and zones when the configuration is removed', async () => {
    const token = await loginAs('admin', 'admin');
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations',
      headers: authHeader(token),
      payload: { name: 'cascade-me' },
    });
    const created = JSON.parse(createRes.body);

    const view = createView(db, created.id, { name: 'external' });
    createZone(db, created.id, { viewId: view.id, name: 'example.com' });
    expect(listViewsFor(created.id)).toBe(1);
    expect(listZonesFor(created.id)).toBe(1);

    createUserWithRole('usr-cascade', 'cascadeuser', [
      { configurationId: created.id, role: 'admin', canDeploy: false },
    ]);
    const cascadeToken = await loginAs('cascadeuser', 'password123');

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/${created.id}`,
      headers: authHeader(cascadeToken),
    });
    expect(delRes.statusCode).toBe(200);

    expect(listViewsFor(created.id)).toBe(0);
    expect(listZonesFor(created.id)).toBe(0);
  });

  it('returns 404 on PATCH/DELETE of a non-existent configuration', async () => {
    createUserWithRole('usr-ghost', 'ghostuser', [
      { configurationId: 'ghost-config', role: 'admin', canDeploy: false },
    ]);
    const token = await loginAs('ghostuser', 'password123');

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/configurations/ghost-config',
      headers: authHeader(token),
      payload: { name: 'anything' },
    });
    expect(patchRes.statusCode).toBe(404);

    const delRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/configurations/ghost-config',
      headers: authHeader(token),
    });
    expect(delRes.statusCode).toBe(404);
  });

  function listViewsFor(configId: string): number {
    return (db.prepare('SELECT count(*) AS c FROM views WHERE configurationId = ?').get(configId) as { c: number }).c;
  }

  function listZonesFor(configId: string): number {
    return (db.prepare('SELECT count(*) AS c FROM zones WHERE configurationId = ?').get(configId) as { c: number }).c;
  }
});
