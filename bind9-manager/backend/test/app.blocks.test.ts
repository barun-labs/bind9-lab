import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import { createView, createZone, createRecord } from '../src/server/entityStore';

describe('Blocks API', () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = openDb(':memory:');
    app = buildApp(db);
  });

  async function loginAs(username = 'admin', password = 'admin'): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/v1/sessions', payload: { username, password } });
    return JSON.parse(res.body).token;
  }
  const authHeader = (t: string) => ({ authorization: `Bearer ${t}` });

  it('creates a BLOCK then a contained NETWORK, server-generating ids', async () => {
    const token = await loginAs();
    const block = JSON.parse((await app.inject({
      method: 'POST', url: '/api/v1/configurations/dns-lab/blocks', headers: authHeader(token),
      payload: { name: 'ten', cidr: '10.0.0.0/8', kind: 'BLOCK' },
    })).body);
    expect(block.id.startsWith('blk-')).toBe(true);
    expect(block.parentBlockId).toBeNull();

    const view = createView(db, 'dns-lab', { name: 'internal' });
    const net = await app.inject({
      method: 'POST', url: '/api/v1/configurations/dns-lab/blocks', headers: authHeader(token),
      payload: { name: 'lab-net', cidr: '10.20.1.0/24', kind: 'NETWORK', parentBlockId: block.id, viewId: view.id },
    });
    expect(net.statusCode).toBe(201);
    expect(JSON.parse(net.body).kind).toBe('NETWORK');
  });

  it('rejects a malformed CIDR with 422 INVALID_CIDR', async () => {
    const token = await loginAs();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/configurations/dns-lab/blocks', headers: authHeader(token),
      payload: { name: 'bad', cidr: '10.0.0.0/33', kind: 'BLOCK' },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_CIDR');
  });

  it('rejects a child not inside its parent (422 INVALID_HIERARCHY) — must-fail control', async () => {
    const token = await loginAs();
    const parent = JSON.parse((await app.inject({
      method: 'POST', url: '/api/v1/configurations/dns-lab/blocks', headers: authHeader(token),
      payload: { name: 'ten', cidr: '10.0.0.0/8', kind: 'BLOCK' },
    })).body);
    const res = await app.inject({
      method: 'POST', url: '/api/v1/configurations/dns-lab/blocks', headers: authHeader(token),
      payload: { name: 'outside', cidr: '192.168.0.0/16', kind: 'BLOCK', parentBlockId: parent.id },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_HIERARCHY');
  });

  it('rejects overlapping siblings and a NETWORK given children', async () => {
    const token = await loginAs();
    const parent = JSON.parse((await app.inject({
      method: 'POST', url: '/api/v1/configurations/dns-lab/blocks', headers: authHeader(token),
      payload: { name: 'ten', cidr: '10.0.0.0/8', kind: 'BLOCK' },
    })).body);
    await app.inject({
      method: 'POST', url: '/api/v1/configurations/dns-lab/blocks', headers: authHeader(token),
      payload: { name: 'a', cidr: '10.20.0.0/16', kind: 'BLOCK', parentBlockId: parent.id },
    });
    const overlap = await app.inject({
      method: 'POST', url: '/api/v1/configurations/dns-lab/blocks', headers: authHeader(token),
      payload: { name: 'b', cidr: '10.20.1.0/24', kind: 'BLOCK', parentBlockId: parent.id },
    });
    expect(overlap.statusCode).toBe(422); // overlaps sibling 10.20.0.0/16

    const net = JSON.parse((await app.inject({
      method: 'POST', url: '/api/v1/configurations/dns-lab/blocks', headers: authHeader(token),
      payload: { name: 'leaf', cidr: '10.30.0.0/16', kind: 'NETWORK', parentBlockId: parent.id, viewId: createView(db, 'dns-lab', { name: 'v' }).id },
    })).body);
    const child = await app.inject({
      method: 'POST', url: '/api/v1/configurations/dns-lab/blocks', headers: authHeader(token),
      payload: { name: 'under-net', cidr: '10.30.1.0/24', kind: 'BLOCK', parentBlockId: net.id },
    });
    expect(child.statusCode).toBe(422); // a NETWORK may not be a parent
  });

  it('requires a valid viewId for a NETWORK (422 INVALID_VIEW)', async () => {
    const token = await loginAs();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/configurations/dns-lab/blocks', headers: authHeader(token),
      payload: { name: 'net', cidr: '10.40.0.0/24', kind: 'NETWORK', viewId: 'view-nope' },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_VIEW');
  });

  it('refuses to delete a block that has children (422 HAS_CHILDREN)', async () => {
    const token = await loginAs();
    const parent = JSON.parse((await app.inject({
      method: 'POST', url: '/api/v1/configurations/dns-lab/blocks', headers: authHeader(token),
      payload: { name: 'ten', cidr: '10.0.0.0/8', kind: 'BLOCK' },
    })).body);
    await app.inject({
      method: 'POST', url: '/api/v1/configurations/dns-lab/blocks', headers: authHeader(token),
      payload: { name: 'child', cidr: '10.20.0.0/16', kind: 'BLOCK', parentBlockId: parent.id },
    });
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/configurations/dns-lab/blocks/${parent.id}`, headers: authHeader(token) });
    expect(del.statusCode).toBe(422);
    expect(JSON.parse(del.body).error.code).toBe('HAS_CHILDREN');
  });

  it('returns 403 to a non-admin non-editor', async () => {
    const { salt, hash } = hashPassword('password123');
    db.prepare(`INSERT INTO users (id, username, displayName, isActive, roles, pwSalt, pwHash, createdAt)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?)`).run('usr-v', 'viewer', 'viewer',
      JSON.stringify([{ configurationId: 'dns-lab', role: 'viewer', canDeploy: false }]), salt, hash, new Date().toISOString());
    const token = await loginAs('viewer', 'password123');
    const res = await app.inject({
      method: 'POST', url: '/api/v1/configurations/dns-lab/blocks', headers: authHeader(token),
      payload: { name: 'x', cidr: '10.0.0.0/8', kind: 'BLOCK' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects PATCHing a parent cidr that no longer contains its child (422 INVALID_HIERARCHY)', async () => {
    const token = await loginAs();
    const parent = JSON.parse((await app.inject({
      method: 'POST', url: '/api/v1/configurations/dns-lab/blocks', headers: authHeader(token),
      payload: { name: 'ten', cidr: '10.0.0.0/8', kind: 'BLOCK' },
    })).body);
    await app.inject({
      method: 'POST', url: '/api/v1/configurations/dns-lab/blocks', headers: authHeader(token),
      payload: { name: 'child', cidr: '10.20.0.0/16', kind: 'BLOCK', parentBlockId: parent.id },
    });
    const patch = await app.inject({
      method: 'PATCH', url: `/api/v1/configurations/dns-lab/blocks/${parent.id}`, headers: authHeader(token),
      payload: { cidr: '10.0.0.0/16' },
    });
    expect(patch.statusCode).toBe(422);
    expect(JSON.parse(patch.body).error.code).toBe('INVALID_HIERARCHY');

    const readBack = await app.inject({ method: 'GET', url: `/api/v1/configurations/dns-lab/blocks/${parent.id}`, headers: authHeader(token) });
    expect(JSON.parse(readBack.body).cidr).toBe('10.0.0.0/8');
  });

  it('rejects PATCHing a NETWORK viewId to a missing view (422 INVALID_VIEW)', async () => {
    const token = await loginAs();
    const view = createView(db, 'dns-lab', { name: 'internal' });
    const net = JSON.parse((await app.inject({
      method: 'POST', url: '/api/v1/configurations/dns-lab/blocks', headers: authHeader(token),
      payload: { name: 'net', cidr: '10.40.0.0/24', kind: 'NETWORK', viewId: view.id },
    })).body);
    const patch = await app.inject({
      method: 'PATCH', url: `/api/v1/configurations/dns-lab/blocks/${net.id}`, headers: authHeader(token),
      payload: { viewId: 'view-nope' },
    });
    expect(patch.statusCode).toBe(422);
    expect(JSON.parse(patch.body).error.code).toBe('INVALID_VIEW');
  });

  it('enumerates every IP in a NETWORK block with allocation status', async () => {
    const token = await loginAs();
    const view = createView(db, 'dns-lab', { name: 'internal' });
    const zone = createZone(db, 'dns-lab', { viewId: view.id, name: 'example.test' });
    createRecord(db, zone.id, { name: 'host', type: 'A', ttl: 3600, rdata: { address: '10.10.10.10' } });
    const net = JSON.parse((await app.inject({
      method: 'POST', url: '/api/v1/configurations/dns-lab/blocks', headers: authHeader(token),
      payload: { name: 'lab-net', cidr: '10.10.10.0/24', kind: 'NETWORK', viewId: view.id },
    })).body);

    const res = await app.inject({
      method: 'GET', url: `/api/v1/configurations/dns-lab/blocks/${net.id}/addresses?offset=0&limit=256`, headers: authHeader(token),
    });
    expect(res.statusCode).toBe(200);
    const page = JSON.parse(res.body);
    expect(page.total).toBe(256);
    const byIp = new Map<string, any>(page.data.map((a: any) => [a.ip, a]));
    expect(byIp.get('10.10.10.10').status).toBe('allocated');
    expect(byIp.get('10.10.10.10').recordName).toBe('host');
    expect(byIp.get('10.10.10.0').status).toBe('network');
    expect(byIp.get('10.10.10.255').status).toBe('broadcast');
    expect(byIp.get('10.10.10.1').status).toBe('free');
  });
});
