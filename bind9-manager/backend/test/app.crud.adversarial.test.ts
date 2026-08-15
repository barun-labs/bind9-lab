import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import { createApiKey } from '../src/server/authStore';

type App = ReturnType<typeof buildApp>;

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

function seedUser(
  db: Database.Database,
  id: string,
  username: string,
  password: string,
  roles: Array<{ configurationId: string; role: 'viewer' | 'editor' | 'admin'; canDeploy: boolean }>
): void {
  const { salt, hash } = hashPassword(password);
  db.prepare(`
    INSERT INTO users (id, username, displayName, isActive, roles, pwSalt, pwHash, createdAt)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?)
  `).run(id, username, username, JSON.stringify(roles), salt, hash, new Date().toISOString());
}

async function login(app: App, username: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    payload: { username, password },
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body).token as string;
}

/** Insert a view + zone directly into a (possibly empty) config, e.g. split-horizon. */
function seedZoneInConfig(db: Database.Database, zoneId: string, configId: string): void {
  const viewId = `view-${zoneId}`;
  db.prepare('INSERT OR IGNORE INTO views (id, configurationId, data) VALUES (?, ?, ?)').run(
    viewId,
    configId,
    JSON.stringify({ id: viewId, configurationId: configId })
  );
  const zone = {
    id: zoneId,
    configurationId: configId,
    viewId,
    name: `${zoneId}.example`,
    type: 'PRIMARY',
    recordCount: 0,
    syncState: 'SYNCED',
    soa: {},
  };
  db.prepare('INSERT OR IGNORE INTO zones (id, configurationId, viewId, data) VALUES (?, ?, ?, ?)').run(
    zoneId,
    configId,
    viewId,
    JSON.stringify(zone)
  );
}

function zoneSnapshot(db: Database.Database, zoneId: string) {
  const zoneRow = db.prepare('SELECT data FROM zones WHERE id = ?').get(zoneId) as
    | { data: string }
    | undefined;
  const recordCount = (
    db.prepare('SELECT COUNT(*) AS c FROM records WHERE zoneId = ?').get(zoneId) as { c: number }
  ).c;
  return { zoneData: zoneRow?.data ?? null, recordCount };
}

function recordSnapshot(db: Database.Database, recordId: string) {
  const row = db.prepare('SELECT data FROM records WHERE id = ?').get(recordId) as
    | { data: string }
    | undefined;
  return row?.data ?? null;
}

function totalRows(db: Database.Database, table: 'records' | 'zones'): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
}

const CRUD_GET_ROUTES = [
  '/api/v1/configurations',
  '/api/v1/configurations/dns-lab/zones',
  '/api/v1/zones/zone-lab',
  '/api/v1/zones/zone-lab/records',
  '/api/v1/configurations/dns-lab/external-hosts',
];

const CRUD_MUTATIONS: Array<{ method: 'POST' | 'PATCH' | 'DELETE'; url: string; payload?: any }> = [
  { method: 'POST', url: '/api/v1/zones/zone-lab/records', payload: { name: 'x.lab.lun.net.', type: 'A', rdata: { address: '1.2.3.4' } } },
  { method: 'PATCH', url: '/api/v1/records/rec-1', payload: { ttl: 999 } },
  { method: 'DELETE', url: '/api/v1/records/rec-1' },
  { method: 'PATCH', url: '/api/v1/zones/zone-lab', payload: { name: 'hacked.net' } },
  { method: 'DELETE', url: '/api/v1/zones/zone-lab' },
];

