import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { createView, createZone, listRecords } from '../src/server/entityStore';
import { createBlock } from '../src/server/blockStore';

describe('reverse PTR auto-sync', () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;
  let viewId: string;
  let fwdZoneId: string;

  beforeEach(() => {
    db = openDb(':memory:');
    app = buildApp(db);
    const view = createView(db, 'dns-lab', { name: 'internal' });
    viewId = view.id;
    fwdZoneId = createZone(db, 'dns-lab', { viewId, name: 'lab.example', type: 'PRIMARY' }).id;
    // NETWORK 192.0.2.0/24 whose reverse zones live in `view`.
    createBlock(db, 'dns-lab', { name: 'net', cidr: '192.0.2.0/24', kind: 'NETWORK', viewId });
  });

  async function loginAs(): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/v1/sessions', payload: { username: 'admin', password: 'admin' } });
    return JSON.parse(res.body).token;
  }
  const authHeader = (t: string) => ({ authorization: `Bearer ${t}` });

  function ptrZoneRecords(): { zoneName: string; ptrNames: string[] } | null {
    const zoneRow = db.prepare("SELECT data FROM zones WHERE json_extract(data,'$.name') = ?").get('2.0.192.in-addr.arpa') as { data: string } | undefined;
    if (!zoneRow) return null;
    const zone = JSON.parse(zoneRow.data);
    const recs = listRecords(db, zone.id).data.filter((r: any) => r.type === 'PTR');
    return { zoneName: zone.name, ptrNames: recs.map((r: any) => `${r.name}->${r.rdata.target}`) };
  }

  it('creates a PTR in a lazily-created /24 reverse zone when an in-range A is added', async () => {
    const token = await loginAs();
    const res = await app.inject({
      method: 'POST', url: `/api/v1/zones/${fwdZoneId}/records`, headers: authHeader(token),
      payload: { name: 'web', type: 'A', ttl: 3600, rdata: { type: 'A', address: '192.0.2.10' } },
    });
    expect(res.statusCode).toBe(201);
    const rev = ptrZoneRecords();
    expect(rev).not.toBeNull();
    expect(rev!.zoneName).toBe('2.0.192.in-addr.arpa');
    expect(rev!.ptrNames).toContain('10.2.0.192.in-addr.arpa->web.lab.example.');
  });

  it('moves the PTR when the A address changes', async () => {
    const token = await loginAs();
    const created = JSON.parse((await app.inject({
      method: 'POST', url: `/api/v1/zones/${fwdZoneId}/records`, headers: authHeader(token),
      payload: { name: 'web', type: 'A', ttl: 3600, rdata: { type: 'A', address: '192.0.2.10' } },
    })).body);
    await app.inject({
      method: 'PATCH', url: `/api/v1/records/${created.id}`, headers: authHeader(token),
      payload: { rdata: { type: 'A', address: '192.0.2.20' } },
    });
    const names = ptrZoneRecords()!.ptrNames;
    expect(names).toContain('20.2.0.192.in-addr.arpa->web.lab.example.');
    expect(names).not.toContain('10.2.0.192.in-addr.arpa->web.lab.example.');
  });

  it('removes the PTR when the A is deleted', async () => {
    const token = await loginAs();
    const created = JSON.parse((await app.inject({
      method: 'POST', url: `/api/v1/zones/${fwdZoneId}/records`, headers: authHeader(token),
      payload: { name: 'web', type: 'A', ttl: 3600, rdata: { type: 'A', address: '192.0.2.10' } },
    })).body);
    await app.inject({ method: 'DELETE', url: `/api/v1/records/${created.id}`, headers: authHeader(token) });
    const rev = ptrZoneRecords();
    expect(rev === null || rev.ptrNames.length === 0).toBe(true);
    const link = db.prepare('SELECT 1 FROM reverse_ptr_links WHERE forwardRecordId = ?').get(created.id);
    expect(link).toBeUndefined();
  });

  it('creates NO PTR for an A outside every managed network — must-fail control', async () => {
    const token = await loginAs();
    await app.inject({
      method: 'POST', url: `/api/v1/zones/${fwdZoneId}/records`, headers: authHeader(token),
      payload: { name: 'other', type: 'A', ttl: 3600, rdata: { type: 'A', address: '203.0.113.5' } },
    });
    const outZone = db.prepare("SELECT 1 FROM zones WHERE json_extract(data,'$.name') = ?").get('113.0.203.in-addr.arpa');
    expect(outZone).toBeUndefined();
    const anyLink = db.prepare('SELECT count(*) AS c FROM reverse_ptr_links').get() as { c: number };
    expect(anyLink.c).toBe(0);
  });

  it('reconcile backfills PTRs for records that predate the block, and is idempotent', async () => {
    const token = await loginAs();
    // A second NETWORK created AFTER a forward record already exists.
    const rec = JSON.parse((await app.inject({
      method: 'POST', url: `/api/v1/zones/${fwdZoneId}/records`, headers: authHeader(token),
      payload: { name: 'db', type: 'A', ttl: 3600, rdata: { type: 'A', address: '198.51.100.7' } },
    })).body);
    // No PTR yet: 198.51.100.0/24 is not a managed network.
    expect(db.prepare("SELECT 1 FROM zones WHERE json_extract(data,'$.name') = ?").get('100.51.198.in-addr.arpa')).toBeUndefined();

    const block = JSON.parse((await app.inject({
      method: 'POST', url: '/api/v1/configurations/dns-lab/blocks', headers: authHeader(token),
      payload: { name: 'late', cidr: '198.51.100.0/24', kind: 'NETWORK', viewId },
    })).body);

    const first = await app.inject({ method: 'POST', url: `/api/v1/configurations/dns-lab/blocks/${block.id}/reconcile`, headers: authHeader(token) });
    expect(first.statusCode).toBe(200);
    expect(JSON.parse(first.body).created).toBe(1);
    expect(rec.id).toBeTruthy();

    const zoneRow = db.prepare("SELECT data FROM zones WHERE json_extract(data,'$.name') = ?").get('100.51.198.in-addr.arpa') as { data: string };
    const zone = JSON.parse(zoneRow.data);
    expect(listRecords(db, zone.id).data.some((r: any) => r.type === 'PTR' && r.name === '7.100.51.198.in-addr.arpa')).toBe(true);

    // idempotent: second reconcile creates nothing.
    const second = await app.inject({ method: 'POST', url: `/api/v1/configurations/dns-lab/blocks/${block.id}/reconcile`, headers: authHeader(token) });
    expect(JSON.parse(second.body).created).toBe(0);
  });
});
