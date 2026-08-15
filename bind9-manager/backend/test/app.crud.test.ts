import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import { createApiKey } from '../src/server/authStore';

describe('CRUD routes & permission enforcement (Unit B)', () => {
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

  // --- HAPPY PATH INTEGRATION SUITE ---
  describe('Happy path CRUD operations (Admin user)', () => {
    it('full CRUD lifecycle: list configs, list zones, get zone, create record, get records, patch record, delete record, patch zone, delete zone, list external hosts', async () => {
      const token = await loginAs('admin', 'admin');
      const authHeader = { authorization: `Bearer ${token}` };

      // 1. GET /api/v1/configurations
      const configsRes = await app.inject({
        method: 'GET',
        url: '/api/v1/configurations',
        headers: authHeader,
      });
      expect(configsRes.statusCode).toBe(200);
      const configsBody = JSON.parse(configsRes.body);
      expect(configsBody.data).toBeDefined();
      expect(Array.isArray(configsBody.data)).toBe(true);
      expect(configsBody.total).toBeGreaterThanOrEqual(1);
      const configIds = configsBody.data.map((c: any) => c.id);
      expect(configIds).toContain('dns-lab');

      // 2. GET /api/v1/configurations/dns-lab/zones
      const zonesRes = await app.inject({
        method: 'GET',
        url: '/api/v1/configurations/dns-lab/zones',
        headers: authHeader,
      });
      expect(zonesRes.statusCode).toBe(200);
      const zonesBody = JSON.parse(zonesRes.body);
      expect(zonesBody.data.length).toBe(8);
      expect(zonesBody.total).toBe(8);
      expect(zonesBody.page).toBe(1);

      // Filtering and sorting on zones
      const filteredZonesRes = await app.inject({
        method: 'GET',
        url: '/api/v1/configurations/dns-lab/zones?type=PRIMARY&q=lab',
        headers: authHeader,
      });
      expect(filteredZonesRes.statusCode).toBe(200);
      const filteredZonesBody = JSON.parse(filteredZonesRes.body);
      expect(filteredZonesBody.data.length).toBeGreaterThan(0);
      for (const z of filteredZonesBody.data) {
        expect(z.type).toBe('PRIMARY');
        expect(z.name).toContain('lab');
      }

      // 3. GET /api/v1/zones/zone-lab
      const zoneRes = await app.inject({
        method: 'GET',
        url: '/api/v1/zones/zone-lab',
        headers: authHeader,
      });
      expect(zoneRes.statusCode).toBe(200);
      const zoneBody = JSON.parse(zoneRes.body);
      expect(zoneBody.id).toBe('zone-lab');
      expect(zoneBody.name).toBe('lab.lun.net');
      expect(zoneBody.configurationId).toBe('dns-lab');

      // 4. GET /api/v1/zones/zone-lab/records (initial list)
      const recordsBeforeRes = await app.inject({
        method: 'GET',
        url: '/api/v1/zones/zone-lab/records?page=1&size=100',
        headers: authHeader,
      });
      expect(recordsBeforeRes.statusCode).toBe(200);
      const initialCount = JSON.parse(recordsBeforeRes.body).total;

      // 5. POST /api/v1/zones/zone-lab/records (Create new record)
      const newRecordPayload = {
        name: 'web-test.lab.lun.net.',
        type: 'A',
        ttl: 300,
        rdata: { address: '10.0.0.99' },
        disabled: false,
      };
      const createRecRes = await app.inject({
        method: 'POST',
        url: '/api/v1/zones/zone-lab/records',
        headers: authHeader,
        payload: newRecordPayload,
      });
      expect(createRecRes.statusCode).toBe(201);
      const createdRecord = JSON.parse(createRecRes.body);
      expect(createdRecord.id).toBeDefined();
      expect(createdRecord.name).toBe('web-test.lab.lun.net.');
      expect(createdRecord.zoneId).toBe('zone-lab');
      expect(createdRecord.type).toBe('A');
      expect(createdRecord.rdata).toEqual({ address: '10.0.0.99' });

      // Verify newly created record appears in list
      const recordsAfterRes = await app.inject({
        method: 'GET',
        url: '/api/v1/zones/zone-lab/records?q=web-test',
        headers: authHeader,
      });
      expect(recordsAfterRes.statusCode).toBe(200);
      const searchBody = JSON.parse(recordsAfterRes.body);
      expect(searchBody.total).toBe(1);
      expect(searchBody.data[0].id).toBe(createdRecord.id);

      // 6. PATCH /api/v1/records/:id (Update record)
      const patchRecRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/records/${createdRecord.id}`,
        headers: authHeader,
        payload: {
          ttl: 600,
          disabled: true,
          rdata: { address: '10.0.0.100' },
        },
      });
      expect(patchRecRes.statusCode).toBe(200);
      const patchedRecord = JSON.parse(patchRecRes.body);
      expect(patchedRecord.ttl).toBe(600);
      expect(patchedRecord.disabled).toBe(true);
      expect(patchedRecord.rdata.address).toBe('10.0.0.100');

      // 7. DELETE /api/v1/records/:id (Delete record)
      const deleteRecRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/records/${createdRecord.id}`,
        headers: authHeader,
      });
      expect(deleteRecRes.statusCode).toBe(200);
      expect(JSON.parse(deleteRecRes.body)).toEqual({ deleted: true });

      // Verify record is gone
      const recordsFinalRes = await app.inject({
        method: 'GET',
        url: '/api/v1/zones/zone-lab/records?page=1&size=100',
        headers: authHeader,
      });
      expect(JSON.parse(recordsFinalRes.body).total).toBe(initialCount);

      // 8. PATCH /api/v1/zones/:zoneId (Update zone)
      const patchZoneRes = await app.inject({
        method: 'PATCH',
        url: '/api/v1/zones/zone-lab',
        headers: authHeader,
        payload: {
          soa: { adminEmail: 'admin-updated@lab.lun.net.' },
          allowTransfer: ['10.0.0.2'],
        },
      });
      expect(patchZoneRes.statusCode).toBe(200);
      const patchedZone = JSON.parse(patchZoneRes.body);
      expect(patchedZone.soa.adminEmail).toBe('admin-updated@lab.lun.net.');
      expect(patchedZone.allowTransfer).toEqual(['10.0.0.2']);

      // 9. DELETE /api/v1/zones/:zoneId (Delete zone returns {deleted: true, dependents: n})
      const deleteZoneRes = await app.inject({
        method: 'DELETE',
        url: '/api/v1/zones/zone-lab',
        headers: authHeader,
      });
      expect(deleteZoneRes.statusCode).toBe(200);
      const deleteZoneBody = JSON.parse(deleteZoneRes.body);
      expect(deleteZoneBody.deleted).toBe(true);
      expect(deleteZoneBody.dependents).toBe(40); // 40 seeded records in zone-lab

      // 10. GET /api/v1/configurations/dns-lab/external-hosts
      const extHostsRes = await app.inject({
        method: 'GET',
        url: '/api/v1/configurations/dns-lab/external-hosts',
        headers: authHeader,
      });
      expect(extHostsRes.statusCode).toBe(200);
      const extHostsBody = JSON.parse(extHostsRes.body);
      expect(extHostsBody.data).toBeDefined();
      expect(extHostsBody.total).toBe(4);
      expect(extHostsBody.data.map((h: any) => h.fqdn)).toContain('edge.lab.lun.net');
    });
  });

  // --- UNAUTHENTICATED REQUESTS (401) ---
  describe('Unauthenticated requests (401)', () => {
    const crudEndpoints: Array<{ method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; payload?: any }> = [
      { method: 'GET', url: '/api/v1/configurations' },
      { method: 'GET', url: '/api/v1/configurations/dns-lab/zones' },
      { method: 'GET', url: '/api/v1/zones/zone-lab' },
      { method: 'PATCH', url: '/api/v1/zones/zone-lab', payload: { name: 'test' } },
      { method: 'DELETE', url: '/api/v1/zones/zone-lab' },
      { method: 'GET', url: '/api/v1/zones/zone-lab/records' },
      { method: 'POST', url: '/api/v1/zones/zone-lab/records', payload: { name: 'x', type: 'A', rdata: {} } },
      { method: 'PATCH', url: '/api/v1/records/rec-1', payload: { ttl: 300 } },
      { method: 'DELETE', url: '/api/v1/records/rec-1' },
      { method: 'GET', url: '/api/v1/configurations/dns-lab/external-hosts' },
    ];

    it.each(crudEndpoints)('returns 401 for unauthenticated $method $url', async ({ method, url, payload }) => {
      const res = await app.inject({
        method,
        url,
        payload,
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error?.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 with invalid bearer token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/configurations',
        headers: { authorization: 'Bearer bad_token_123' },
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error?.code).toBe('UNAUTHORIZED');
    });
  });

  // --- PERMISSION ENFORCEMENT & ROLES (403) ---
  describe('Permission enforcement (RBAC & Scopes)', () => {
    it('viewer user can view configurations/zones/records/external-hosts but gets 403 on all mutations', async () => {
      createUserWithRole('usr-viewer', 'viewer1', [
        { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
      ]);
      const token = await loginAs('viewer1', 'password123');
      const authHeader = { authorization: `Bearer ${token}` };

      // Viewer CAN read
      const getConfigs = await app.inject({ method: 'GET', url: '/api/v1/configurations', headers: authHeader });
      expect(getConfigs.statusCode).toBe(200);

      const getZones = await app.inject({ method: 'GET', url: '/api/v1/configurations/dns-lab/zones', headers: authHeader });
      expect(getZones.statusCode).toBe(200);

      const getZone = await app.inject({ method: 'GET', url: '/api/v1/zones/zone-lab', headers: authHeader });
      expect(getZone.statusCode).toBe(200);

      const getRecords = await app.inject({ method: 'GET', url: '/api/v1/zones/zone-lab/records', headers: authHeader });
      expect(getRecords.statusCode).toBe(200);

      const getExtHosts = await app.inject({ method: 'GET', url: '/api/v1/configurations/dns-lab/external-hosts', headers: authHeader });
      expect(getExtHosts.statusCode).toBe(200);

      // Viewer CANNOT mutate
      const patchZone = await app.inject({
        method: 'PATCH',
        url: '/api/v1/zones/zone-lab',
        headers: authHeader,
        payload: { name: 'hacked.net' },
      });
      expect(patchZone.statusCode).toBe(403);
      expect(JSON.parse(patchZone.body).error?.code).toBe('FORBIDDEN');

      const deleteZone = await app.inject({
        method: 'DELETE',
        url: '/api/v1/zones/zone-lab',
        headers: authHeader,
      });
      expect(deleteZone.statusCode).toBe(403);
      expect(JSON.parse(deleteZone.body).error?.code).toBe('FORBIDDEN');

      const postRecord = await app.inject({
        method: 'POST',
        url: '/api/v1/zones/zone-lab/records',
        headers: authHeader,
        payload: { name: 'unauth.lab.lun.net.', type: 'A', rdata: { address: '1.2.3.4' } },
      });
      expect(postRecord.statusCode).toBe(403);
      expect(JSON.parse(postRecord.body).error?.code).toBe('FORBIDDEN');

      const patchRecord = await app.inject({
        method: 'PATCH',
        url: '/api/v1/records/rec-1',
        headers: authHeader,
        payload: { ttl: 999 },
      });
      expect(patchRecord.statusCode).toBe(403);
      expect(JSON.parse(patchRecord.body).error?.code).toBe('FORBIDDEN');

      const deleteRecord = await app.inject({
        method: 'DELETE',
        url: '/api/v1/records/rec-1',
        headers: authHeader,
      });
      expect(deleteRecord.statusCode).toBe(403);
      expect(JSON.parse(deleteRecord.body).error?.code).toBe('FORBIDDEN');
    });

    it('cross-configuration isolation: user with role on dns-lab cannot view or edit split-horizon', async () => {
      createUserWithRole('usr-labonly', 'labonly', [
        { configurationId: 'dns-lab', role: 'editor', canDeploy: false },
      ]);
      const token = await loginAs('labonly', 'password123');
      const authHeader = { authorization: `Bearer ${token}` };

      // GET /configurations only returns dns-lab
      const configsRes = await app.inject({ method: 'GET', url: '/api/v1/configurations', headers: authHeader });
      const configs = JSON.parse(configsRes.body).data;
      expect(configs.map((c: any) => c.id)).toEqual(['dns-lab']);

      // Direct access to split-horizon -> 403
      const splitZones = await app.inject({
        method: 'GET',
        url: '/api/v1/configurations/split-horizon/zones',
        headers: authHeader,
      });
      expect(splitZones.statusCode).toBe(403);
      expect(JSON.parse(splitZones.body).error?.code).toBe('FORBIDDEN');

      const splitExtHosts = await app.inject({
        method: 'GET',
        url: '/api/v1/configurations/split-horizon/external-hosts',
        headers: authHeader,
      });
      expect(splitExtHosts.statusCode).toBe(403);
      expect(JSON.parse(splitExtHosts.body).error?.code).toBe('FORBIDDEN');
    });

    it('read-only API key cannot perform mutations (returns 403)', async () => {
      const { token } = createApiKey(db, 'usr-admin', {
        name: 'readonly-key',
        scopes: ['read'],
        readOnly: true,
      });
      const keyHeader = { authorization: `Bearer ${token}` };

      // Read works
      const zonesRes = await app.inject({
        method: 'GET',
        url: '/api/v1/configurations/dns-lab/zones',
        headers: keyHeader,
      });
      expect(zonesRes.statusCode).toBe(200);

      // Write is blocked by readOnly / scopes
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/zones/zone-lab/records',
        headers: keyHeader,
        payload: { name: 'blocked.lab.lun.net.', type: 'A', rdata: { address: '1.2.3.4' } },
      });
      expect(createRes.statusCode).toBe(403);
      expect(JSON.parse(createRes.body).error?.code).toBe('FORBIDDEN');

      const patchRes = await app.inject({
        method: 'PATCH',
        url: '/api/v1/zones/zone-lab',
        headers: keyHeader,
        payload: { name: 'blocked' },
      });
      expect(patchRes.statusCode).toBe(403);
      expect(JSON.parse(patchRes.body).error?.code).toBe('FORBIDDEN');
    });

    it('read+write API key can perform read and edit mutations', async () => {
      const { token } = createApiKey(db, 'usr-admin', {
        name: 'readwrite-key',
        scopes: ['read', 'write'],
        readOnly: false,
      });
      const keyHeader = { authorization: `Bearer ${token}` };

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/zones/zone-lab/records',
        headers: keyHeader,
        payload: { name: 'rw-key.lab.lun.net.', type: 'TXT', rdata: { text: 'hello' } },
      });
      expect(createRes.statusCode).toBe(201);
      const rec = JSON.parse(createRes.body);

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/records/${rec.id}`,
        headers: keyHeader,
      });
      expect(deleteRes.statusCode).toBe(200);
    });
  });

  // --- DEFERRED UNIT-C FIXES ---
  describe('Deferred Unit-C fixes verification', () => {
    it('DELETE /api/v1/sessions/current returns 400 NOT_A_SESSION when presenting bearer is an API key', async () => {
      const { token } = createApiKey(db, 'usr-admin', {
        name: 'test-key',
        scopes: ['read', 'write'],
        readOnly: false,
      });

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/sessions/current',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error?.code).toBe('NOT_A_SESSION');
    });

    it('GET /api/v1/api-keys never returns token or keyHash', async () => {
      const token = await loginAs('admin', 'admin');
      const authHeader = { authorization: `Bearer ${token}` };

      // Create a key
      await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: authHeader,
        payload: { name: 'secret-check-key', scopes: ['read'], readOnly: true },
      });

      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/api-keys',
        headers: authHeader,
      });
      expect(listRes.statusCode).toBe(200);
      const keys = JSON.parse(listRes.body);
      expect(keys.length).toBeGreaterThan(0);
      for (const k of keys) {
        expect(k.token).toBeUndefined();
        expect(k.keyHash).toBeUndefined();
        expect(k.id).toBeDefined();
        expect(k.name).toBeDefined();
      }
    });

    it('safeParseJson gracefully handles corrupted JSON in api_keys scopes column', async () => {
      const { token, id } = createApiKey(db, 'usr-admin', {
        name: 'corrupted-scopes',
        scopes: ['read'],
        readOnly: false,
      });

      // Manually corrupt scopes JSON in DB
      db.prepare('UPDATE api_keys SET scopes = ? WHERE id = ?').run('INVALID_JSON{', id);

      const adminToken = await loginAs('admin', 'admin');
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(listRes.statusCode).toBe(200);
      const keys = JSON.parse(listRes.body);
      const corruptedKey = keys.find((k: any) => k.id === id);
      expect(corruptedKey).toBeDefined();
      expect(corruptedKey.scopes).toEqual([]); // Fallback to empty array
    });
  });

  // --- NOT FOUND & VALIDATION ERRORS ---
  describe('Not found and input validation error handling', () => {
    it('returns 404 for non-existent zone', async () => {
      const token = await loginAs('admin', 'admin');
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/zones/non-existent-zone',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error?.code).toBe('NOT_FOUND');
    });

    it('returns 404 for non-existent record update/delete', async () => {
      const token = await loginAs('admin', 'admin');
      const patchRes = await app.inject({
        method: 'PATCH',
        url: '/api/v1/records/non-existent-rec',
        headers: { authorization: `Bearer ${token}` },
        payload: { ttl: 300 },
      });
      expect(patchRes.statusCode).toBe(404);
      expect(JSON.parse(patchRes.body).error?.code).toBe('NOT_FOUND');

      const delRes = await app.inject({
        method: 'DELETE',
        url: '/api/v1/records/non-existent-rec',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(delRes.statusCode).toBe(404);
      expect(JSON.parse(delRes.body).error?.code).toBe('NOT_FOUND');
    });

    it('returns 400 for invalid record creation payload', async () => {
      const token = await loginAs('admin', 'admin');
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/zones/zone-lab/records',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 123 }, // missing type and invalid name
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error?.code).toBe('BAD_REQUEST');
    });
  });
});
