import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';

describe('Fastify app & auth routes (integration via app.inject)', () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = openDb(':memory:');
    app = buildApp(db);
  });

  describe('POST /api/v1/sessions (login)', () => {
    it('successfully logs in with correct seeded admin credentials', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: {
          username: 'admin',
          password: 'admin',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.token).toBeDefined();
      expect(typeof body.token).toBe('string');
      expect(body.expiresAt).toBeDefined();
    });

    it('rejects login with incorrect password with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: {
          username: 'admin',
          password: 'wrongpassword',
        },
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error?.code).toBe('UNAUTHORIZED');
    });

    it('rejects login with non-existent username with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: {
          username: 'nonexistent',
          password: 'password',
        },
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error?.code).toBe('UNAUTHORIZED');
    });

    it('rejects login with missing body or fields with 401', async () => {
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: {},
      });
      expect(res1.statusCode).toBe(401);

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: { username: 'admin' },
      });
      expect(res2.statusCode).toBe(401);
    });
  });

  describe('Authentication middleware (protected routes)', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error?.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when Authorization header is malformed (not Bearer)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: {
          authorization: 'Basic dXNlcjpwYXNz',
        },
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error?.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when Bearer token is empty or garbage', async () => {
      const res1 = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: {
          authorization: 'Bearer ',
        },
      });
      expect(res1.statusCode).toBe(401);

      const res2 = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: {
          authorization: 'Bearer garbage-token-12345',
        },
      });
      expect(res2.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/me', () => {
    it('returns 200 and user details for valid session token', async () => {
      // 1. Login
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: { username: 'admin', password: 'admin' },
      });
      const { token } = JSON.parse(loginRes.body);

      // 2. GET /me
      const meRes = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(meRes.statusCode).toBe(200);
      const meBody = JSON.parse(meRes.body);
      expect(meBody.username).toBe('admin');
      expect(meBody.displayName).toBe('Administrator');
      expect(meBody.viaApiKey).toBe(false);
      expect(Array.isArray(meBody.roles)).toBe(true);
      expect(meBody.roles[0]).toEqual({
        configurationId: 'dns-lab',
        role: 'admin',
        canDeploy: true,
      });
    });

    it('returns 200 with viaApiKey: true when authenticated with an API key', async () => {
      // 1. Login as admin
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: { username: 'admin', password: 'admin' },
      });
      const { token: sessionToken } = JSON.parse(loginRes.body);

      // 2. Create API key
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${sessionToken}` },
        payload: {
          name: 'Test Key',
          scopes: ['read', 'write'],
          readOnly: false,
        },
      });
      expect(createRes.statusCode).toBe(201);
      const { token: apiKeyToken } = JSON.parse(createRes.body);

      // 3. Call /me with the API key
      const meRes = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: {
          authorization: `Bearer ${apiKeyToken}`,
        },
      });

      expect(meRes.statusCode).toBe(200);
      const meBody = JSON.parse(meRes.body);
      expect(meBody.username).toBe('admin');
      expect(meBody.viaApiKey).toBe(true);
    });
  });

  describe('DELETE /api/v1/sessions/current (logout)', () => {
    it('revokes the session and subsequent requests return 401', async () => {
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: { username: 'admin', password: 'admin' },
      });
      const { token } = JSON.parse(loginRes.body);

      // Verify token works
      const beforeRes = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(beforeRes.statusCode).toBe(200);

      // Revoke session
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: '/api/v1/sessions/current',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(deleteRes.statusCode).toBe(204);

      // Verify token is no longer accepted
      const afterRes = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(afterRes.statusCode).toBe(401);
    });
  });

  describe('API keys endpoints (POST, GET, DELETE /api/v1/api-keys)', () => {
    it('creates API key, shows token once, and lists without leaking token or keyHash', async () => {
      // 1. Login
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: { username: 'admin', password: 'admin' },
      });
      const { token: sessionToken } = JSON.parse(loginRes.body);

      // 2. Create API key
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${sessionToken}` },
        payload: {
          name: 'Automation Key',
          scopes: ['read', 'deploy'],
          readOnly: false,
          expiresAt: null,
        },
      });

      expect(createRes.statusCode).toBe(201);
      const createdKey = JSON.parse(createRes.body);
      expect(createdKey.id).toMatch(/^key_/);
      expect(createdKey.name).toBe('Automation Key');
      expect(createdKey.token).toMatch(/^bnd_/);
      expect(createdKey.scopes).toEqual(['read', 'deploy']);
      expect(createdKey.readOnly).toBe(false);
      expect(createdKey.keyHash).toBeUndefined();

      // 3. GET /api/v1/api-keys
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${sessionToken}` },
      });

      expect(listRes.statusCode).toBe(200);
      const listBody = JSON.parse(listRes.body);
      expect(Array.isArray(listBody)).toBe(true);
      expect(listBody.length).toBeGreaterThanOrEqual(1);

      const found = listBody.find((k: any) => k.id === createdKey.id);
      expect(found).toBeDefined();
      expect(found.name).toBe('Automation Key');
      // Critical security check: NEVER leak token or keyHash in GET list
      expect(found.token).toBeUndefined();
      expect(found.keyHash).toBeUndefined();
    });

    it('forbids creating an API key when authenticated via an API key', async () => {
      // 1. Admin logs in and creates key 1
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: { username: 'admin', password: 'admin' },
      });
      const { token: sessionToken } = JSON.parse(loginRes.body);

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${sessionToken}` },
        payload: {
          name: 'Key 1',
          scopes: ['read', 'write'],
          readOnly: false,
        },
      });
      const { token: key1Token } = JSON.parse(createRes.body);

      // 2. Attempt to create another API key using Key 1
      const nestedCreateRes = await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${key1Token}` },
        payload: {
          name: 'Key 2',
          scopes: ['read'],
          readOnly: true,
        },
      });

      expect(nestedCreateRes.statusCode).toBe(403);
      const errBody = JSON.parse(nestedCreateRes.body);
      expect(errBody.error?.code).toBe('FORBIDDEN');
    });

    it('deletes API key by owner successfully (204)', async () => {
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: { username: 'admin', password: 'admin' },
      });
      const { token: sessionToken } = JSON.parse(loginRes.body);

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${sessionToken}` },
        payload: {
          name: 'To Delete',
          scopes: ['read'],
          readOnly: true,
        },
      });
      const { id: keyId, token: keyToken } = JSON.parse(createRes.body);

      // Delete the key
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/api-keys/${keyId}`,
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      expect(deleteRes.statusCode).toBe(204);

      // Key token can no longer authenticate
      const meRes = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: { authorization: `Bearer ${keyToken}` },
      });
      expect(meRes.statusCode).toBe(401);
    });

    it('returns 404 when deleting a non-existent API key', async () => {
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: { username: 'admin', password: 'admin' },
      });
      const { token: sessionToken } = JSON.parse(loginRes.body);

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: '/api/v1/api-keys/key_nonexistent',
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      expect(deleteRes.statusCode).toBe(404);
    });

    it('enforces deletion permissions: non-owner viewer cannot delete someone else key (403), admin can (204)', async () => {
      // Seed an additional viewer user
      const { salt: viewerSalt, hash: viewerHash } = hashPassword('viewerpass');
      const viewerRoles = JSON.stringify([{ configurationId: 'dns-lab', role: 'viewer', canDeploy: false }]);
      db.prepare(`
        INSERT INTO users (id, username, displayName, isActive, roles, pwSalt, pwHash, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('usr-viewer', 'viewer', 'Viewer User', 1, viewerRoles, viewerSalt, viewerHash, new Date().toISOString());

      // 1. Viewer logs in and creates a key
      const viewerLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: { username: 'viewer', password: 'viewerpass' },
      });
      const { token: viewerSessionToken } = JSON.parse(viewerLogin.body);

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${viewerSessionToken}` },
        payload: {
          name: 'Viewer Key',
          scopes: ['read'],
          readOnly: true,
        },
      });
      const { id: viewerKeyId } = JSON.parse(createRes.body);

      // Seed an editor user (not admin, not owner of viewer's key)
      const { salt: editorSalt, hash: editorHash } = hashPassword('editorpass');
      const editorRoles = JSON.stringify([{ configurationId: 'dns-lab', role: 'editor', canDeploy: false }]);
      db.prepare(`
        INSERT INTO users (id, username, displayName, isActive, roles, pwSalt, pwHash, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('usr-editor', 'editor', 'Editor User', 1, editorRoles, editorSalt, editorHash, new Date().toISOString());

      const editorLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: { username: 'editor', password: 'editorpass' },
      });
      const { token: editorSessionToken } = JSON.parse(editorLogin.body);

      // Editor tries to delete viewer's key -> 403
      const editorDeleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/api-keys/${viewerKeyId}`,
        headers: { authorization: `Bearer ${editorSessionToken}` },
      });
      expect(editorDeleteRes.statusCode).toBe(403);

      // Admin logs in and deletes viewer's key -> 204
      const adminLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: { username: 'admin', password: 'admin' },
      });
      const { token: adminSessionToken } = JSON.parse(adminLogin.body);

      const adminDeleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/api-keys/${viewerKeyId}`,
        headers: { authorization: `Bearer ${adminSessionToken}` },
      });
      expect(adminDeleteRes.statusCode).toBe(204);
    });

    it('forbids read-only API key from deleting resources (403)', async () => {
      // 1. Admin login and create a key
      const adminLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: { username: 'admin', password: 'admin' },
      });
      const { token: adminSessionToken } = JSON.parse(adminLogin.body);

      const targetKeyRes = await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminSessionToken}` },
        payload: { name: 'Target Key', scopes: ['read'], readOnly: false },
      });
      const { id: targetKeyId } = JSON.parse(targetKeyRes.body);

      // Create a read-only key for admin
      const roKeyRes = await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${adminSessionToken}` },
        payload: { name: 'RO Key', scopes: ['read'], readOnly: true },
      });
      const { token: roKeyToken } = JSON.parse(roKeyRes.body);

      // Attempt deletion with read-only key -> 403
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/api-keys/${targetKeyId}`,
        headers: { authorization: `Bearer ${roKeyToken}` },
      });
      expect(deleteRes.statusCode).toBe(403);
    });
  });
});
