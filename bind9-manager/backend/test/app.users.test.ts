import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import type { RoleAssignment } from '../../shared/entities';

describe('Users API', () => {
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

  function createUserWithRole(userId: string, username: string, roles: RoleAssignment[]): void {
    const { salt, hash } = hashPassword('password123');
    db.prepare(`
      INSERT INTO users (id, username, displayName, isActive, roles, pwSalt, pwHash, createdAt)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?)
    `).run(userId, username, username, JSON.stringify(roles), salt, hash, new Date().toISOString());
  }

  const authHeader = (token: string) => ({ authorization: `Bearer ${token}` });

  it('creates a valid user as admin; id starts usr-; response has no secret fields (MUST-FAIL CONTROL)', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: authHeader(token),
      payload: { username: 'newbie', displayName: 'New Bie', password: 'correct-horse-battery' },
    });
    expect(res.statusCode).toBe(201);
    const user = JSON.parse(res.body);
    expect(user.id.startsWith('usr-')).toBe(true);
    expect(user.username).toBe('newbie');
    expect(user.displayName).toBe('New Bie');
    expect(user.isActive).toBe(true);
    expect(user.roles).toEqual([]);
    expect(user).not.toHaveProperty('pwHash');
    expect(user).not.toHaveProperty('pwSalt');
    expect(user).not.toHaveProperty('password');
  });

  it('rejects a weak password with 422 WEAK_PASSWORD (MUST-FAIL CONTROL)', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: authHeader(token),
      payload: { username: 'weakpw', displayName: 'Weak Pw', password: 'short' },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('WEAK_PASSWORD');
  });

  it('rejects a bad username charset with 422 INVALID_USERNAME (MUST-FAIL CONTROL)', async () => {
    const token = await loginAs('admin', 'admin');
    for (const bad of ['a b', '../x', 'a;b']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: authHeader(token),
        payload: { username: bad, displayName: 'Bad User', password: 'correct-horse-battery' },
      });
      expect(res.statusCode).toBe(422);
      expect(JSON.parse(res.body).error.code).toBe('INVALID_USERNAME');
    }
  });

  it('rejects a duplicate username with 409 CONFLICT', async () => {
    const token = await loginAs('admin', 'admin');
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: authHeader(token),
      payload: { username: 'dupuser', displayName: 'Dup User', password: 'correct-horse-battery' },
    });
    expect(first.statusCode).toBe(201);

    const dup = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: authHeader(token),
      payload: { username: 'dupuser', displayName: 'Dup User Again', password: 'correct-horse-battery' },
    });
    expect(dup.statusCode).toBe(409);
    expect(JSON.parse(dup.body).error.code).toBe('CONFLICT');
  });

  it('rejects a role referencing a non-existent configuration with 422 INVALID_ROLE', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: authHeader(token),
      payload: {
        username: 'badrole',
        displayName: 'Bad Role',
        password: 'correct-horse-battery',
        roles: [{ configurationId: 'no-such-config', role: 'viewer', canDeploy: false }],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_ROLE');
  });

  it('returns 403 to a non-admin (viewer and editor) on POST/PATCH/DELETE/GET list (MUST-FAIL CONTROL)', async () => {
    createUserWithRole('usr-viewer', 'viewer', [
      { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
    ]);
    createUserWithRole('usr-editor', 'editor', [
      { configurationId: 'dns-lab', role: 'editor', canDeploy: false },
    ]);
    const viewerToken = await loginAs('viewer', 'password123');
    const editorToken = await loginAs('editor', 'password123');

    for (const token of [viewerToken, editorToken]) {
      const listRes = await app.inject({ method: 'GET', url: '/api/v1/users', headers: authHeader(token) });
      expect(listRes.statusCode).toBe(403);

      const postRes = await app.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: authHeader(token),
        payload: { username: 'nope', displayName: 'Nope', password: 'correct-horse-battery' },
      });
      expect(postRes.statusCode).toBe(403);

      const patchRes = await app.inject({
        method: 'PATCH',
        url: '/api/v1/users/usr-viewer',
        headers: authHeader(token),
        payload: { displayName: 'Nope' },
      });
      expect(patchRes.statusCode).toBe(403);

      const delRes = await app.inject({
        method: 'DELETE',
        url: '/api/v1/users/usr-viewer',
        headers: authHeader(token),
      });
      expect(delRes.statusCode).toBe(403);
    }
  });

  it('lists all users (seeded + created), all secret-free; GET :id 404 for unknown', async () => {
    const token = await loginAs('admin', 'admin');
    await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: authHeader(token),
      payload: { username: 'listed', displayName: 'Listed User', password: 'correct-horse-battery' },
    });

    const listRes = await app.inject({ method: 'GET', url: '/api/v1/users', headers: authHeader(token) });
    expect(listRes.statusCode).toBe(200);
    const users = JSON.parse(listRes.body);
    expect(users.some((u: any) => u.username === 'admin')).toBe(true);
    expect(users.some((u: any) => u.username === 'listed')).toBe(true);
    for (const u of users) {
      expect(u).not.toHaveProperty('pwHash');
      expect(u).not.toHaveProperty('pwSalt');
      expect(u).not.toHaveProperty('password');
    }

    const notFoundRes = await app.inject({
      method: 'GET',
      url: '/api/v1/users/usr-does-not-exist',
      headers: authHeader(token),
    });
    expect(notFoundRes.statusCode).toBe(404);
  });

  it('patches displayName and roles; 200 reflects the change', async () => {
    const token = await loginAs('admin', 'admin');
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: authHeader(token),
      payload: { username: 'patchme', displayName: 'Patch Me', password: 'correct-horse-battery' },
    });
    const created = JSON.parse(createRes.body);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${created.id}`,
      headers: authHeader(token),
      payload: {
        displayName: 'Patched Name',
        roles: [{ configurationId: 'dns-lab', role: 'editor', canDeploy: true }],
      },
    });
    expect(patchRes.statusCode).toBe(200);
    const patched = JSON.parse(patchRes.body);
    expect(patched.displayName).toBe('Patched Name');
    expect(patched.roles).toEqual([{ configurationId: 'dns-lab', role: 'editor', canDeploy: true }]);
  });

  it('patches password; new password authenticates via login, old one fails (proves rehash)', async () => {
    const token = await loginAs('admin', 'admin');
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: authHeader(token),
      payload: { username: 'rehashme', displayName: 'Rehash Me', password: 'original-password-12' },
    });
    const created = JSON.parse(createRes.body);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${created.id}`,
      headers: authHeader(token),
      payload: { password: 'brand-new-password-99' },
    });
    expect(patchRes.statusCode).toBe(200);

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      payload: { username: 'rehashme', password: 'original-password-12' },
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      payload: { username: 'rehashme', password: 'brand-new-password-99' },
    });
    expect(newLogin.statusCode).toBe(200);
    expect(JSON.parse(newLogin.body).token).toBeTruthy();
  });

  it('patches isActive:false on a normal (non-last-admin) user; 200, isActive false', async () => {
    const token = await loginAs('admin', 'admin');
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: authHeader(token),
      payload: { username: 'deactivateme', displayName: 'Deactivate Me', password: 'correct-horse-battery' },
    });
    const created = JSON.parse(createRes.body);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${created.id}`,
      headers: authHeader(token),
      payload: { isActive: false },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(JSON.parse(patchRes.body).isActive).toBe(false);
  });

  it('LAST_ADMIN: with exactly one active admin, PATCH that admin isActive:false is refused (MUST-FAIL CONTROL)', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/usr-admin',
      headers: authHeader(token),
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('LAST_ADMIN');

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/users/usr-admin',
      headers: authHeader(token),
    });
    expect(JSON.parse(getRes.body).isActive).toBe(true);
  });

  it('LAST_ADMIN: removing the admin role from the last active admin is refused', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/usr-admin',
      headers: authHeader(token),
      payload: { roles: [{ configurationId: 'dns-lab', role: 'viewer', canDeploy: false }] },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('LAST_ADMIN');
  });

  it('SELF_DEACTIVATION: the acting admin deactivating their own id is refused, with a second admin present', async () => {
    createUserWithRole('usr-admin2', 'admin2', [
      { configurationId: 'dns-lab', role: 'admin', canDeploy: true },
    ]);
    const token = await loginAs('admin', 'admin');

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/usr-admin',
      headers: authHeader(token),
      payload: { isActive: false },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('SELF_DEACTIVATION');

    const delRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/users/usr-admin',
      headers: authHeader(token),
    });
    expect(delRes.statusCode).toBe(409);
    expect(JSON.parse(delRes.body).error.code).toBe('SELF_DEACTIVATION');
  });

  it('DELETE soft-deactivates a normal user; 200 {deactivated:true}, subsequent GET shows isActive:false', async () => {
    const token = await loginAs('admin', 'admin');
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: authHeader(token),
      payload: { username: 'todelete', displayName: 'To Delete', password: 'correct-horse-battery' },
    });
    const created = JSON.parse(createRes.body);

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${created.id}`,
      headers: authHeader(token),
    });
    expect(delRes.statusCode).toBe(200);
    expect(JSON.parse(delRes.body)).toEqual({ deactivated: true });

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${created.id}`,
      headers: authHeader(token),
    });
    expect(JSON.parse(getRes.body).isActive).toBe(false);
  });

  it('returns 404 on PATCH/DELETE of an unknown userId', async () => {
    const token = await loginAs('admin', 'admin');
    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/usr-ghost',
      headers: authHeader(token),
      payload: { displayName: 'Anything' },
    });
    expect(patchRes.statusCode).toBe(404);

    const delRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/users/usr-ghost',
      headers: authHeader(token),
    });
    expect(delRes.statusCode).toBe(404);
  });
});
