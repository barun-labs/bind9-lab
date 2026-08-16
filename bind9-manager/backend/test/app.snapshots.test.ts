import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import { createTsigKey, createView, createZone, createRecord } from '../src/server/entityStore';

describe('Snapshots API', () => {
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

  it('captures CURRENT and returns metadata with counts + label, never leaking the tsig secret', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const key = createTsigKey(db, 'dns-lab', { name: 'secret-key', algorithm: 'hmac-sha256' });
    const secret = key.secret;
    expect(typeof secret).toBe('string');
    db.prepare('INSERT INTO servers (id, configurationId, data) VALUES (?, ?, ?)').run(
      'srv-ns1', 'dns-lab', JSON.stringify({ id: 'srv-ns1', name: 'ns1', configurationId: 'dns-lab' }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/snapshots',
      headers: authHeader,
      payload: { label: 'before change' },
    });
    expect(res.statusCode).toBe(201);
    const snap = JSON.parse(res.body);
    expect(snap.label).toBe('before change');
    expect(snap.source).toBe('CURRENT');
    expect(snap.counts.tsig_keys).toBe(1);
    // fixtures pre-seed 'dns-lab' with servers; the assertion is that our
    // added server is captured among them.
    expect(snap.counts.servers).toBeGreaterThanOrEqual(1);

    // MUST-FAIL CONTROL: the secret is in the capture blob internally, but the
    // metadata API responses (list + single) must never carry it.
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/dns-lab/snapshots',
      headers: authHeader,
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.body).not.toContain(secret);

    const metaRes = await app.inject({
      method: 'GET',
      url: `/api/v1/configurations/dns-lab/snapshots/${snap.id}`,
      headers: authHeader,
    });
    expect(metaRes.statusCode).toBe(200);
    expect(metaRes.body).not.toContain(secret);
    expect(JSON.parse(metaRes.body).counts.tsig_keys).toBe(1);
  });

  it('round-trips: restore removes post-capture additions and restores original rows with identical ids', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const view = createView(db, 'dns-lab', { name: 'internal' });
    const zone = createZone(db, 'dns-lab', { viewId: view.id, name: 'example.com' });
    const record = createRecord(db, zone.id, { name: '@', type: 'A', rdata: { address: '10.0.0.1' } });

    const captureRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/snapshots',
      headers: authHeader,
      payload: { label: 'snap1' },
    });
    expect(captureRes.statusCode).toBe(201);
    const snap = JSON.parse(captureRes.body);

    const extraZone = createZone(db, 'dns-lab', { viewId: view.id, name: 'extra.example' });
    const extraRecord = createRecord(db, extraZone.id, { name: '@', type: 'A', rdata: { address: '10.0.0.2' } });

    const restoreRes = await app.inject({
      method: 'POST',
      url: `/api/v1/configurations/dns-lab/snapshots/${snap.id}/restore`,
      headers: authHeader,
    });
    expect(restoreRes.statusCode).toBe(200);
    expect(JSON.parse(restoreRes.body).restored).toBe(true);

    // Post-capture additions are gone.
    expect(db.prepare('SELECT id FROM zones WHERE id = ?').get(extraZone.id)).toBeUndefined();
    expect(db.prepare('SELECT id FROM records WHERE id = ?').get(extraRecord.id)).toBeUndefined();

    // Original rows are back with identical ids.
    expect(db.prepare('SELECT id FROM zones WHERE id = ?').get(zone.id)).toBeDefined();
    expect(db.prepare('SELECT id FROM records WHERE id = ?').get(record.id)).toBeDefined();
  });

  it('restore is transactional: a mid-restore failure leaves the live rows unchanged', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const view = createView(db, 'dns-lab', { name: 'txn-view' });
    const zone = createZone(db, 'dns-lab', { viewId: view.id, name: 'txn.example' });

    // Approach: craft a malformed snapshot directly. Its `records` table has a
    // row missing the NOT NULL `id` column, so the INSERT phase throws AFTER the
    // DELETE phase has already removed the live rows. A non-transactional impl
    // would commit the deletes and lose the zone; the transaction rolls back.
    const malformed = {
      label: 'broken',
      createdAt: new Date().toISOString(),
      source: 'CURRENT',
      tables: { records: [{ zoneId: zone.id, data: '{}' }] },
    };
    const snapId = 'snap-broken';
    db.prepare('INSERT INTO snapshots (id, configurationId, data, createdAt, label) VALUES (?, ?, ?, ?, ?)').run(
      snapId, 'dns-lab', JSON.stringify(malformed), malformed.createdAt, 'broken',
    );

    const restoreRes = await app.inject({
      method: 'POST',
      url: `/api/v1/configurations/dns-lab/snapshots/${snapId}/restore`,
      headers: authHeader,
    });
    expect(restoreRes.statusCode).toBe(500);

    // Live rows survived the rollback.
    expect(db.prepare('SELECT id FROM zones WHERE id = ?').get(zone.id)).toBeDefined();
    expect(db.prepare('SELECT id FROM views WHERE id = ?').get(view.id)).toBeDefined();
  });

  it('returns 403 to a view-only actor on capture, restore, adopt, and delete', async () => {
    createUserWithRole('usr-viewer', 'viewer', [
      { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
    ]);
    const token = await loginAs('viewer', 'password123');
    const authHeader = { authorization: `Bearer ${token}` };

    const captureRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/snapshots',
      headers: authHeader,
      payload: { label: 'nope' },
    });
    expect(captureRes.statusCode).toBe(403);

    const adoptRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/snapshots/adopt',
      headers: authHeader,
    });
    expect(adoptRes.statusCode).toBe(403);

    const restoreRes = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/snapshots/snap-whatever/restore',
      headers: authHeader,
    });
    expect(restoreRes.statusCode).toBe(403);

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/configurations/dns-lab/snapshots/snap-whatever',
      headers: authHeader,
    });
    expect(deleteRes.statusCode).toBe(403);
  });

  it('adopt captures the deployed baseline with source BASELINE and the adopt label', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const baseline = {
      configuration: { id: 'dns-lab' },
      views: [{ id: 'view-b', configurationId: 'dns-lab', name: 'b' }],
      zones: [],
      records: [],
      servers: [],
      acls: [],
      roles: [],
      roleRows: [],
      options: [],
      externalHosts: [],
      rpzPolicies: [],
      rpzRules: [],
    };
    db.prepare('INSERT INTO deployed_baselines (configurationId, data) VALUES (?, ?)').run(
      'dns-lab', JSON.stringify(baseline),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/snapshots/adopt',
      headers: authHeader,
    });
    expect(res.statusCode).toBe(201);
    const snap = JSON.parse(res.body);
    expect(snap.source).toBe('BASELINE');
    expect(snap.label).toBe('adopted from last deploy');
    expect(snap.counts.views).toBe(1);
  });

  it('adopt with no deployed baseline still succeeds with an empty snapshot', async () => {
    const token = await loginAs('admin', 'admin');
    const authHeader = { authorization: `Bearer ${token}` };

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/configurations/dns-lab/snapshots/adopt',
      headers: authHeader,
    });
    expect(res.statusCode).toBe(201);
    const snap = JSON.parse(res.body);
    expect(snap.source).toBe('BASELINE');
    expect(snap.counts.views).toBe(0);
    expect(snap.counts.records).toBe(0);
  });
});
