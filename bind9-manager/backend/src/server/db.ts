import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword, validatePassword } from './crypto';

function loadFixtures(): any {
  const possibleUrls = [
    new URL('../../../design/docs/fixtures.json', import.meta.url),
    new URL('../../design/docs/fixtures.json', import.meta.url),
  ];
  for (const u of possibleUrls) {
    try {
      if (fs.existsSync(u)) {
        return JSON.parse(fs.readFileSync(u, 'utf-8'));
      }
    } catch {
      // ignore and try next
    }
  }

  const cwdPaths = [
    path.resolve(process.cwd(), '../design/docs/fixtures.json'),
    path.resolve(process.cwd(), 'design/docs/fixtures.json'),
    path.resolve(process.cwd(), 'bind9-manager/design/docs/fixtures.json'),
  ];
  for (const p of cwdPaths) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
      }
    } catch {
      // ignore and try next
    }
  }

  return null;
}

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

    CREATE TABLE IF NOT EXISTS configurations (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS views (
      id TEXT PRIMARY KEY,
      configurationId TEXT NOT NULL,
      data TEXT NOT NULL,
      FOREIGN KEY (configurationId) REFERENCES configurations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS zones (
      id TEXT PRIMARY KEY,
      configurationId TEXT NOT NULL,
      viewId TEXT NOT NULL,
      data TEXT NOT NULL,
      FOREIGN KEY (configurationId) REFERENCES configurations(id) ON DELETE CASCADE,
      FOREIGN KEY (viewId) REFERENCES views(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      zoneId TEXT NOT NULL,
      data TEXT NOT NULL,
      FOREIGN KEY (zoneId) REFERENCES zones(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS external_hosts (
      id TEXT PRIMARY KEY,
      configurationId TEXT NOT NULL,
      data TEXT NOT NULL,
      FOREIGN KEY (configurationId) REFERENCES configurations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      configurationId TEXT NOT NULL,
      data TEXT NOT NULL,
      FOREIGN KEY (configurationId) REFERENCES configurations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS labs (
      id TEXT PRIMARY KEY,
      configurationId TEXT NOT NULL,
      data TEXT NOT NULL,
      FOREIGN KEY (configurationId) REFERENCES configurations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS acls (
      id TEXT PRIMARY KEY,
      configurationId TEXT NOT NULL,
      data TEXT NOT NULL,
      FOREIGN KEY (configurationId) REFERENCES configurations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rpz_policies (
      id TEXT PRIMARY KEY,
      configurationId TEXT NOT NULL,
      data TEXT NOT NULL,
      FOREIGN KEY (configurationId) REFERENCES configurations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rpz_rules (
      id TEXT PRIMARY KEY,
      policyId TEXT NOT NULL,
      data TEXT NOT NULL,
      FOREIGN KEY (policyId) REFERENCES rpz_policies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS server_groups (
      id TEXT PRIMARY KEY,
      configurationId TEXT NOT NULL,
      data TEXT NOT NULL,
      FOREIGN KEY (configurationId) REFERENCES configurations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      configurationId TEXT NOT NULL,
      data TEXT NOT NULL,
      FOREIGN KEY (configurationId) REFERENCES configurations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reverse_ptr_links (
      configurationId TEXT NOT NULL,
      forwardRecordId TEXT PRIMARY KEY,
      ptrRecordId     TEXT NOT NULL,
      ptrZoneId       TEXT NOT NULL,
      FOREIGN KEY (configurationId) REFERENCES configurations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tsig_keys (
      id TEXT PRIMARY KEY,
      configurationId TEXT NOT NULL,
      data TEXT NOT NULL,
      FOREIGN KEY (configurationId) REFERENCES configurations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS record_templates (
      id TEXT PRIMARY KEY,
      configurationId TEXT NOT NULL,
      data TEXT NOT NULL,
      FOREIGN KEY (configurationId) REFERENCES configurations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS deploy_jobs (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deployed_baselines (
      configurationId TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      FOREIGN KEY (configurationId) REFERENCES configurations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS changeset_deploy_jobs (
      id TEXT PRIMARY KEY,
      configurationId TEXT NOT NULL,
      data TEXT NOT NULL,
      FOREIGN KEY (configurationId) REFERENCES configurations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS deployment_options (
      id TEXT PRIMARY KEY,
      configurationId TEXT NOT NULL,
      scopeType TEXT NOT NULL,
      scopeId TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      disabled INTEGER NOT NULL DEFAULT 0,
      UNIQUE(configurationId, scopeType, scopeId, key)
    );

    CREATE TABLE IF NOT EXISTS deployment_roles (
      id TEXT PRIMARY KEY,
      configurationId TEXT NOT NULL,
      scopeType TEXT NOT NULL,
      scopeId TEXT NOT NULL,
      serverId TEXT NOT NULL,
      role TEXT NOT NULL,
      disabled INTEGER NOT NULL DEFAULT 0,
      UNIQUE(configurationId, scopeType, scopeId, serverId)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_userId ON sessions(userId);
    CREATE INDEX IF NOT EXISTS idx_api_keys_ownerUserId ON api_keys(ownerUserId);
    CREATE INDEX IF NOT EXISTS idx_views_configId ON views(configurationId);
    CREATE INDEX IF NOT EXISTS idx_zones_configId ON zones(configurationId);
    CREATE INDEX IF NOT EXISTS idx_zones_viewId ON zones(viewId);
    CREATE INDEX IF NOT EXISTS idx_records_zoneId ON records(zoneId);
    CREATE INDEX IF NOT EXISTS idx_external_hosts_configId ON external_hosts(configurationId);
    CREATE INDEX IF NOT EXISTS idx_servers_configId ON servers(configurationId);
    CREATE INDEX IF NOT EXISTS idx_labs_configId ON labs(configurationId);
    CREATE INDEX IF NOT EXISTS idx_acls_configId ON acls(configurationId);
    CREATE INDEX IF NOT EXISTS idx_rpz_policies_configId ON rpz_policies(configurationId);
    CREATE INDEX IF NOT EXISTS idx_rpz_rules_policyId ON rpz_rules(policyId);
    CREATE INDEX IF NOT EXISTS idx_server_groups_configId ON server_groups(configurationId);
    CREATE INDEX IF NOT EXISTS idx_blocks_configId ON blocks(configurationId);
    CREATE INDEX IF NOT EXISTS idx_tsig_keys_configId ON tsig_keys(configurationId);
    CREATE INDEX IF NOT EXISTS idx_record_templates_configId ON record_templates(configurationId);
    CREATE INDEX IF NOT EXISTS idx_changeset_deploy_jobs_configId ON changeset_deploy_jobs(configurationId);
  `);

  const adminCheck = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminCheck) {
    const adminPw = process.env.BIND9_ADMIN_PW ?? 'admin';
    if (process.env.BIND9_ADMIN_PW !== undefined) {
      const reason = validatePassword(adminPw);
      if (reason) {
        throw new Error(`BIND9_ADMIN_PW rejected: ${reason}`);
      }
    } else {
      console.warn('[bind9-manager] Seeding admin with the built-in default password. Set BIND9_ADMIN_PW to a strong value for any real deployment.');
    }
    const { salt, hash } = hashPassword(adminPw);
    const roles = JSON.stringify([{ configurationId: 'dns-lab', role: 'admin', canDeploy: true }]);
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO users (id, username, displayName, isActive, roles, pwSalt, pwHash, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('usr-admin', 'admin', 'Administrator', 1, roles, salt, hash, now);
  }

  // Seed fixtures if fresh database
  const configCount = (db.prepare('SELECT count(*) as cnt FROM configurations').get() as { cnt: number }).cnt;
  if (configCount === 0) {
    const fixtures = loadFixtures();
    if (fixtures) {
      const seedTransaction = db.transaction(() => {
        if (Array.isArray(fixtures.configurations)) {
          const insertConfig = db.prepare('INSERT OR IGNORE INTO configurations (id, data) VALUES (?, ?)');
          for (const c of fixtures.configurations) {
            insertConfig.run(c.id, JSON.stringify(c));
          }
        }
        if (Array.isArray(fixtures.views)) {
          const insertView = db.prepare('INSERT OR IGNORE INTO views (id, configurationId, data) VALUES (?, ?, ?)');
          for (const v of fixtures.views) {
            insertView.run(v.id, v.configurationId, JSON.stringify(v));
          }
        }
        if (Array.isArray(fixtures.zones)) {
          const insertZone = db.prepare('INSERT OR IGNORE INTO zones (id, configurationId, viewId, data) VALUES (?, ?, ?, ?)');
          for (const z of fixtures.zones) {
            insertZone.run(z.id, z.configurationId, z.viewId, JSON.stringify(z));
          }
        }
        if (Array.isArray(fixtures.records)) {
          const insertRecord = db.prepare('INSERT OR IGNORE INTO records (id, zoneId, data) VALUES (?, ?, ?)');
          for (const r of fixtures.records) {
            insertRecord.run(r.id, r.zoneId, JSON.stringify(r));
          }
        }
        const externalHosts = fixtures.externalHosts || fixtures.external_hosts;
        if (Array.isArray(externalHosts)) {
          const insertHost = db.prepare('INSERT OR IGNORE INTO external_hosts (id, configurationId, data) VALUES (?, ?, ?)');
          for (const h of externalHosts) {
            insertHost.run(h.id, h.configurationId, JSON.stringify(h));
          }
        }
        if (Array.isArray(fixtures.servers)) {
          const insertServer = db.prepare('INSERT OR IGNORE INTO servers (id, configurationId, data) VALUES (?, ?, ?)');
          for (const s of fixtures.servers) {
            insertServer.run(s.id, s.configurationId, JSON.stringify(s));
          }
        }
        if (Array.isArray(fixtures.labs)) {
          const insertLab = db.prepare('INSERT OR IGNORE INTO labs (id, configurationId, data) VALUES (?, ?, ?)');
          for (const l of fixtures.labs) {
            insertLab.run(l.id, l.configurationId, JSON.stringify(l));
          }
        }
      });
      seedTransaction();
    }
  }

  return db;
}

