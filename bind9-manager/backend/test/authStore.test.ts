import { describe, it, expect } from 'vitest';
import { openDb } from '../src/server/db';
import {
  login,
  resolveSession,
  revokeSession,
  createApiKey,
  resolveApiKey,
  getUserById,
  getUserByUsername,
  listApiKeys,
  deleteApiKey,
} from '../src/server/authStore';
import { hashPassword, sha256 } from '../src/server/crypto';

describe('db & authStore', () => {
  it('seeds an admin user in openDb(:memory:)', () => {
    const db = openDb(':memory:');
    const admin = getUserByUsername(db, 'admin');

    expect(admin).not.toBeNull();
    expect(admin?.username).toBe('admin');
    expect(admin?.displayName).toBe('Administrator');
    expect(admin?.isActive).toBe(true);
    expect(admin?.roles).toEqual([
      { configurationId: 'dns-lab', role: 'admin', canDeploy: true },
    ]);
  });

  describe('sessions (login, resolve, revoke)', () => {
    it('login with wrong password returns null', () => {
      const db = openDb(':memory:');
      const res = login(db, 'admin', 'wrong-pw');
      expect(res).toBeNull();
    });

    it('login with unknown username returns null', () => {
      const db = openDb(':memory:');
      const res = login(db, 'nonexistent', 'admin');
      expect(res).toBeNull();
    });

    it('login with inactive user returns null', () => {
      const db = openDb(':memory:');
      // Create an inactive user
      const { salt, hash } = hashPassword('secret');
      db.prepare(`
        INSERT INTO users (id, username, displayName, isActive, roles, pwSalt, pwHash, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('u-inactive', 'disabled_user', 'Disabled', 0, '[]', salt, hash, new Date().toISOString());

      const res = login(db, 'disabled_user', 'secret');
      expect(res).toBeNull();
    });

    it('login with correct password returns token and 8h expiresAt', () => {
      const db = openDb(':memory:');
      const now = 1700000000000;
      const res = login(db, 'admin', 'admin', now);

      expect(res).not.toBeNull();
      expect(res?.token).toBeDefined();
      expect(res?.expiresAt).toBe(new Date(now + 8 * 60 * 60 * 1000).toISOString());

      // Resolving the session returns the User entity
      const user = resolveSession(db, res!.token, now);
      expect(user).not.toBeNull();
      expect(user?.username).toBe('admin');
      expect(user?.displayName).toBe('Administrator');
      expect(user?.isActive).toBe(true);
      expect(user?.roles).toEqual([
        { configurationId: 'dns-lab', role: 'admin', canDeploy: true },
      ]);
    });

    it('rejects an expired session token', () => {
      const db = openDb(':memory:');
      const loginTime = 1700000000000;
      const res = login(db, 'admin', 'admin', loginTime);
      expect(res).not.toBeNull();

      // Within 8 hours: valid
      const withinTtl = loginTime + 7 * 60 * 60 * 1000;
      expect(resolveSession(db, res!.token, withinTtl)).not.toBeNull();

      // Exactly at expiry or past expiry: rejected
      const atExpiry = loginTime + 8 * 60 * 60 * 1000;
      expect(resolveSession(db, res!.token, atExpiry)).toBeNull();

      const pastExpiry = loginTime + 9 * 60 * 60 * 1000;
      expect(resolveSession(db, res!.token, pastExpiry)).toBeNull();
    });

    it('rejects invalid or garbage session token', () => {
      const db = openDb(':memory:');
      expect(resolveSession(db, 'random-garbage-token')).toBeNull();
      expect(resolveSession(db, '')).toBeNull();
    });

    it('revokeSession removes session row and makes subsequent resolve return null', () => {
      const db = openDb(':memory:');
      const res = login(db, 'admin', 'admin');
      expect(res).not.toBeNull();

      expect(resolveSession(db, res!.token)).not.toBeNull();

      revokeSession(db, res!.token);

      expect(resolveSession(db, res!.token)).toBeNull();
    });
  });

  describe('api keys (create, resolve, list, delete)', () => {
    it('creates an api key with bnd_ prefix and stores only the hash', () => {
      const db = openDb(':memory:');
      const admin = getUserByUsername(db, 'admin')!;

      const result = createApiKey(db, admin.id, {
        name: 'CI deploy key',
        scopes: ['read', 'write', 'deploy'],
        readOnly: false,
        expiresAt: null,
      });

      expect(result.id).toMatch(/^key_/);
      expect(result.token).toMatch(/^bnd_[0-9a-f]{64}$/);

      // Resolve API key
      const now = 1700000000000;
      const resolved = resolveApiKey(db, result.token, now);
      expect(resolved).not.toBeNull();
      expect(resolved?.user.id).toBe(admin.id);
      expect(resolved?.user.username).toBe('admin');
      expect(resolved?.key.id).toBe(result.id);
      expect(resolved?.key.name).toBe('CI deploy key');
      expect(resolved?.key.scopes).toEqual(['read', 'write', 'deploy']);
      expect(resolved?.key.readOnly).toBe(false);
      expect(resolved?.key.lastUsedAt).toBe(new Date(now).toISOString());

      // Resolving again with a later time bumps lastUsedAt
      const later = now + 10000;
      const resolvedLater = resolveApiKey(db, result.token, later);
      expect(resolvedLater?.key.lastUsedAt).toBe(new Date(later).toISOString());
    });

    it('rejects an expired API key', () => {
      const db = openDb(':memory:');
      const admin = getUserByUsername(db, 'admin')!;

      const expDate = new Date(1700000000000).toISOString();
      const result = createApiKey(db, admin.id, {
        name: 'Temporary key',
        scopes: ['read'],
        readOnly: true,
        expiresAt: expDate,
      });

      // Before expiry: resolves
      const beforeExp = 1700000000000 - 1000;
      expect(resolveApiKey(db, result.token, beforeExp)).not.toBeNull();

      // At expiry: rejected
      expect(resolveApiKey(db, result.token, 1700000000000)).toBeNull();

      // After expiry: rejected
      const afterExp = 1700000000000 + 1000;
      expect(resolveApiKey(db, result.token, afterExp)).toBeNull();
    });

    it('rejects garbage or non-existent API key token', () => {
      const db = openDb(':memory:');
      expect(resolveApiKey(db, 'bnd_invalid_token_12345')).toBeNull();
      expect(resolveApiKey(db, '')).toBeNull();
    });

    it('listApiKeys and deleteApiKey manage keys without leaking secrets', () => {
      const db = openDb(':memory:');
      const admin = getUserByUsername(db, 'admin')!;

      const k1 = createApiKey(db, admin.id, {
        name: 'Key 1',
        scopes: ['read'],
        readOnly: true,
      });
      const k2 = createApiKey(db, admin.id, {
        name: 'Key 2',
        scopes: ['read', 'write'],
        readOnly: false,
      });

      const keys = listApiKeys(db, admin.id);
      expect(keys).toHaveLength(2);
      expect(keys.map((k) => k.id)).toContain(k1.id);
      expect(keys.map((k) => k.id)).toContain(k2.id);

      // Verify no secrets/hashes leaked in list
      for (const k of keys) {
        expect(k.token).toBeUndefined();
        expect((k as any).keyHash).toBeUndefined();
      }

      // Delete key 1
      const deleted = deleteApiKey(db, k1.id);
      expect(deleted).toBe(true);

      const remaining = listApiKeys(db, admin.id);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(k2.id);

      // k1 can no longer resolve
      expect(resolveApiKey(db, k1.token)).toBeNull();
    });
  });

  describe('security: no plaintext passwords or tokens at rest', () => {
    it('asserts DB rows contain only hashes, never plaintext passwords or tokens', () => {
      const db = openDb(':memory:');
      const password = 'TestAdminPassword!99';
      const { salt, hash } = hashPassword(password);

      db.prepare(`
        INSERT INTO users (id, username, displayName, isActive, roles, pwSalt, pwHash, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('u-audit', 'audit_user', 'Auditor', 1, '[]', salt, hash, new Date().toISOString());

      // 1. Check users table
      const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get('u-audit') as any;
      expect(userRow.pwSalt).toBe(salt);
      expect(userRow.pwHash).toBe(hash);
      expect(JSON.stringify(userRow)).not.toContain(password);

      // 2. Check sessions table
      const sessionResult = login(db, 'audit_user', password);
      expect(sessionResult).not.toBeNull();
      const rawToken = sessionResult!.token;

      const sessionRow = db.prepare('SELECT * FROM sessions WHERE userId = ?').get('u-audit') as any;
      expect(sessionRow.tokenHash).toBe(sha256(rawToken));
      expect(JSON.stringify(sessionRow)).not.toContain(rawToken);

      // 3. Check api_keys table
      const keyResult = createApiKey(db, 'u-audit', {
        name: 'Audit Key',
        scopes: ['read'],
        readOnly: true,
      });
      const rawApiKeyToken = keyResult.token;

      const keyRow = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(keyResult.id) as any;
      expect(keyRow.keyHash).toBe(sha256(rawApiKeyToken));
      expect(JSON.stringify(keyRow)).not.toContain(rawApiKeyToken);
    });
  });

  describe('user DAO helpers', () => {
    it('getUserById returns user or null', () => {
      const db = openDb(':memory:');
      const admin = getUserByUsername(db, 'admin')!;
      const byId = getUserById(db, admin.id);
      expect(byId).toEqual(admin);

      expect(getUserById(db, 'nonexistent-id')).toBeNull();
    });
  });
});
