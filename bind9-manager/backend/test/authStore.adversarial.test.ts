import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/server/db';
import {
  login,
  resolveSession,
  revokeSession,
  createApiKey,
  resolveApiKey,
  getUserByUsername,
} from '../src/server/authStore';
import { hashPassword, sha256 } from '../src/server/crypto';

const T0 = 1700000000000;
const TTL_MS = 8 * 60 * 60 * 1000;

describe('authStore adversarial', () => {
  describe('session lifecycle', () => {
    it('expired token -> null; garbage/random token -> null; sha256-of-nothing -> null', () => {
      const db = openDb(':memory:');
      const res = login(db, 'admin', 'admin', T0);
      expect(res).not.toBeNull();

      // Expired (past + exactly at boundary).
      expect(resolveSession(db, res!.token, T0 + TTL_MS)).toBeNull();
      expect(resolveSession(db, res!.token, T0 + TTL_MS + 1)).toBeNull();

      // Garbage and empty tokens.
      expect(resolveSession(db, 'random-garbage-token', T0)).toBeNull();
      expect(resolveSession(db, '', T0)).toBeNull();

      // A 64-hex token that was never minted (sha256 collides with nothing).
      expect(resolveSession(db, 'f'.repeat(64), T0)).toBeNull();
      // The token 'admin' (sha256 exists in the world, but not in sessions).
      expect(resolveSession(db, 'admin', T0)).toBeNull();
    });

    it('valid token works right up to but NOT past expiresAt (exact boundary)', () => {
      const db = openDb(':memory:');
      const res = login(db, 'admin', 'admin', T0);
      expect(res).not.toBeNull();

      // 1ms before expiry: valid.
      expect(resolveSession(db, res!.token, T0 + TTL_MS - 1)).not.toBeNull();
      // Exactly at expiry: rejected (spec: "up to but not past").
      expect(resolveSession(db, res!.token, T0 + TTL_MS)).toBeNull();
      // 1ms after: rejected.
      expect(resolveSession(db, res!.token, T0 + TTL_MS + 1)).toBeNull();
    });

    it('revoked token -> null', () => {
      const db = openDb(':memory:');
      const res = login(db, 'admin', 'admin', T0);
      expect(res).not.toBeNull();
      expect(resolveSession(db, res!.token, T0)).not.toBeNull();

      revokeSession(db, res!.token);
      expect(resolveSession(db, res!.token, T0)).toBeNull();
    });

    it('deactivating a user mid-session makes resolveSession return null', () => {
      const db = openDb(':memory:');
      const res = login(db, 'admin', 'admin', T0);
      expect(res).not.toBeNull();
      expect(resolveSession(db, res!.token, T0)).not.toBeNull();

      db.prepare('UPDATE users SET isActive = 0 WHERE username = ?').run('admin');
      expect(resolveSession(db, res!.token, T0)).toBeNull();
    });
  });

  describe('login / password', () => {
    it('wrong password, empty password, and unknown user all -> null', () => {
      const db = openDb(':memory:');
      expect(login(db, 'admin', 'wrong-pw', T0)).toBeNull();
      expect(login(db, 'admin', '', T0)).toBeNull();
      expect(login(db, 'nonexistent', 'admin', T0)).toBeNull();
    });

    it('login round-trips unicode and very-long passwords', () => {
      const db = openDb(':memory:');

      const unicodePw = 'pässwörd-🔐-日本語';
      const unicode = hashPassword(unicodePw);
      db.prepare(`
        INSERT INTO users (id, username, displayName, isActive, roles, pwSalt, pwHash, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('u-uni', 'unicode_user', 'Uni', 1, '[]', unicode.salt, unicode.hash, new Date(T0).toISOString());
      expect(login(db, 'unicode_user', unicodePw, T0)).not.toBeNull();
      expect(login(db, 'unicode_user', unicodePw + 'x', T0)).toBeNull();

      const longPw = 'Z'.repeat(10_000);
      const long = hashPassword(longPw);
      db.prepare(`
        INSERT INTO users (id, username, displayName, isActive, roles, pwSalt, pwHash, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('u-long', 'long_user', 'Long', 1, '[]', long.salt, long.hash, new Date(T0).toISOString());
      expect(login(db, 'long_user', longPw, T0)).not.toBeNull();
      expect(login(db, 'long_user', longPw.slice(0, -1), T0)).toBeNull();
    });

    it('login with empty-string password on an empty-password user succeeds (no min-length policy)', () => {
      const db = openDb(':memory:');
      const { salt, hash } = hashPassword('');
      db.prepare(`
        INSERT INTO users (id, username, displayName, isActive, roles, pwSalt, pwHash, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('u-empty', 'empty_pw_user', 'Empty', 1, '[]', salt, hash, new Date(T0).toISOString());
      expect(login(db, 'empty_pw_user', '', T0)).not.toBeNull();
    });
  });

  describe('SQL injection resistance', () => {
    it("username like `admin'; DROP TABLE users;--` does not break the DB", () => {
      const db = openDb(':memory:');

      const injections = [
        "admin'; DROP TABLE users;--",
        "'; DELETE FROM sessions;--",
        'admin" OR "1"="1',
        "admin' OR '1'='1' --",
        'admin;--',
      ];

      for (const uname of injections) {
        expect(() => login(db, uname, 'whatever', T0)).not.toThrow();
        expect(login(db, uname, 'whatever', T0)).toBeNull();
      }

      // users table still exists and admin row is intact.
      const table = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
        .get() as { name: string } | undefined;
      expect(table?.name).toBe('users');
      const count = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
      expect(count).toBe(1);

      // And a correct login still works afterwards.
      expect(login(db, 'admin', 'admin', T0)).not.toBeNull();
    });

    it('password with injection payload is treated as data, not SQL', () => {
      const db = openDb(':memory:');
      const evilPw = "'; DROP TABLE users;--";
      expect(login(db, 'admin', evilPw, T0)).toBeNull();
      const count = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
      expect(count).toBe(1);
    });
  });

  describe('secrets at rest', () => {
    it('plaintext token and plaintext password never appear in ANY column of ANY row', () => {
      const db = openDb(':memory:');
      const password = 'S3cret!Passphrase#42';
      const { salt, hash } = hashPassword(password);

      db.prepare(`
        INSERT INTO users (id, username, displayName, isActive, roles, pwSalt, pwHash, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('u-rest', 'rest_user', 'Rest', 1, '[]', salt, hash, new Date(T0).toISOString());

      const session = login(db, 'rest_user', password, T0);
      expect(session).not.toBeNull();
      const rawToken = session!.token;

      const key = createApiKey(db, 'u-rest', {
        name: 'rest key',
        scopes: ['read', 'write', 'deploy'],
        readOnly: false,
        expiresAt: null,
      });
      const rawKeyToken = key.token;

      // Scan every column of every row of all three tables.
      const tables = ['users', 'sessions', 'api_keys'];
      for (const t of tables) {
        const rows = db.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[];
        for (const row of rows) {
          const serialized = JSON.stringify(row);
          // Password plaintext never appears.
          expect(serialized).not.toContain(password);
          // Session token plaintext never appears.
          expect(serialized).not.toContain(rawToken);
          // API key token plaintext never appears.
          expect(serialized).not.toContain(rawKeyToken);
        }
      }

      // Positive control: the stored hashes ARE the sha256 of the tokens.
      const sessionRow = db.prepare('SELECT tokenHash FROM sessions WHERE userId = ?').get('u-rest') as { tokenHash: string };
      expect(sessionRow.tokenHash).toBe(sha256(rawToken));
      const keyRow = db.prepare('SELECT keyHash FROM api_keys WHERE id = ?').get(key.id) as { keyHash: string };
      expect(keyRow.keyHash).toBe(sha256(rawKeyToken));
    });
  });

  describe('api keys', () => {
    it('expired key -> null, and expired resolve does NOT bump lastUsedAt', () => {
      const db = openDb(':memory:');
      const admin = getUserByUsername(db, 'admin')!;

      const exp = new Date(T0 + 1000).toISOString();
      const key = createApiKey(db, admin.id, {
        name: 'temp',
        scopes: ['read'],
        readOnly: true,
        expiresAt: exp,
      });

      // Before expiry: resolves and bumps lastUsedAt.
      const before = resolveApiKey(db, key.token, T0);
      expect(before).not.toBeNull();
      expect(before!.key.lastUsedAt).toBe(new Date(T0).toISOString());

      // At / after expiry: null.
      expect(resolveApiKey(db, key.token, T0 + 1000)).toBeNull();
      expect(resolveApiKey(db, key.token, T0 + 2000)).toBeNull();

      // lastUsedAt unchanged after the rejected resolves (still the T0 bump).
      const row = db.prepare('SELECT lastUsedAt FROM api_keys WHERE id = ?').get(key.id) as { lastUsedAt: string };
      expect(row.lastUsedAt).toBe(new Date(T0).toISOString());
    });

    it('valid key bumps lastUsedAt across calls; readOnly/scopes round-trip', () => {
      const db = openDb(':memory:');
      const admin = getUserByUsername(db, 'admin')!;

      const key = createApiKey(db, admin.id, {
        name: 'rw',
        scopes: ['read', 'write', 'deploy'],
        readOnly: false,
        expiresAt: null,
      });

      const r1 = resolveApiKey(db, key.token, T0);
      expect(r1!.key.readOnly).toBe(false);
      expect(r1!.key.scopes).toEqual(['read', 'write', 'deploy']);
      expect(r1!.key.lastUsedAt).toBe(new Date(T0).toISOString());

      const r2 = resolveApiKey(db, key.token, T0 + 5000);
      expect(r2!.key.lastUsedAt).toBe(new Date(T0 + 5000).toISOString());

      // readOnly key round-trips too.
      const ro = createApiKey(db, admin.id, {
        name: 'ro',
        scopes: ['read'],
        readOnly: true,
        expiresAt: null,
      });
      const rro = resolveApiKey(db, ro.token, T0);
      expect(rro!.key.readOnly).toBe(true);
      expect(rro!.key.scopes).toEqual(['read']);
    });

    it('two createApiKey calls yield different tokens and different ids', () => {
      const db = openDb(':memory:');
      const admin = getUserByUsername(db, 'admin')!;
      const k1 = createApiKey(db, admin.id, { name: 'a', scopes: ['read'], readOnly: true });
      const k2 = createApiKey(db, admin.id, { name: 'b', scopes: ['read'], readOnly: true });
      expect(k1.token).not.toBe(k2.token);
      expect(k1.id).not.toBe(k2.id);
      expect(k1.token).toMatch(/^bnd_[0-9a-f]{64}$/);
    });

    it('garbage key token -> null', () => {
      const db = openDb(':memory:');
      expect(resolveApiKey(db, 'bnd_' + '0'.repeat(64), T0)).toBeNull();
      expect(resolveApiKey(db, '', T0)).toBeNull();
      expect(resolveApiKey(db, 'f'.repeat(64), T0)).toBeNull();
    });

    it('deleting the owner user cascades and makes the key unresolvable', () => {
      const db = openDb(':memory:');
      const admin = getUserByUsername(db, 'admin')!;
      const key = createApiKey(db, admin.id, { name: 'x', scopes: ['read'], readOnly: true });
      expect(resolveApiKey(db, key.token, T0)).not.toBeNull();

      db.prepare('DELETE FROM users WHERE id = ?').run(admin.id);
      expect(resolveApiKey(db, key.token, T0)).toBeNull();
    });
  });

  describe('seeding', () => {
    it('openDb(:memory:) twice gives independent DBs', () => {
      const db1 = openDb(':memory:');
      const db2 = openDb(':memory:');

      // Mutate db1 only.
      const { salt, hash } = hashPassword('x');
      db1.prepare(`
        INSERT INTO users (id, username, displayName, isActive, roles, pwSalt, pwHash, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('u-only1', 'only_in_1', 'X', 1, '[]', salt, hash, new Date(T0).toISOString());

      expect(getUserByUsername(db1, 'only_in_1')).not.toBeNull();
      expect(getUserByUsername(db2, 'only_in_1')).toBeNull();
    });

    it('seeded admin can log in with the default password', () => {
      const db = openDb(':memory:');
      const res = login(db, 'admin', 'admin', T0);
      expect(res).not.toBeNull();
      expect(resolveSession(db, res!.token, T0)?.username).toBe('admin');
    });

    it('seeding is idempotent: reopening a file DB does not duplicate the admin', () => {
      const dir = mkdtempSync(join(tmpdir(), 'bind9-adv-'));
      const path = join(dir, 'test.db');

      const db1 = openDb(path);
      const before = (db1.prepare('SELECT COUNT(*) AS c FROM users WHERE username = ?').get('admin') as { c: number }).c;
      expect(before).toBe(1);
      db1.close();

      const db2 = openDb(path);
      const after = (db2.prepare('SELECT COUNT(*) AS c FROM users WHERE username = ?').get('admin') as { c: number }).c;
      expect(after).toBe(1);
      db2.close();

      rmSync(dir, { recursive: true, force: true });
    });

    it('BIND9_ADMIN_PW env override changes the seeded admin password', () => {
      const prev = process.env.BIND9_ADMIN_PW;
      process.env.BIND9_ADMIN_PW = 'override-pw-123';
      try {
        const db = openDb(':memory:');
        expect(login(db, 'admin', 'override-pw-123', T0)).not.toBeNull();
        expect(login(db, 'admin', 'admin', T0)).toBeNull();
      } finally {
        if (prev === undefined) delete process.env.BIND9_ADMIN_PW;
        else process.env.BIND9_ADMIN_PW = prev;
      }
    });
  });
});
