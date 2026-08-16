import { describe, it, expect, beforeEach } from 'vitest';
import { analyzeHealth } from '../src/server/healthEngine';
import type { ConfigModel, Zone, View, Server } from '../src/config-engine/model';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';

const BASE_SOA = {
  primaryNs: 'ns1.example.com',
  adminEmail: 'admin.example.com',
  serial: 1,
  refresh: 3600,
  retry: 600,
  expire: 604800,
  minimum: 3600,
};

function makeZone(over: Partial<Zone> = {}): Zone {
  return {
    id: 'zone-1',
    configurationId: 'cfg',
    viewId: 'view-1',
    name: 'example.com',
    type: 'PRIMARY',
    soa: { ...BASE_SOA },
    recordCount: 1,
    syncState: 'SYNCED',
    ...over,
  } as Zone;
}

function makeView(over: Partial<View> = {}): View {
  return {
    id: 'view-1',
    configurationId: 'cfg',
    name: 'internal',
    order: 1,
    matchClients: ['10.0.0.0/8'],
    zoneCount: 1,
    ...over,
  } as View;
}

function makeServer(over: Partial<Server> = {}): Server {
  return {
    id: 'srv-1',
    name: 'ns1',
    serviceInterfaces: [{ address: '10.0.0.11' }],
    ...over,
  } as Server;
}

function makeModel(zones: Zone[], views: View[], servers: Server[]): ConfigModel {
  return {
    configuration: {
      id: 'cfg',
      name: 'cfg',
      isActive: true,
      createdFromTemplateId: null,
      createdAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:00.000Z',
      counts: { views: views.length, zones: zones.length, records: 0, servers: servers.length },
    },
    views,
    zones,
    records: [],
    servers,
    roles: [],
    options: [],
  };
}

describe('healthEngine.analyzeHealth', () => {
  it('returns [] for a clean model', () => {
    const clean = makeModel(
      [makeZone()],
      [makeView()],
      [makeServer()]
    );
    expect(analyzeHealth(clean)).toEqual([]);
  });

  it('detects each finding code and orders ERROR -> WARNING -> INFO', () => {
    const model = makeModel(
      [
        makeZone({ id: 'z-nosoa', name: 'noso.example.com', soa: { ...BASE_SOA, primaryNs: '' }, recordCount: 2 }),
        makeZone({ id: 'z-empty', name: 'empty.example.com', recordCount: 0 }),
        makeZone({ id: 'z-dup1', name: 'dup.example.com' }),
        makeZone({ id: 'z-dup2', name: 'dup.example.com' }),
      ],
      [
        makeView({ id: 'view-empty', matchClients: [] }),
      ],
      [
        makeServer({ id: 'srv-noif', name: 'ns0', serviceInterfaces: [] }),
        makeServer({ id: 'srv-ok' }),
      ]
    );

    const findings = analyzeHealth(model);
    const codes = findings.map((f) => f.code);

    expect(codes).toContain('ZONE_NO_SOA');
    expect(codes).toContain('DUPLICATE_ZONE_NAME');
    expect(codes).toContain('ZONE_NO_RECORDS');
    expect(codes).toContain('VIEW_NO_MATCH_CLIENTS');
    expect(codes).toContain('SERVER_NO_INTERFACES');

    const rank = { ERROR: 0, WARNING: 1, INFO: 2 } as const;
    for (let i = 1; i < findings.length; i++) {
      expect(rank[findings[i].severity]).toBeGreaterThanOrEqual(rank[findings[i - 1].severity]);
    }

    expect(findings.filter((f) => f.severity === 'ERROR').map((f) => f.code)).toContain('ZONE_NO_SOA');
    expect(findings.filter((f) => f.severity === 'ERROR').map((f) => f.code)).toContain('DUPLICATE_ZONE_NAME');
    expect(findings.filter((f) => f.severity === 'INFO').map((f) => f.code)).toContain('SERVER_NO_INTERFACES');
  });

  it('flags duplicate zone names only within the same view', () => {
    const model = makeModel(
      [
        makeZone({ id: 'z-a', name: 'same.example.com', viewId: 'view-1' }),
        makeZone({ id: 'z-b', name: 'same.example.com', viewId: 'view-2' }),
      ],
      [makeView(), makeView({ id: 'view-2', name: 'other', matchClients: ['192.168.0.0/16'] })],
      [makeServer()]
    );
    const findings = analyzeHealth(model);
    expect(findings.map((f) => f.code)).not.toContain('DUPLICATE_ZONE_NAME');
  });
});

describe('GET /api/v1/configurations/:configId/health route', () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = openDb(':memory:');
    app = buildApp(db, {});
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

  function seedConfiguration(id: string): void {
    db.prepare('INSERT INTO configurations (id, data) VALUES (?, ?)').run(
      id,
      JSON.stringify({
        id,
        name: id,
        isActive: true,
        createdFromTemplateId: null,
        createdAt: '2026-08-15T00:00:00.000Z',
        updatedAt: '2026-08-15T00:00:00.000Z',
        counts: { views: 1, zones: 1, records: 0, servers: 0 },
      })
    );
  }

  function seedView(id: string, configId: string): void {
    db.prepare('INSERT INTO views (id, configurationId, data) VALUES (?, ?, ?)').run(
      id,
      configId,
      JSON.stringify({
        id,
        configurationId: configId,
        name: 'internal',
        order: 1,
        matchClients: ['10.0.0.0/8'],
        zoneCount: 1,
      })
    );
  }

  function seedZone(id: string, configId: string, viewId: string): void {
    db.prepare('INSERT INTO zones (id, configurationId, viewId, data) VALUES (?, ?, ?, ?)').run(
      id,
      configId,
      viewId,
      JSON.stringify({
        id,
        configurationId: configId,
        viewId,
        name: 'example.com',
        type: 'PRIMARY',
        soa: { primaryNs: '', adminEmail: 'admin.example.com', serial: 1, refresh: 3600, retry: 600, expire: 604800, minimum: 3600 },
        recordCount: 0,
        syncState: 'SYNCED',
      })
    );
  }

  it('200 with { findings } for a view token', async () => {
    seedConfiguration('health-lab');
    seedView('view-1', 'health-lab');
    seedZone('zone-1', 'health-lab', 'view-1');
    createUserWithRole('usr-viewer', 'viewer-user', [
      { configurationId: 'health-lab', role: 'viewer', canDeploy: false },
    ]);
    const token = await loginAs('viewer-user', 'password123');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/health-lab/health',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.findings)).toBe(true);
    expect(body.findings.map((f: any) => f.code)).toContain('ZONE_NO_SOA');
  });

  it('403 without view permission', async () => {
    seedConfiguration('health-lab');
    seedView('view-1', 'health-lab');
    seedZone('zone-1', 'health-lab', 'view-1');
    createUserWithRole('usr-other', 'other-user', [
      { configurationId: 'other-config', role: 'viewer', canDeploy: false },
    ]);
    const token = await loginAs('other-user', 'password123');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/health-lab/health',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('FORBIDDEN');
  });

  it('404 when the configuration does not exist', async () => {
    createUserWithRole('usr-viewer', 'viewer-user', [
      { configurationId: 'missing-config', role: 'viewer', canDeploy: false },
    ]);
    const token = await loginAs('viewer-user', 'password123');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/configurations/missing-config/health',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND');
  });
});
