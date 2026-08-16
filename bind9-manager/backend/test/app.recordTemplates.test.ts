import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import type { RecordTemplateEntry } from '../../shared/entities';
import {
  createRecordTemplate,
  createView,
  createZone,
  listRecords,
  getZone,
} from '../src/server/entityStore';

describe('Record Templates API', () => {
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

  function seedZone(configId: string, name: string): string {
    const view = createView(db, configId, { name: `view-${name}` });
    const zone = createZone(db, configId, { viewId: view.id, name });
    return zone.id;
  }

  const entries: RecordTemplateEntry[] = [
    { name: '@', type: 'A', ttl: 300, rdata: { address: '192.0.2.1' } },
    { name: 'www', type: 'CNAME', rdata: { target: 'example.com.' } },
  ];

  it('creates a valid template with 2 entries, server-generates the id', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/record-templates',
      headers: { authorization: `Bearer ${token}` },
      payload: { id: 'rt-evil', name: 'web-records', description: '  Web records  ', entries },
    });
    expect(res.statusCode).toBe(201);
    const template = JSON.parse(res.body);
    expect(template.id.startsWith('rt-')).toBe(true);
    expect(template.id).not.toBe('rt-evil');
    expect(template.configurationId).toBe('dns-lab');
    expect(template.name).toBe('web-records');
    expect(template.description).toBe('Web records');
    expect(template.entries).toEqual(entries);
  });

  it('rejects a template name with metachar/traversal (MUST-FAIL CONTROL)', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    for (const bad of ['../evil', 'a;b', 'has space', 'tpl/name']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/configurations/dns-lab/record-templates',
        headers: authHeader,
        payload: { name: bad },
      });
      expect(res.statusCode).toBe(422);
      expect(JSON.parse(res.body).error.code).toBe('INVALID_NAME');
    }
  });

  it('rejects a template whose entry.name has a metachar/traversal (MUST-FAIL CONTROL)', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    for (const badName of ['../../etc', 'www; rm', 'has space', '..']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/configurations/dns-lab/record-templates',
        headers: authHeader,
        payload: { name: 'ok-name', entries: [{ name: badName, type: 'A', rdata: { address: '192.0.2.1' } }] },
      });
      expect(res.statusCode).toBe(422);
      expect(JSON.parse(res.body).error.code).toBe('INVALID_ENTRY');
    }
  });

  it('rejects a template entry with an invalid type (MUST-FAIL CONTROL)', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/record-templates',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'ok-name', entries: [{ name: '@', type: 'BOGUS', rdata: {} }] },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_ENTRY');
  });

  it('lists and gets a single template; isolates scope across configs', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/record-templates',
      headers: authHeader,
      payload: { name: 'listed-tpl', entries },
    });
    const template = JSON.parse(createRes.body);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/record-templates',
      headers: authHeader,
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = JSON.parse(listRes.body);
    expect(listBody.some((t: any) => t.id === template.id && t.name === 'listed-tpl')).toBe(true);

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/configurations/dns-lab/record-templates/${template.id}`,
      headers: authHeader,
    });
    expect(getRes.statusCode).toBe(200);
    const got = JSON.parse(getRes.body);
    expect(got.id).toBe(template.id);
    expect(got.entries).toEqual(entries);

    // Cross-config scope isolation: a dual user reading the template via config-b gets 404.
    seedConfiguration('config-b');
    createUserWithRole('usr-dual', 'dual', [
      { configurationId: 'dns-lab', role: 'editor', canDeploy: false },
      { configurationId: 'config-b', role: 'editor', canDeploy: false },
    ]);
    const dualToken = await loginAs('dual', 'password123');
    const otherRes = await app.inject({
      method: 'GET',
      url: `/api/v1/configurations/config-b/record-templates/${template.id}`,
      headers: { authorization: `Bearer ${dualToken}` },
    });
    expect(otherRes.statusCode).toBe(404);
  });

  it('patches name and entries; rejects a bad name with 422', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/record-templates',
      headers: authHeader,
      payload: { name: 'old-tpl', entries },
    });
    const template = JSON.parse(createRes.body);

    const newEntries = [
      { name: 'mail', type: 'MX', rdata: { priority: 10, target: 'mail.example.com.' } },
    ];
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/dns-lab/record-templates/${template.id}`,
      headers: authHeader,
      payload: { name: 'new-tpl', entries: newEntries },
    });
    expect(patchRes.statusCode).toBe(200);
    const patched = JSON.parse(patchRes.body);
    expect(patched.name).toBe('new-tpl');
    expect(patched.entries).toEqual(newEntries);
    expect(patched.id).toBe(template.id);
    expect(patched.configurationId).toBe('dns-lab');

    const badRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/dns-lab/record-templates/${template.id}`,
      headers: authHeader,
      payload: { name: 'bad..name; rm' },
    });
    expect(badRes.statusCode).toBe(422);
    expect(JSON.parse(badRes.body).error.code).toBe('INVALID_NAME');
  });

  it('deletes a template; then GET returns 404', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/record-templates',
      headers: authHeader,
      payload: { name: 'gone-tpl' },
    });
    const template = JSON.parse(createRes.body);

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/dns-lab/record-templates/${template.id}`,
      headers: authHeader,
    });
    expect(delRes.statusCode).toBe(200);
    expect(JSON.parse(delRes.body)).toEqual({ deleted: true });

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/configurations/dns-lab/record-templates/${template.id}`,
      headers: authHeader,
    });
    expect(getRes.statusCode).toBe(404);
  });

  it('applies a template to a zone in the same config, creating one record per entry', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/record-templates',
      headers: authHeader,
      payload: { name: 'apply-tpl', entries },
    });
    const template = JSON.parse(createRes.body);

    const zoneId = seedZone('dns-lab', 'example.com');
    const before = getZone(db, zoneId)!.recordCount;

    const applyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/configurations/dns-lab/record-templates/${template.id}/apply`,
      headers: authHeader,
      payload: { zoneId },
    });
    expect(applyRes.statusCode).toBe(201);
    const { created } = JSON.parse(applyRes.body);
    expect(created.length).toBe(entries.length);

    const records = listRecords(db, zoneId).data;
    expect(records.length).toBe(entries.length);
    expect(records.map((r) => r.name).sort()).toEqual(entries.map((e) => e.name).sort());
    expect(records.map((r) => r.type).sort()).toEqual(entries.map((e) => e.type).sort());

    const after = getZone(db, zoneId)!.recordCount;
    expect(after).toBe(before + entries.length);
  });

  it('refuses to apply across configurations (MUST-FAIL CONTROL — cross-config injection guard)', async () => {
    seedConfiguration('config-b');
    createUserWithRole('usr-dual', 'dual', [
      { configurationId: 'dns-lab', role: 'editor', canDeploy: false },
      { configurationId: 'config-b', role: 'editor', canDeploy: false },
    ]);
    const token = await loginAs('dual', 'password123');
    const authHeader = { authorization: `Bearer ${token}` };

    const template = createRecordTemplate(db, 'dns-lab', { name: 'scope-tpl', entries });
    const foreignZoneId = seedZone('config-b', 'other.example');

    const applyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/configurations/dns-lab/record-templates/${template.id}/apply`,
      headers: authHeader,
      payload: { zoneId: foreignZoneId },
    });
    expect(applyRes.statusCode).toBe(422);
    expect(JSON.parse(applyRes.body).error.code).toBe('ZONE_NOT_IN_CONFIG');
    expect(listRecords(db, foreignZoneId).data.length).toBe(0);
  });

  it('returns 403 to a view-only actor on create, patch, delete and apply', async () => {
    createUserWithRole('usr-viewer', 'viewer', [
      { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
    ]);
    const token = await loginAs('viewer', 'password123');
    const authHeader = { authorization: `Bearer ${token}` };

    const postRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/record-templates',
      headers: authHeader,
      payload: { name: 'nope' },
    });
    expect(postRes.statusCode).toBe(403);

    const template = createRecordTemplate(db, 'dns-lab', { name: 'admin-tpl', entries });
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/configurations/dns-lab/record-templates/${template.id}`,
      headers: authHeader,
      payload: { name: 'nope' },
    });
    expect(patchRes.statusCode).toBe(403);

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/configurations/dns-lab/record-templates/${template.id}`,
      headers: authHeader,
    });
    expect(delRes.statusCode).toBe(403);

    const applyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/configurations/dns-lab/record-templates/${template.id}/apply`,
      headers: authHeader,
      payload: { zoneId: 'zone-x' },
    });
    expect(applyRes.statusCode).toBe(403);
  });

  it('returns 404 on patch, delete and apply of a non-existent template', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };
    const zoneId = seedZone('dns-lab', 'missing.example');

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/configurations/dns-lab/record-templates/rt-doesnotexist',
      headers: authHeader,
      payload: { name: 'x' },
    });
    expect(patchRes.statusCode).toBe(404);

    const delRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/configurations/dns-lab/record-templates/rt-doesnotexist',
      headers: authHeader,
    });
    expect(delRes.statusCode).toBe(404);

    const applyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/record-templates/rt-doesnotexist/apply',
      headers: authHeader,
      payload: { zoneId },
    });
    expect(applyRes.statusCode).toBe(404);
  });
});
