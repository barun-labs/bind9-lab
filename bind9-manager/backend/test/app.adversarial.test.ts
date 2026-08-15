import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword, sha256 } from '../src/server/crypto';

const PAST = new Date(Date.now() - 60_000).toISOString();

type App = ReturnType<typeof buildApp>;

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function loginAdmin(app: App): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    payload: { username: 'admin', password: 'admin' },
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body).token as string;
}

function seedUser(
  db: Database.Database,
  id: string,
  username: string,
  password: string,
  role: 'viewer' | 'editor' | 'admin'
): void {
  const { salt, hash } = hashPassword(password);
  const roles = JSON.stringify([{ configurationId: 'dns-lab', role, canDeploy: role === 'admin' }]);
  db.prepare(`
    INSERT INTO users (id, username, displayName, isActive, roles, pwSalt, pwHash, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, username, username, 1, roles, salt, hash, new Date().toISOString());
}

async function loginAs(app: App, username: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    payload: { username, password },
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body).token as string;
}

describe('app adversarial (HTTP bypass matrix)', () => {
  let db: Database.Database;
  let app: App;

  beforeEach(() => {
    db = openDb(':memory:');
    app = buildApp(db);
  });

  describe('unauthenticated matrix — every protected route, every broken auth shape', () => {
    const protectedRequests = [
      { method: 'GET', url: '/api/v1/me' },
      { method: 'POST', url: '/api/v1/api-keys', payload: { name: 'x', scopes: ['read'] } },
      { method: 'GET', url: '/api/v1/api-keys' },
      { method: 'DELETE', url: '/api/v1/api-keys/key_doesnotexist' },
      { method: 'DELETE', url: '/api/v1/sessions/current' },
    ];

    const badHeaders: Array<{ name: string; value: string | undefined }> = [
      { name: 'none', value: undefined },
      { name: 'garbage bearer', value: 'Bearer garbage-token-12345' },
      { name: 'not bearer scheme', value: 'admin' },
      { name: 'basic scheme', value: 'Basic dXNlcjpwYXNz' },
      { name: 'bare Bearer', value: 'Bearer' },
      { name: 'Bearer empty token', value: 'Bearer ' },
      { name: 'empty string', value: '' },
    ];

    for (const req of protectedRequests) {
      for (const h of badHeaders) {
        it(`${req.method} ${req.url} with ${h.name} -> 401`, async () => {
          const injectOpts: any = { method: req.method, url: req.url };
          if (req.payload !== undefined) injectOpts.payload = req.payload;
          if (h.value !== undefined) injectOpts.headers = { authorization: h.value };

          const res = await app.inject(injectOpts);
          expect(res.statusCode).toBe(401);
        });
      }
    }

    it('login (POST /sessions) is the only route reachable without auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: { username: 'admin', password: 'admin' },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('login', () => {
    it('wrong password -> 401 and NO token in body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        payload: { username: 'admin', password: 'wrongpassword' },
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.token).toBeUndefined();
      expect(res.body).not.toContain('bnd_');
    });

    it('correct password -> 200 with a token that authorizes GET /me', async () => {
      const token = await loginAdmin(app);
      const me = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: bearer(token),
      });
      expect(me.statusCode).toBe(200);
      expect(JSON.parse(me.body).username).toBe('admin');
    });
  });

  describe('session lifecycle', () => {
    it('DELETE /sessions/current revokes the token (subsequent /me -> 401)', async () => {
      const token = await loginAdmin(app);
      const before = await app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(token) });
      expect(before.statusCode).toBe(200);

      const del = await app.inject({
        method: 'DELETE',
        url: '/api/v1/sessions/current',
        headers: bearer(token),
      });
      expect(del.statusCode).toBe(204);

      const after = await app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(token) });
      expect(after.statusCode).toBe(401);
    });

    it('expired session (expiresAt pushed to the past) -> 401', async () => {
      const token = await loginAdmin(app);
      db.prepare('UPDATE sessions SET expiresAt = ? WHERE tokenHash = ?').run(PAST, sha256(token));

      const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(token) });
      expect(res.statusCode).toBe(401);
    });

    it('deactivated user mid-session -> 401', async () => {
      const token = await loginAdmin(app);
      db.prepare('UPDATE users SET isActive = 0 WHERE username = ?').run('admin');

      const res = await app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(token) });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('api-key auth', () => {
    async function createKey(
      sessionToken: string,
      overrides: Record<string, unknown> = {}
    ): Promise<{ id: string; token: string }> {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: bearer(sessionToken),
        payload: { name: 'k', scopes: ['read'], readOnly: false, ...overrides },
      });
      expect(res.statusCode).toBe(201);
      return JSON.parse(res.body) as { id: string; token: string };
    }

    it('valid key authorizes GET /me with viaApiKey:true', async () => {
      const sessionToken = await loginAdmin(app);
      const key = await createKey(sessionToken);

      const me = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: bearer(key.token),
      });
      expect(me.statusCode).toBe(200);
      expect(JSON.parse(me.body).viaApiKey).toBe(true);
    });

    it('expired key -> 401', async () => {
      const sessionToken = await loginAdmin(app);
      const key = await createKey(sessionToken, { expiresAt: PAST });

      const me = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: bearer(key.token),
      });
      expect(me.statusCode).toBe(401);
    });

    it('deleted key can no longer authenticate', async () => {
      const sessionToken = await loginAdmin(app);
      const key = await createKey(sessionToken);

      const del = await app.inject({
        method: 'DELETE',
        url: `/api/v1/api-keys/${key.id}`,
        headers: bearer(sessionToken),
      });
      expect(del.statusCode).toBe(204);

      const me = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: bearer(key.token),
      });
      expect(me.statusCode).toBe(401);
    });

    it('api key cannot create another api key (403)', async () => {
      const sessionToken = await loginAdmin(app);
      const key = await createKey(sessionToken);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: bearer(key.token),
        payload: { name: 'nested', scopes: ['read'], readOnly: true },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('privilege on write-ish routes', () => {
    it('read-only key -> 403 to delete, owner session -> 204 for the same key', async () => {
      const adminToken = await loginAdmin(app);

      const target = await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: bearer(adminToken),
        payload: { name: 'target', scopes: ['read'], readOnly: false },
      });
      const targetId = (JSON.parse(target.body) as { id: string }).id;

      const ro = await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: bearer(adminToken),
        payload: { name: 'ro', scopes: ['read'], readOnly: true },
      });
      const roToken = (JSON.parse(ro.body) as { token: string }).token;

      const viaRo = await app.inject({
        method: 'DELETE',
        url: `/api/v1/api-keys/${targetId}`,
        headers: bearer(roToken),
      });
      expect(viaRo.statusCode).toBe(403);

      const viaSession = await app.inject({
        method: 'DELETE',
        url: `/api/v1/api-keys/${targetId}`,
        headers: bearer(adminToken),
      });
      expect(viaSession.statusCode).toBe(204);
    });

    it('non-owner non-admin -> 403 to delete; owner -> 204 on own key', async () => {
      seedUser(db, 'usr-viewer', 'viewer', 'viewerpass', 'viewer');
      seedUser(db, 'usr-editor', 'editor', 'editorpass', 'editor');

      const viewerToken = await loginAs(app, 'viewer', 'viewerpass');
      const editorToken = await loginAs(app, 'editor', 'editorpass');

      const viewerKey = await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: bearer(viewerToken),
        payload: { name: 'viewer key', scopes: ['read'], readOnly: true },
      });
      const viewerKeyId = (JSON.parse(viewerKey.body) as { id: string }).id;

      const editorDeletes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/api-keys/${viewerKeyId}`,
        headers: bearer(editorToken),
      });
      expect(editorDeletes.statusCode).toBe(403);

      const viewerDeletesOwn = await app.inject({
        method: 'DELETE',
        url: `/api/v1/api-keys/${viewerKeyId}`,
        headers: bearer(viewerToken),
      });
      expect(viewerDeletesOwn.statusCode).toBe(204);
    });

    it('a write-scoped api key still cannot delete another user key (api key is never admin)', async () => {
      seedUser(db, 'usr-viewer', 'viewer', 'viewerpass', 'viewer');
      const adminToken = await loginAdmin(app);
      const viewerToken = await loginAs(app, 'viewer', 'viewerpass');

      const viewerKey = await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: bearer(viewerToken),
        payload: { name: 'viewer key', scopes: ['read'], readOnly: false },
      });
      const viewerKeyId = (JSON.parse(viewerKey.body) as { id: string }).id;

      const adminKey = await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: bearer(adminToken),
        payload: { name: 'admin write key', scopes: ['read', 'write', 'deploy'], readOnly: false },
      });
      const adminKeyToken = (JSON.parse(adminKey.body) as { token: string }).token;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/api-keys/${viewerKeyId}`,
        headers: bearer(adminKeyToken),
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('secret leakage', () => {
    it('GET /api-keys body contains no "token" and no "keyHash" for any key', async () => {
      const adminToken = await loginAdmin(app);
      await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: bearer(adminToken),
        payload: { name: 'secret key', scopes: ['read', 'write', 'deploy'], readOnly: false },
      });

      const list = await app.inject({
        method: 'GET',
        url: '/api/v1/api-keys',
        headers: bearer(adminToken),
      });
      expect(list.statusCode).toBe(200);
      expect(list.body).not.toContain('"token"');
      expect(list.body).not.toContain('"keyHash"');

      for (const key of JSON.parse(list.body) as Record<string, unknown>[]) {
        expect(key.token).toBeUndefined();
        expect(key.keyHash).toBeUndefined();
      }
    });

    it('POST /api-keys returns the token exactly once', async () => {
      const adminToken = await loginAdmin(app);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: bearer(adminToken),
        payload: { name: 'once', scopes: ['read'], readOnly: true },
      });
      expect(res.statusCode).toBe(201);
      const token = (JSON.parse(res.body) as { token: string }).token;
      expect(token).toMatch(/^bnd_[0-9a-f]{64}$/);
      const occurrences = res.body.split(token).length - 1;
      expect(occurrences).toBe(1);
    });

    it('a viewer cannot list admin keys (owner scoping)', async () => {
      seedUser(db, 'usr-viewer', 'viewer', 'viewerpass', 'viewer');
      const adminToken = await loginAdmin(app);
      await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: bearer(adminToken),
        payload: { name: 'admin key', scopes: ['read'], readOnly: false },
      });

      const viewerToken = await loginAs(app, 'viewer', 'viewerpass');
      const list = await app.inject({
        method: 'GET',
        url: '/api/v1/api-keys',
        headers: bearer(viewerToken),
      });
      expect(list.statusCode).toBe(200);
      expect(JSON.parse(list.body)).toEqual([]);
    });
  });

  describe('injection & robustness — never a 500, no unhandled throw', () => {
    it('SQL-ish username and password do not crash and do not log in', async () => {
      const injections = [
        "admin'; DROP TABLE users;--",
        "'; DELETE FROM sessions;--",
        "admin' OR '1'='1",
        'admin" OR "1"="1 --',
      ];
      for (const uname of injections) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/sessions',
          payload: { username: uname, password: 'pw' },
        });
        expect(res.statusCode).toBe(401);
      }
      const count = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
      expect(count).toBe(1);
    });

    it('missing body -> 401 (not 500)', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/sessions' });
      expect(res.statusCode).toBe(401);
    });

    it('non-string username (object / array / number) -> 401 (not 500)', async () => {
      for (const username of [{}, [], 42]) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/sessions',
          payload: { username, password: 'x' },
        });
        expect(res.statusCode).toBe(401);
      }
    });

    it('wrong content-type (text/plain) -> 4xx (not 500)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        headers: { 'content-type': 'text/plain' },
        payload: 'username=admin&password=admin',
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
    });

    it('malformed JSON body -> 4xx (not 500)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        headers: { 'content-type': 'application/json' },
        payload: '{"username": "admin", "password": ',
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
    });

    it('huge body -> 4xx (not 500, no unhandled throw)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        headers: { 'content-type': 'application/json' },
        payload: 'x'.repeat(2_000_000),
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
    });

    it('create api-key with garbage scopes / non-array scopes -> 400 (not 500)', async () => {
      const adminToken = await loginAdmin(app);

      const nonArray = await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: bearer(adminToken),
        payload: { name: 'x', scopes: 'read' },
      });
      expect(nonArray.statusCode).toBe(400);

      const missingName = await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: bearer(adminToken),
        payload: { scopes: ['read'] },
      });
      expect(missingName.statusCode).toBe(400);
    });

    it('DELETE api-key with a malicious id does not crash and is not found', async () => {
      const adminToken = await loginAdmin(app);
      const res = await app.inject({
        method: 'DELETE',
        url: "/api/v1/api-keys/' OR '1'='1",
        headers: bearer(adminToken),
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
