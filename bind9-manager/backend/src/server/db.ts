import Database from 'better-sqlite3';
import { hashPassword } from './crypto';

export function openDb(path = ':memory:'): Database.Database {
  const db = new Database(path);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      displayName TEXT NOT NULL,
      isActive INTEGER NOT NULL,
      roles TEXT NOT NULL,
      pwSalt TEXT NOT NULL,
      pwHash TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      tokenHash TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ownerUserId TEXT NOT NULL,
      keyHash TEXT UNIQUE NOT NULL,
      scopes TEXT NOT NULL,
      readOnly INTEGER NOT NULL,
      expiresAt TEXT,
      lastUsedAt TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (ownerUserId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_userId ON sessions(userId);
    CREATE INDEX IF NOT EXISTS idx_api_keys_ownerUserId ON api_keys(ownerUserId);
  `);

  const adminCheck = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminCheck) {
    const adminPw = process.env.BIND9_ADMIN_PW ?? 'admin';
    const { salt, hash } = hashPassword(adminPw);
    const roles = JSON.stringify([{ configurationId: 'dns-lab', role: 'admin', canDeploy: true }]);
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO users (id, username, displayName, isActive, roles, pwSalt, pwHash, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('usr-admin', 'admin', 'Administrator', 1, roles, salt, hash, now);
  }

  return db;
}
