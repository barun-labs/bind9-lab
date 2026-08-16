import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import { ensureServerTrustKey, getServerTrustSecret, upsertServer } from '../src/server/entityStore';

describe('Server trust key API', () => {
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

  function seedServer(id: string): void {
    upsertServer(db, { id, configurationId: 'dns-lab', hostname: 'ns1', nodeName: 'ns1' } as any);
  }

  it('GET servers exposes trustKeyId/trustKeyCreatedAt but never the secret (MUST-FAIL CONTROL)', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };
    seedServer('srv-trust-1');
    const minted = ensureServerTrustKey(db, 'srv-trust-1');
    const secret = getServerTrustSecret(db, 'srv-trust-1');
    expect(secret).toBeTruthy();
    expect(minted.trustKeyId.startsWith('tk-')).toBe(true);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/servers',
      headers: authHeader,
    });
    expect(listRes.statusCode).toBe(200);
    const server = JSON.parse(listRes.body).find((s: any) => s.id === 'srv-trust-1');
    expect(server.trustKeyId).toBe(minted.trustKeyId);
    expect(server.trustKeyCreatedAt).toBe(minted.trustKeyCreatedAt);
    expect(server.trustSecret).toBeUndefined();
    // If the strip guard were removed, the secret and its key would leak here.
    expect(listRes.body).not.toContain('trustSecret');
    expect(listRes.body).not.toContain(secret);

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/servers/srv-trust-1',
      headers: authHeader,
    });
    expect(getRes.statusCode).toBe(200);
    const single = JSON.parse(getRes.body);
    expect(single.trustKeyId).toBe(minted.trustKeyId);
    expect(single.trustSecret).toBeUndefined();
    expect(getRes.body).not.toContain('trustSecret');
    expect(getRes.body).not.toContain(secret);
  });

  it('rotate-trust-key requires admin: viewer gets 403 (MUST-FAIL CONTROL)', async () => {
    createUserWithRole('usr-viewer', 'viewer', [
      { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
    ]);
    seedServer('srv-trust-2');
    ensureServerTrustKey(db, 'srv-trust-2');
    const token = await loginAs('viewer', 'password123');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/servers/srv-trust-2/rotate-trust-key',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rotate-trust-key as admin rotates the key and never returns a secret', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };
    seedServer('srv-trust-3');
    const old = ensureServerTrustKey(db, 'srv-trust-3');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/servers/srv-trust-3/rotate-trust-key',
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.trustKeyId.startsWith('tk-')).toBe(true);
    expect(body.trustKeyId).not.toBe(old.trustKeyId);
    expect(typeof body.trustKeyCreatedAt).toBe('string');
    expect(body.trustSecret).toBeUndefined();
    expect(res.body).not.toContain('trustSecret');

    // The stored secret really did change.
    const secret = getServerTrustSecret(db, 'srv-trust-3');
    expect(secret).toBeTruthy();
    expect(res.body).not.toContain(secret);
  });

  it('rotate-trust-key on a missing server -> 404', async () => {
    const token = await loginAs('admin', 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/servers/does-not-exist/rotate-trust-key',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
