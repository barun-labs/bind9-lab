import type Database from 'better-sqlite3';
import type { User, RoleAssignment, ApiKey } from '../../../shared/entities';
import { randomToken, sha256, verifyPassword } from './crypto';

interface UserRow {
  id: string;
  username: string;
  displayName: string;
  isActive: number;
  roles: string;
  pwSalt: string;
  pwHash: string;
  createdAt: string;
}

export interface CreateApiKeyOptions {
  name: string;
  scopes: ('read' | 'write' | 'deploy')[];
  readOnly: boolean;
  expiresAt?: string | null;
}

function safeParseJson<T>(text: string | null | undefined, fallback: T): T {
  try {
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Authenticate a user and create an 8-hour session if credentials are valid.
 * Returns { token, expiresAt } on success, null on invalid credentials or inactive user.
 */
export function login(
  db: Database.Database,
  username: string,
  pw: string,
  now: number = Date.now()
): { token: string; expiresAt: string } | null {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
  if (!row || !row.isActive) {
    return null;
  }

  if (!verifyPassword(pw, row.pwSalt, row.pwHash)) {
    return null;
  }

  const token = randomToken();
  const tokenHash = sha256(token);
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + 8 * 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO sessions (tokenHash, userId, createdAt, expiresAt)
    VALUES (?, ?, ?, ?)
  `).run(tokenHash, row.id, createdAt, expiresAt);

  return { token, expiresAt };
}

/**
 * Look up a session by token hash, verify expiration against `now`,
 * and return the active User entity if valid.
 */
export function resolveSession(
  db: Database.Database,
  token: string,
  now: number = Date.now()
): User | null {
  const tokenHash = sha256(token);
  const row = db.prepare(`
    SELECT s.expiresAt, u.id, u.username, u.displayName, u.isActive, u.roles
    FROM sessions s
    JOIN users u ON s.userId = u.id
    WHERE s.tokenHash = ?
  `).get(tokenHash) as {
    expiresAt: string;
    id: string;
    username: string;
    displayName: string;
    isActive: number;
    roles: string;
  } | undefined;

  if (!row || !row.isActive) {
    return null;
  }

  const expiresAtMs = new Date(row.expiresAt).getTime();
  if (isNaN(expiresAtMs) || expiresAtMs <= now) {
    return null;
  }

  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    isActive: Boolean(row.isActive),
    roles: safeParseJson<RoleAssignment[]>(row.roles, []),
  };
}

/**
 * Revoke (delete) a session row by bearer token.
 */
export function revokeSession(db: Database.Database, token: string): void {
  const tokenHash = sha256(token);
  db.prepare('DELETE FROM sessions WHERE tokenHash = ?').run(tokenHash);
}

/**
 * Mint a new API key with a `bnd_` prefix, store its sha256 hash, and return { id, token } once.
 */
export function createApiKey(
  db: Database.Database,
  ownerUserId: string,
  options: CreateApiKeyOptions
): { id: string; token: string } {
  const id = 'key_' + randomToken().slice(0, 16);
  const token = 'bnd_' + randomToken();
  const keyHash = sha256(token);
  const createdAt = new Date().toISOString();
  const readOnly = options.readOnly ? 1 : 0;
  const scopes = JSON.stringify(options.scopes);
  const expiresAt = options.expiresAt ? options.expiresAt : null;

  db.prepare(`
    INSERT INTO api_keys (id, name, ownerUserId, keyHash, scopes, readOnly, expiresAt, lastUsedAt, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
  `).run(id, options.name, ownerUserId, keyHash, scopes, readOnly, expiresAt, createdAt);

  return { id, token };
}

/**
 * Look up an API key by token hash, check expiration, bump lastUsedAt,
 * and return the key metadata and owner User.
 */
export function resolveApiKey(
  db: Database.Database,
  token: string,
  now: number = Date.now()
): { key: ApiKey; user: User } | null {
  const keyHash = sha256(token);
  const row = db.prepare(`
    SELECT
      k.id AS keyId, k.name AS keyName, k.ownerUserId, k.scopes, k.readOnly,
      k.expiresAt AS keyExpiresAt, k.lastUsedAt, k.createdAt AS keyCreatedAt,
      u.id AS userId, u.username, u.displayName, u.isActive, u.roles
    FROM api_keys k
    JOIN users u ON k.ownerUserId = u.id
    WHERE k.keyHash = ?
  `).get(keyHash) as {
    keyId: string;
    keyName: string;
    ownerUserId: string;
    scopes: string;
    readOnly: number;
    keyExpiresAt: string | null;
    lastUsedAt: string | null;
    keyCreatedAt: string;
    userId: string;
    username: string;
    displayName: string;
    isActive: number;
    roles: string;
  } | undefined;

  if (!row || !row.isActive) {
    return null;
  }

  if (row.keyExpiresAt) {
    const exp = new Date(row.keyExpiresAt).getTime();
    if (isNaN(exp) || exp <= now) {
      return null;
    }
  }

  const lastUsedAt = new Date(now).toISOString();
  db.prepare('UPDATE api_keys SET lastUsedAt = ? WHERE id = ?').run(lastUsedAt, row.keyId);

  const key: ApiKey = {
    id: row.keyId,
    name: row.keyName,
    ownerUserId: row.ownerUserId,
    scopes: safeParseJson<('read' | 'write' | 'deploy')[]>(row.scopes, []),
    readOnly: Boolean(row.readOnly),
    expiresAt: row.keyExpiresAt,
    createdAt: row.keyCreatedAt,
    lastUsedAt,
  };

  const user: User = {
    id: row.userId,
    username: row.username,
    displayName: row.displayName,
    isActive: Boolean(row.isActive),
    roles: safeParseJson<RoleAssignment[]>(row.roles, []),
  };

  return { key, user };
}

/**
 * Retrieve user by ID.
 */
export function getUserById(db: Database.Database, id: string): User | null {
  const row = db.prepare('SELECT id, username, displayName, isActive, roles FROM users WHERE id = ?').get(id) as {
    id: string;
    username: string;
    displayName: string;
    isActive: number;
    roles: string;
  } | undefined;

  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    isActive: Boolean(row.isActive),
    roles: safeParseJson<RoleAssignment[]>(row.roles, []),
  };
}

/**
 * Retrieve user by username.
 */
export function getUserByUsername(db: Database.Database, username: string): User | null {
  const row = db.prepare('SELECT id, username, displayName, isActive, roles FROM users WHERE username = ?').get(username) as {
    id: string;
    username: string;
    displayName: string;
    isActive: number;
    roles: string;
  } | undefined;

  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    isActive: Boolean(row.isActive),
    roles: safeParseJson<RoleAssignment[]>(row.roles, []),
  };
}

/**
 * List API keys (never including secrets), optionally filtered by owner.
 */
export function listApiKeys(db: Database.Database, ownerUserId?: string): ApiKey[] {
  let rows: {
    id: string;
    name: string;
    ownerUserId: string;
    scopes: string;
    readOnly: number;
    expiresAt: string | null;
    lastUsedAt: string | null;
    createdAt: string;
  }[];

  if (ownerUserId) {
    rows = db.prepare('SELECT id, name, ownerUserId, scopes, readOnly, expiresAt, lastUsedAt, createdAt FROM api_keys WHERE ownerUserId = ?').all(ownerUserId) as any[];
  } else {
    rows = db.prepare('SELECT id, name, ownerUserId, scopes, readOnly, expiresAt, lastUsedAt, createdAt FROM api_keys').all() as any[];
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    ownerUserId: r.ownerUserId,
    scopes: safeParseJson<('read' | 'write' | 'deploy')[]>(r.scopes, []),
    readOnly: Boolean(r.readOnly),
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
  }));
}

/**
 * Delete an API key by ID.
 */
export function deleteApiKey(db: Database.Database, id: string): boolean {
  const result = db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
  return result.changes > 0;
}
