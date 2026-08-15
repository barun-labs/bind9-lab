import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from '../src/server/db';
import {
  listConfigurations,
  listZones,
  getZone,
  listRecords,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,
  updateZone,
  deleteZone,
} from '../src/server/entityStore';

const ALL = { size: 1000 };

// Independent re-implementation of the *intended* filter contract. Used as the
// oracle for "narrows correctly": every returned row must match, and `total`
// must equal the full match set (not the page).
function matchesRecordTypeStatus(r: any, f: { type?: string; status?: string }): boolean {
  if (f.type && r.type.toUpperCase() !== f.type.toUpperCase()) return false;
  if (f.status && r.syncState.toUpperCase() !== f.status.toUpperCase()) return false;
  return true;
}

describe('entityStore adversarial (independent test pass)', () => {
  describe('envelope correctness', () => {
    it('every list envelope has data/page/size/total; data.length <= size; total is a number >= data.length', () => {
      const db = openDb(':memory:');
      const calls: { data: unknown[]; page: number; size: number; total: number }[] = [
        listZones(db, 'dns-lab'),
        listZones(db, 'dns-lab', { page: 2, size: 3 }),
        listZones(db, 'dns-lab', { type: 'PRIMARY', page: 1, size: 2 }),
        listRecords(db, 'zone-lab'),
        listRecords(db, 'zone-lab', { type: 'A', page: 3, size: 5 }),
        listRecords(db, 'zone-corp', { sort: 'name:asc', size: 10 }),
      ];
      for (const env of calls) {
        expect(env).toHaveProperty('data');
        expect(env).toHaveProperty('page');
        expect(env).toHaveProperty('size');
        expect(env).toHaveProperty('total');
        expect(typeof env.total).toBe('number');
        expect(env.data.length).toBeLessThanOrEqual(env.size);
        expect(env.total).toBeGreaterThanOrEqual(env.data.length);
      }
    });

    it('total counts the FULL match set, not the page slice', () => {
      const db = openDb(':memory:');
      const aRecords = listRecords(db, 'zone-lab', { type: 'A', page: 1, size: 5 });
      // 31 A records in zone-lab; only 5 returned on this page.
      expect(aRecords.data.length).toBe(5);
      expect(aRecords.total).toBe(31);
    });

    it('page walk has no overlap and no gap against the full set (deterministic via sort)', () => {
      const db = openDb(':memory:');
      const size = 7;
      const full = listRecords(db, 'zone-lab', { size: 1000, sort: 'id:asc' });
      expect(full.total).toBe(40);

      const collected: string[] = [];
      const pages = Math.ceil(full.total / size);
      for (let p = 1; p <= pages; p++) {
        const r = listRecords(db, 'zone-lab', { size, page: p, sort: 'id:asc' });
        expect(r.page).toBe(p);
        expect(r.size).toBe(size);
        expect(r.total).toBe(full.total);
        expect(r.data.length).toBeLessThanOrEqual(size);
        collected.push(...r.data.map((x) => x.id));
      }
      const uniq = new Set(collected);
      expect(collected.length).toBe(full.total);
      expect(uniq.size).toBe(full.total);
      expect(collected).toEqual(full.data.map((x) => x.id));
    });

    it('falsy and negative page/size are handled sanely (no crash)', () => {
      const db = openDb(':memory:');
      // page 0 is falsy -> 1; size 0 is falsy -> default 50 (same as omitted).
      const zero = listRecords(db, 'zone-lab', { page: 0, size: 0 });
      expect(zero.page).toBe(1);
      expect(zero.size).toBe(50);
      expect(zero.total).toBe(40);
      expect(zero.data.length).toBeLessThanOrEqual(zero.size);

      // negative size clamps to 1; negative page clamps to 1.
      const neg = listRecords(db, 'zone-lab', { page: -3, size: -5 });
      expect(neg.page).toBe(1);
      expect(neg.size).toBe(1);
      expect(neg.data.length).toBe(1);
    });
  });

  describe('filters', () => {
    it('type and status each narrow to exactly the matching set (oracle-checked)', () => {
      const db = openDb(':memory:');
      const all = listRecords(db, 'zone-lab', ALL).data;
      const cases: { type?: string; status?: string }[] = [
        { type: 'A' },
        { type: 'a' },
        { type: 'MX' },
        { status: 'PENDING' },
        { status: 'synced' },
        { type: 'CNAME', status: 'PENDING' },
      ];
      for (const f of cases) {
        const got = listRecords(db, 'zone-lab', f);
        const expected = all.filter((r) => matchesRecordTypeStatus(r, f));
        expect(got.total).toBe(expected.length);
        expect(got.data.map((r) => r.id).sort()).toEqual(expected.map((r) => r.id).sort());
      }
    });

    it('filters combine with AND', () => {
      const db = openDb(':memory:');
      // zone-lab: only one A record is PENDING (rec-19 old-app, disabled).
      const r = listRecords(db, 'zone-lab', { type: 'A', status: 'PENDING' });
      expect(r.total).toBe(1);
      expect(r.data[0].id).toBe('rec-19');
      expect(r.data[0].disabled).toBe(true);

      // A records whose name/id contains 'bind' -> bind-pri-01, bind-sec-01, bind-cache-01.
      const q = listRecords(db, 'zone-lab', { type: 'A', q: 'bind' });
      expect(q.total).toBe(3);
      expect(q.data.every((x) => x.type === 'A')).toBe(true);
      expect(q.data.every((x) => x.name.includes('bind'))).toBe(true);
    });

    it('unknown filter value yields empty data and total 0, not a throw', () => {
      const db = openDb(':memory:');
      const byType = listRecords(db, 'zone-lab', { type: 'XYZ' });
      expect(byType.data).toEqual([]);
      expect(byType.total).toBe(0);

      const byStatus = listRecords(db, 'zone-lab', { status: 'BOGUS' });
      expect(byStatus.data).toEqual([]);
      expect(byStatus.total).toBe(0);

      const byQ = listRecords(db, 'zone-lab', { q: 'no-such-token-zzz' });
      expect(byQ.data).toEqual([]);
      expect(byQ.total).toBe(0);
    });

    it('q narrows by name and by rdata address/target/text (oracle-checked)', () => {
      const db = openDb(':memory:');
      const all = listRecords(db, 'zone-lab', ALL).data;
      for (const q of ['bind-pri', '10.20.30', 'ns1.lab']) {
        const got = listRecords(db, 'zone-lab', { q });
        const expected = all.filter((r) => JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));
        expect(got.total).toBe(expected.length);
        expect(got.data.map((r) => r.id).sort()).toEqual(expected.map((r) => r.id).sort());
      }
    });

    it('DEFECT: q does not search CAA value/tag or SRV/MX numeric rdata fields', () => {
      const db = openDb(':memory:');
      // rec-18 CAA has rdata.value "letsencrypt.org"; free-text q should find it.
      expect(listRecords(db, 'zone-lab', { q: 'letsencrypt' }).total).toBe(1);
      // rec-13 SRV has rdata.port 5060; free-text q should find it.
      expect(listRecords(db, 'zone-lab', { q: '5060' }).total).toBe(1);
    });
  });

  describe('sort', () => {
    it("zones sort by name:asc and name:desc concretely", () => {
      const db = openDb(':memory:');
      const asc = listZones(db, 'dns-lab', { sort: 'name:asc', size: 100 }).data.map((z) => z.name);
      expect(asc).toEqual([
        '10.in-addr.arpa',
        '30.20.10.in-addr.arpa',
        'corp.lun.net',
        'dmz.lun.net',
        'lab.lun.net',
        'legacy.lun.net',
        'lun.net',
        'partner.example.com',
      ]);
      const desc = listZones(db, 'dns-lab', { sort: 'name:desc', size: 100 }).data.map((z) => z.name);
      expect(desc).toEqual([...asc].reverse());
    });

    it('record name sort is numeric-aware (host2 before host10)', () => {
      const db = openDb(':memory:');
      for (const [name, addr] of [['host10', '1.1.1.10'], ['host2', '1.1.1.2'], ['host1', '1.1.1.1']] as const) {
        createRecord(db, 'zone-legacy', { name, type: 'A', rdata: { address: addr } });
      }
      const asc = listRecords(db, 'zone-legacy', { sort: 'name:asc' }).data.map((r) => r.name);
      expect(asc).toEqual(['host1', 'host2', 'host10']);
    });

    it('bad sort field does not throw; returns full set stably', () => {
      const db = openDb(':memory:');
      expect(() => listRecords(db, 'zone-lab', { sort: 'bogus:asc' })).not.toThrow();
      expect(() => listZones(db, 'dns-lab', { sort: 'nope:desc' })).not.toThrow();
      const r = listRecords(db, 'zone-lab', { sort: 'bogus:asc', size: 1000 });
      expect(r.total).toBe(40);
      expect(r.data.length).toBe(40);
    });
  });

  describe('CRUD round-trips', () => {
    it('create -> appears and total+1; getRecord returns equal object', () => {
      const db = openDb(':memory:');
      const before = listRecords(db, 'zone-lab').total;
      const rec = createRecord(db, 'zone-lab', {
        name: 'adv-probe',
        type: 'TXT',
        ttl: 60,
        rdata: { text: 'probe' },
      });
      expect(getRecord(db, rec.id)).toEqual(rec);
      expect(listRecords(db, 'zone-lab').total).toBe(before + 1);
    });

    it('update a field persists, other fields intact', () => {
      const db = openDb(':memory:');
      const rec = createRecord(db, 'zone-lab', {
        name: 'keep-intact',
        type: 'A',
        ttl: 300,
        rdata: { address: '10.99.99.1' },
      });
      const patched = updateRecord(db, rec.id, { ttl: 7200 });
      expect(patched.name).toBe('keep-intact');
      expect(patched.type).toBe('A');
      expect(patched.rdata).toEqual({ address: '10.99.99.1' });
      const refetched = getRecord(db, rec.id);
      expect(refetched?.ttl).toBe(7200);
      expect(refetched?.name).toBe('keep-intact');
    });

    it('delete -> gone and total-1', () => {
      const db = openDb(':memory:');
      const rec = createRecord(db, 'zone-lab', { name: 'to-delete', type: 'A', rdata: { address: '10.1.1.1' } });
      const before = listRecords(db, 'zone-lab').total;
      expect(deleteRecord(db, rec.id)).toEqual({ deleted: true });
      expect(getRecord(db, rec.id)).toBeNull();
      expect(listRecords(db, 'zone-lab').total).toBe(before - 1);
    });

    it('update/delete of a missing id throw (documented), not a crash', () => {
      const db = openDb(':memory:');
      expect(() => updateRecord(db, 'rec-nope', { ttl: 1 })).toThrow(/not found/i);
      expect(() => deleteRecord(db, 'rec-nope')).toThrow(/not found/i);
      expect(() => updateZone(db, 'zone-nope', { name: 'x' })).toThrow(/not found/i);
      expect(() => deleteZone(db, 'zone-nope')).toThrow(/not found/i);
    });

    it('getRecord/getZone of a missing id return null', () => {
      const db = openDb(':memory:');
      expect(getRecord(db, 'rec-nope')).toBeNull();
      expect(getZone(db, 'zone-nope')).toBeNull();
    });

    it('createRecord with a duplicate explicit id throws (not a silent overwrite)', () => {
      const db = openDb(':memory:');
      expect(() =>
        createRecord(db, 'zone-lab', { id: 'rec-1', name: 'dup', type: 'A', rdata: { address: '1.2.3.4' } })
      ).toThrow();
      // Original rec-1 intact.
      expect(getRecord(db, 'rec-1')?.name).toBe('@');
    });
  });

  describe('referential integrity', () => {
    it('deleteZone dependents = live record count (after a create)', () => {
      const db = openDb(':memory:');
      createRecord(db, 'zone-lab', { name: 'extra', type: 'A', rdata: { address: '10.1.1.2' } });
      const res = deleteZone(db, 'zone-lab');
      expect(res.deleted).toBe(true);
      expect(res.dependents).toBe(41);
    });

    it('deleteZone dependents = live record count (after a move out)', () => {
      const db = openDb(':memory:');
      const first = listRecords(db, 'zone-lab', { size: 1 }).data[0];
      updateRecord(db, first.id, { zoneId: 'zone-corp' });
      const res = deleteZone(db, 'zone-lab');
      expect(res.dependents).toBe(39);
    });

    it('after deleteZone, records are removed (no orphans) and other zones untouched', () => {
      const db = openDb(':memory:');
      const corpBefore = listRecords(db, 'zone-corp').total;
      deleteZone(db, 'zone-lab');
      // Direct SQL: no orphaned rows remain.
      const orphans = db.prepare('SELECT count(*) as cnt FROM records WHERE zoneId = ?').get('zone-lab') as { cnt: number };
      expect(orphans.cnt).toBe(0);
      expect(listRecords(db, 'zone-lab').total).toBe(0);
      expect(listRecords(db, 'zone-corp').total).toBe(corpBefore);
    });
  });

  describe('seed idempotency', () => {
    it('two :memory: dbs are independent', () => {
      const db1 = openDb(':memory:');
      const db2 = openDb(':memory:');
      createRecord(db1, 'zone-lab', { name: 'only-1', type: 'TXT', rdata: { text: 'x' } });
      expect(listRecords(db2, 'zone-lab', { q: 'only-1' }).total).toBe(0);
      expect(listRecords(db1, 'zone-lab', { q: 'only-1' }).total).toBe(1);
    });

    it('reopening the same file db does not duplicate seed rows', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entityStore-'));
      const file = path.join(dir, 'test.db');
      const counts: Record<string, number> = {};
      const readCounts = () => {
        const db = openDb(file);
        counts.configs = listConfigurations(db).length;
        counts.zones = listZones(db, 'dns-lab').total;
        counts.records = listRecords(db, 'zone-lab').total;
        db.close();
      };
      readCounts();
      const first = { ...counts };
      expect(first.configs).toBe(3);
      expect(first.zones).toBe(8);
      expect(first.records).toBe(40);
      readCounts();
      expect(counts).toEqual(first);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('JSON columns', () => {
    it('name and rdata with quotes/unicode/newline round-trip intact', () => {
      const db = openDb(':memory:');
      const name = 'vélo "fast" 日本 🚀';
      const text = 'line1\n"quoted" émoji 🎯';
      const rec = createRecord(db, 'zone-lab', { name, type: 'TXT', rdata: { text } });
      const refetched = getRecord(db, rec.id);
      expect(refetched?.name).toBe(name);
      expect(refetched?.rdata.text).toBe(text);
      // Also survives a second db round-trip via updateRecord (write/read again).
      const patched = updateRecord(db, rec.id, { ttl: 1234 });
      expect(getRecord(db, rec.id)?.rdata.text).toBe(text);
      expect(patched.name).toBe(name);
    });
  });
});