describe('CRUD authorization — adversarial matrix', () => {
  let db: Database.Database;
  let app: App;

  beforeEach(() => {
    db = openDb(':memory:');
    app = buildApp(db);
  });

  describe('unauthenticated: every CRUD route -> 401', () => {
    it('no Authorization header on every GET + mutation -> 401', async () => {
      for (const url of CRUD_GET_ROUTES) {
        const res = await app.inject({ method: 'GET', url });
        expect(res.statusCode, `GET ${url}`).toBe(401);
      }
      for (const m of CRUD_MUTATIONS) {
        const res = await app.inject({ method: m.method, url: m.url, payload: m.payload });
        expect(res.statusCode, `${m.method} ${m.url}`).toBe(401);
      }
    });

    it('garbage / malformed bearer -> 401 (no CRUD reachable)', async () => {
      const bad = ['Bearer nope', 'Bearer ', 'Basic x', 'admin', 'Bearer bnd_deadbeef'];
      for (const h of bad) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/configurations',
          headers: { authorization: h },
        });
        expect(res.statusCode, `auth=${h}`).toBe(401);
      }
    });
  });

  describe('viewer cannot write', () => {
    beforeEach(() => {
      seedUser(db, 'usr-viewer', 'viewer1', 'viewerpass', [
        { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
      ]);
    });

    it('viewer: all GET routes -> 200', async () => {
      const token = await login(app, 'viewer1', 'viewerpass');
      for (const url of CRUD_GET_ROUTES) {
        const res = await app.inject({ method: 'GET', url, headers: bearer(token) });
        expect(res.statusCode, `GET ${url}`).toBe(200);
      }
    });

    it('viewer: every mutation -> 403', async () => {
      const token = await login(app, 'viewer1', 'viewerpass');
      for (const m of CRUD_MUTATIONS) {
        const res = await app.inject({ method: m.method, url: m.url, headers: bearer(token), payload: m.payload });
        expect(res.statusCode, `${m.method} ${m.url}`).toBe(403);
        expect(JSON.parse(res.body).error?.code, `${m.method} ${m.url}`).toBe('FORBIDDEN');
      }
    });
  });

  describe('read-only api-key clamp (dormant in 2a)', () => {
    let keyToken: string;

    beforeEach(() => {
      const { token } = createApiKey(db, 'usr-admin', {
        name: 'ro-key',
        scopes: ['read', 'write', 'deploy'], // even with every scope granted...
        readOnly: true, // ...readOnly must still block writes
      });
      keyToken = token;
    });

    it('read-only key: GET routes -> 200 (read is allowed)', async () => {
      for (const url of CRUD_GET_ROUTES) {
        const res = await app.inject({ method: 'GET', url, headers: bearer(keyToken) });
        expect(res.statusCode, `GET ${url}`).toBe(200);
      }
    });

    it('read-only key: every mutation -> 403 (clamp fires even with write scope)', async () => {
      for (const m of CRUD_MUTATIONS) {
        const res = await app.inject({ method: m.method, url: m.url, headers: bearer(keyToken), payload: m.payload });
        expect(res.statusCode, `${m.method} ${m.url}`).toBe(403);
      }
    });
  });

  describe('scope-limited api-key', () => {
    it("key with scopes ['read'] only -> 403 on writes, 200 on reads", async () => {
      const { token } = createApiKey(db, 'usr-admin', {
        name: 'read-scope',
        scopes: ['read'],
        readOnly: false,
      });
      for (const url of CRUD_GET_ROUTES) {
        const res = await app.inject({ method: 'GET', url, headers: bearer(token) });
        expect(res.statusCode, `GET ${url}`).toBe(200);
      }
      for (const m of CRUD_MUTATIONS) {
        const res = await app.inject({ method: m.method, url: m.url, headers: bearer(token), payload: m.payload });
        expect(res.statusCode, `${m.method} ${m.url}`).toBe(403);
      }
    });

    it("key with scopes ['write'] (no read) -> can edit but cannot view", async () => {
      const { token } = createApiKey(db, 'usr-admin', {
        name: 'write-scope',
        scopes: ['write'],
        readOnly: false,
      });

      const viewZone = await app.inject({ method: 'GET', url: '/api/v1/zones/zone-lab', headers: bearer(token) });
      expect(viewZone.statusCode).toBe(403);

      const create = await app.inject({
        method: 'POST',
        url: '/api/v1/zones/zone-lab/records',
        headers: bearer(token),
        payload: { name: 'w.lab.lun.net.', type: 'A', rdata: { address: '9.9.9.9' } },
      });
      expect(create.statusCode).toBe(201);
    });
  });

  describe('cross-config isolation', () => {
    beforeEach(() => {
      seedUser(db, 'usr-lab-editor', 'labs-editor', 'labspass', [
        { configurationId: 'dns-lab', role: 'editor', canDeploy: false },
      ]);
      seedZoneInConfig(db, 'zone-split', 'split-horizon');
    });

    it('editor on dns-lab cannot read/mutate a split-horizon zone -> 403', async () => {
      const token = await login(app, 'labs-editor', 'labspass');

      const getZone = await app.inject({ method: 'GET', url: '/api/v1/zones/zone-split', headers: bearer(token) });
      expect(getZone.statusCode).toBe(403);

      const patchZone = await app.inject({
        method: 'PATCH',
        url: '/api/v1/zones/zone-split',
        headers: bearer(token),
        payload: { name: 'stolen.net' },
      });
      expect(patchZone.statusCode).toBe(403);

      const postRecord = await app.inject({
        method: 'POST',
        url: '/api/v1/zones/zone-split/records',
        headers: bearer(token),
        payload: { name: 'leak.lab.lun.net.', type: 'A', rdata: { address: '1.1.1.1' } },
      });
      expect(postRecord.statusCode).toBe(403);

      const deleteZone = await app.inject({
        method: 'DELETE',
        url: '/api/v1/zones/zone-split',
        headers: bearer(token),
      });
      expect(deleteZone.statusCode).toBe(403);
    });

    it('editor on dns-lab CAN mutate dns-lab (control: rights are not globally denied)', async () => {
      const token = await login(app, 'labs-editor', 'labspass');
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/zones/zone-lab/records',
        headers: bearer(token),
        payload: { name: 'ok.lab.lun.net.', type: 'A', rdata: { address: '2.2.2.2' } },
      });
      expect(res.statusCode).toBe(201);
    });
  });

  describe('authorize fires BEFORE store mutation', () => {
    beforeEach(() => {
      seedUser(db, 'usr-viewer', 'viewer1', 'viewerpass', [
        { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
      ]);
    });

    it('viewer 403 write attempts leave store byte-for-byte unchanged', async () => {
      const token = await login(app, 'viewer1', 'viewerpass');

      const zoneBefore = zoneSnapshot(db, 'zone-lab');
      const recBefore = recordSnapshot(db, 'rec-1');
      const zonesBefore = totalRows(db, 'zones');
      const recordsBefore = totalRows(db, 'records');

      for (const m of CRUD_MUTATIONS) {
        const res = await app.inject({ method: m.method, url: m.url, headers: bearer(token), payload: m.payload });
        expect(res.statusCode, `${m.method} ${m.url}`).toBe(403);
      }

      expect(zoneSnapshot(db, 'zone-lab')).toEqual(zoneBefore);
      expect(recordSnapshot(db, 'rec-1')).toEqual(recBefore);
      expect(totalRows(db, 'zones')).toBe(zonesBefore);
      expect(totalRows(db, 'records')).toBe(recordsBefore);
    });

    it('read-only key 403 write attempts leave store unchanged', async () => {
      const { token } = createApiKey(db, 'usr-admin', {
        name: 'ro',
        scopes: ['read', 'write'],
        readOnly: true,
      });

      const zoneBefore = zoneSnapshot(db, 'zone-lab');
      const recordsBefore = totalRows(db, 'records');

      for (const m of CRUD_MUTATIONS) {
        const res = await app.inject({ method: m.method, url: m.url, headers: bearer(token), payload: m.payload });
        expect(res.statusCode, `${m.method} ${m.url}`).toBe(403);
      }

      expect(zoneSnapshot(db, 'zone-lab')).toEqual(zoneBefore);
      expect(totalRows(db, 'records')).toBe(recordsBefore);
    });
  });

  describe('no secret leakage from CRUD responses', () => {
    it('CRUD GET bodies contain no token/keyHash/pwHash/pwSalt/password', async () => {
      const token = await login(app, 'admin', 'admin');
      for (const url of CRUD_GET_ROUTES) {
        const res = await app.inject({ method: 'GET', url, headers: bearer(token) });
        expect(res.statusCode, `GET ${url}`).toBe(200);
        const body = res.body.toLowerCase();
        for (const needle of ['"token"', '"keyhash"', '"pwhash"', '"pwsalt"', '"password"', 'bnd_']) {
          expect(body, `GET ${url} leaks ${needle}`).not.toContain(needle);
        }
      }
    });

    it('mutation response bodies (201/200) contain no secrets', async () => {
      const token = await login(app, 'admin', 'admin');
      const create = await app.inject({
        method: 'POST',
        url: '/api/v1/zones/zone-lab/records',
        headers: bearer(token),
        payload: { name: 'secret-check.lab.lun.net.', type: 'A', rdata: { address: '3.3.3.3' } },
      });
      expect(create.statusCode).toBe(201);
      expect(create.body.toLowerCase()).not.toContain('bnd_');
      expect(create.body.toLowerCase()).not.toContain('"token"');
      expect(create.body.toLowerCase()).not.toContain('"keyhash"');
    });
  });

  describe('deferred fixes', () => {
    it('DELETE /sessions/current with api-key bearer -> 400 NOT_A_SESSION (not silent 204)', async () => {
      const { token } = createApiKey(db, 'usr-admin', { name: 'k', scopes: ['read'], readOnly: false });
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/sessions/current',
        headers: bearer(token),
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error?.code).toBe('NOT_A_SESSION');
    });

    it('corrupt scopes column -> no 500 when the key authenticates and hits a CRUD route', async () => {
      const { id, token } = createApiKey(db, 'usr-admin', { name: 'corrupt', scopes: ['read'], readOnly: false });
      db.prepare('UPDATE api_keys SET scopes = ? WHERE id = ?').run('INVALID_JSON{', id);

      const res = await app.inject({ method: 'GET', url: '/api/v1/configurations', headers: bearer(token) });
      expect(res.statusCode).toBe(200); // resolves to scopes=[] -> filtered to empty list, never 500

      const adminToken = await login(app, 'admin', 'admin');
      const list = await app.inject({ method: 'GET', url: '/api/v1/api-keys', headers: bearer(adminToken) });
      expect(list.statusCode).toBe(200);
      const corrupted = (JSON.parse(list.body) as Array<{ id: string; scopes: string[] }>).find((k) => k.id === id);
      expect(corrupted?.scopes).toEqual([]);
    });
  });

  describe('robustness: bad body shapes never crash (4xx, not 500)', () => {
    it('malformed JSON body on mutation -> 4xx', async () => {
      const token = await login(app, 'admin', 'admin');
      const attempts = [
        { method: 'POST', url: '/api/v1/zones/zone-lab/records' },
        { method: 'PATCH', url: '/api/v1/records/rec-1' },
        { method: 'PATCH', url: '/api/v1/zones/zone-lab' },
      ];
      for (const a of attempts) {
        const res = await app.inject({
          method: a.method as any,
          url: a.url,
          headers: { ...bearer(token), 'content-type': 'application/json' },
          payload: '{"name": "x", "type": "A", "rdata": ',
        });
        expect(res.statusCode, `${a.method} ${a.url}`).toBeGreaterThanOrEqual(400);
        expect(res.statusCode, `${a.method} ${a.url}`).toBeLessThan(500);
      }
    });

    it('missing body on mutation -> 400 (not 500)', async () => {
      const token = await login(app, 'admin', 'admin');
      const post = await app.inject({ method: 'POST', url: '/api/v1/zones/zone-lab/records', headers: bearer(token) });
      expect(post.statusCode).toBe(400);

      const patch = await app.inject({ method: 'PATCH', url: '/api/v1/zones/zone-lab', headers: bearer(token) });
      expect(patch.statusCode).toBe(400);
    });

    it('non-object JSON body (string/number/array) -> 400 (not 500)', async () => {
      const token = await login(app, 'admin', 'admin');
      for (const payload of ['"just a string"', '42', '[1,2,3]']) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/zones/zone-lab/records',
          headers: { ...bearer(token), 'content-type': 'application/json' },
          payload,
        });
        expect(res.statusCode, `payload=${payload}`).toBe(400);
      }
    });

    it('wrong content-type -> 4xx (not 500)', async () => {
      const token = await login(app, 'admin', 'admin');
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/zones/zone-lab/records',
        headers: { ...bearer(token), 'content-type': 'text/plain' },
        payload: 'name=x',
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
    });
  });
});
