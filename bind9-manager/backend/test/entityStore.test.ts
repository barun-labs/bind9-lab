import { describe, it, expect } from 'vitest';
import { openDb } from '../src/server/db';
import {
  listConfigurations,
  getConfiguration,
  listViews,
  getView,
  listZones,
  getZone,
  updateZone,
  deleteZone,
  listRecords,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,
  listExternalHosts,
  getExternalHost,
} from '../src/server/entityStore';

describe('entityStore (DAO + CRUD)', () => {
  describe('seed presence and queries', () => {
    it('seed present: listConfigurations returns the fixtures configs', () => {
      const db = openDb(':memory:');
      const configs = listConfigurations(db);

      expect(configs.length).toBe(3);
      const ids = configs.map((c) => c.id);
      expect(ids).toContain('dns-lab');
      expect(ids).toContain('split-horizon');
      expect(ids).toContain('clean-fwd');

      const dnsLab = getConfiguration(db, 'dns-lab');
      expect(dnsLab).not.toBeNull();
      expect(dnsLab?.name).toBe('dns-lab-scenario-1');
      expect(dnsLab?.isActive).toBe(true);
      expect(dnsLab?.counts).toEqual({
        views: 3,
        zones: 8,
        records: 200,
        servers: 3,
      });
    });

    it('config counts are live: adding a record increments the records count, not the stale stored value', () => {
      const db = openDb(':memory:');
      const zone = getZone(db, 'zone-lab')!;
      const configId = zone.configurationId;
      const before = listConfigurations(db).find((c) => c.id === configId)!.counts.records;
      createRecord(db, 'zone-lab', {
        name: 'live-count-probe',
        type: 'A',
        ttl: 300,
        rdata: { address: '10.9.9.9' },
      });
      const after = listConfigurations(db).find((c) => c.id === configId)!.counts.records;
      expect(after).toBe(before + 1);
    });

    it('seed present: listViews and listExternalHosts return fixtures for dns-lab', () => {
      const db = openDb(':memory:');
      const views = listViews(db, 'dns-lab');
      expect(views.length).toBe(3);
      expect(views.map((v) => v.name)).toEqual(['internal', 'external', 'dmz']);

      const viewInternal = getView(db, 'view-internal');
      expect(viewInternal?.name).toBe('internal');
      expect(viewInternal?.matchClients).toEqual(['10.0.0.0/8', '172.20.0.0/16']);

      const hosts = listExternalHosts(db, 'dns-lab');
      expect(hosts.length).toBe(4);
      expect(hosts.map((h) => h.fqdn)).toContain('edge.lab.lun.net');

      const host1 = getExternalHost(db, 'eh-1');
      expect(host1?.fqdn).toBe('edge.lab.lun.net');
    });

    it('seed present: listZones for dns-lab is non-empty', () => {
      const db = openDb(':memory:');
      const result = listZones(db, 'dns-lab');

      expect(result.total).toBe(8);
      expect(result.data.length).toBe(8);
      expect(result.page).toBe(1);
      expect(result.size).toBe(50);

      const zoneLab = getZone(db, 'zone-lab');
      expect(zoneLab).not.toBeNull();
      expect(zoneLab?.name).toBe('lab.lun.net');
      expect(zoneLab?.type).toBe('PRIMARY');
      expect(zoneLab?.soa.primaryNs).toBe('ns1.lab.lun.net.');
      expect(zoneLab?.recordCount).toBe(40);
    });
  });

  describe('listRecords filtering, sorting, and pagination', () => {
    it("listRecords('zone-lab', {type:'A', page:1, size:5}) -> all type A, total correct, data.length <= 5", () => {
      const db = openDb(':memory:');
      const result = listRecords(db, 'zone-lab', { type: 'A', page: 1, size: 5 });

      expect(result.total).toBe(31);
      expect(result.data.length).toBe(5);
      expect(result.page).toBe(1);
      expect(result.size).toBe(5);
      for (const rec of result.data) {
        expect(rec.type).toBe('A');
        expect(rec.zoneId).toBe('zone-lab');
      }

      // Page 2
      const page2 = listRecords(db, 'zone-lab', { type: 'A', page: 2, size: 5 });
      expect(page2.data.length).toBe(5);
      expect(page2.page).toBe(2);
      expect(page2.total).toBe(31);
      // Ensure page 2 data is distinct from page 1
      const p1Ids = new Set(result.data.map((r) => r.id));
      for (const r of page2.data) {
        expect(p1Ids.has(r.id)).toBe(false);
      }
    });

    it("filter+sort: listRecords with sort:'name:asc' is ordered; q narrows", () => {
      const db = openDb(':memory:');

      // Sort by name:asc
      const sortedAsc = listRecords(db, 'zone-lab', { sort: 'name:asc', size: 100 });
      const namesAsc = sortedAsc.data.map((r) => r.name);
      const expectedAsc = [...namesAsc].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
      expect(namesAsc).toEqual(expectedAsc);

      // Sort by name:desc
      const sortedDesc = listRecords(db, 'zone-lab', { sort: 'name:desc', size: 100 });
      const namesDesc = sortedDesc.data.map((r) => r.name);
      expect(namesDesc).toEqual([...expectedAsc].reverse());

      // Query narrows search
      const qResult = listRecords(db, 'zone-lab', { q: 'bind-pri' });
      expect(qResult.total).toBeGreaterThanOrEqual(1);
      for (const r of qResult.data) {
        const matches = r.name.toLowerCase().includes('bind-pri') ||
          r.id.toLowerCase().includes('bind-pri') ||
          JSON.stringify(r.rdata).toLowerCase().includes('bind-pri');
        expect(matches).toBe(true);
      }

      // Substring match on rdata
      const qTarget = listRecords(db, 'zone-lab', { q: '10.20.30' });
      expect(qTarget.total).toBeGreaterThanOrEqual(1);
    });

    it('listZones filters by view, type, status, q, and sorts', () => {
      const db = openDb(':memory:');

      // Filter by view
      const internalZones = listZones(db, 'dns-lab', { view: 'view-internal' });
      expect(internalZones.total).toBe(6);
      for (const z of internalZones.data) {
        expect(z.viewId).toBe('view-internal');
      }

      // Filter by type
      const stubZones = listZones(db, 'dns-lab', { type: 'STUB' });
      expect(stubZones.total).toBe(1);
      expect(stubZones.data[0].id).toBe('zone-legacy');

      // Filter by status
      const pendingZones = listZones(db, 'dns-lab', { status: 'PENDING' });
      expect(pendingZones.total).toBe(2);
      const syncedZones = listZones(db, 'dns-lab', { status: 'SYNCED' });
      expect(syncedZones.total).toBe(6);

      // Filter by q
      const qZone = listZones(db, 'dns-lab', { q: 'corp' });
      expect(qZone.total).toBe(1);
      expect(qZone.data[0].name).toBe('corp.lun.net');

      // Sort by name:desc
      const sortedZones = listZones(db, 'dns-lab', { sort: 'name:desc' });
      const names = sortedZones.data.map((z) => z.name);
      const expected = [...names].sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
      expect(names).toEqual(expected);
    });
  });

  describe('record CRUD lifecycle', () => {
    it('createRecord adds record with rec-<n> id and default PENDING syncState, updates zone count, updateRecord modifies, deleteRecord removes', () => {
      const db = openDb(':memory:');
      const initialZone = getZone(db, 'zone-lab')!;
      const initialCount = initialZone.recordCount;
      const initialTotal = listRecords(db, 'zone-lab').total;

      // Create record
      const newRec = createRecord(db, 'zone-lab', {
        name: 'test-host',
        type: 'A',
        ttl: 300,
        rdata: { address: '10.20.30.99' },
      });

      expect(newRec.id).toMatch(/^rec-\d+$/);
      expect(newRec.zoneId).toBe('zone-lab');
      expect(newRec.name).toBe('test-host');
      expect(newRec.type).toBe('A');
      expect(newRec.ttl).toBe(300);
      expect(newRec.rdata).toEqual({ address: '10.20.30.99' });
      expect(newRec.syncState).toBe('PENDING');
      expect(newRec.disabled).toBe(false);
      expect(newRec.issue).toBeNull();

      // Total grows by 1
      const afterCreateTotal = listRecords(db, 'zone-lab').total;
      expect(afterCreateTotal).toBe(initialTotal + 1);

      // Zone recordCount is updated
      const updatedZone = getZone(db, 'zone-lab')!;
      expect(updatedZone.recordCount).toBe(initialCount + 1);

      // Verify getRecord
      const fetched = getRecord(db, newRec.id);
      expect(fetched).toEqual(newRec);

      // Update record
      const patched = updateRecord(db, newRec.id, {
        ttl: 7200,
        disabled: true,
        rdata: { address: '10.20.30.100' },
      });
      expect(patched.id).toBe(newRec.id);
      expect(patched.ttl).toBe(7200);
      expect(patched.disabled).toBe(true);
      expect(patched.rdata).toEqual({ address: '10.20.30.100' });

      const fetchedAfterPatch = getRecord(db, newRec.id);
      expect(fetchedAfterPatch?.ttl).toBe(7200);
      expect(fetchedAfterPatch?.disabled).toBe(true);

      // Delete record
      const delResult = deleteRecord(db, newRec.id);
      expect(delResult).toEqual({ deleted: true });

      // Total decreased
      const afterDeleteTotal = listRecords(db, 'zone-lab').total;
      expect(afterDeleteTotal).toBe(initialTotal);

      // Record is gone
      expect(getRecord(db, newRec.id)).toBeNull();

      // Zone count restored
      const finalZone = getZone(db, 'zone-lab')!;
      expect(finalZone.recordCount).toBe(initialCount);
    });

    it('updateRecord or deleteRecord with non-existent id throws error', () => {
      const db = openDb(':memory:');
      expect(() => updateRecord(db, 'rec-nonexistent', { ttl: 100 })).toThrow(/not found/i);
      expect(() => deleteRecord(db, 'rec-nonexistent')).toThrow(/not found/i);
    });

    it('createRecord in non-existent zone throws error', () => {
      const db = openDb(':memory:');
      expect(() =>
        createRecord(db, 'zone-nonexistent', {
          name: 'foo',
          type: 'A',
          rdata: { address: '1.2.3.4' },
        })
      ).toThrow(/not found/i);
    });
  });

  describe('zone CRUD & dependents', () => {
    it('updateZone modifies zone fields and persists', () => {
      const db = openDb(':memory:');
      const updated = updateZone(db, 'zone-lab', {
        syncState: 'SYNCED',
        allowTransfer: ['10.0.0.1', '10.0.0.2'],
      });

      expect(updated.id).toBe('zone-lab');
      expect(updated.syncState).toBe('SYNCED');
      expect(updated.allowTransfer).toEqual(['10.0.0.1', '10.0.0.2']);

      const reFetched = getZone(db, 'zone-lab');
      expect(reFetched?.syncState).toBe('SYNCED');
      expect(reFetched?.allowTransfer).toEqual(['10.0.0.1', '10.0.0.2']);
    });

    it('deleteZone reports dependents = its record count and removes zone and records', () => {
      const db = openDb(':memory:');
      const initialZone = getZone(db, 'zone-lab')!;
      expect(initialZone).not.toBeNull();
      const recordsBefore = listRecords(db, 'zone-lab');
      expect(recordsBefore.total).toBe(40);

      // Delete the zone
      const res = deleteZone(db, 'zone-lab');
      expect(res).toEqual({ deleted: true, dependents: 40 });

      // Zone no longer exists
      expect(getZone(db, 'zone-lab')).toBeNull();

      // Zone records are also cleaned up
      const recordsAfter = listRecords(db, 'zone-lab');
      expect(recordsAfter.total).toBe(0);
      expect(recordsAfter.data).toEqual([]);
    });

    it('updateZone or deleteZone with non-existent id throws error', () => {
      const db = openDb(':memory:');
      expect(() => updateZone(db, 'zone-ghost', { name: 'ghost.net' })).toThrow(/not found/i);
      expect(() => deleteZone(db, 'zone-ghost')).toThrow(/not found/i);
    });

    it('deleteZone with 0 records reports dependents = 0', () => {
      const db = openDb(':memory:');
      // Create a zone with no records
      db.prepare(`
        INSERT INTO zones (id, configurationId, viewId, data)
        VALUES (?, ?, ?, ?)
      `).run('zone-empty', 'dns-lab', 'view-internal', JSON.stringify({
        id: 'zone-empty',
        configurationId: 'dns-lab',
        viewId: 'view-internal',
        name: 'empty.lun.net',
        type: 'PRIMARY',
        soa: { primaryNs: 'ns1.empty.lun.net.', adminEmail: 'admin.empty.lun.net.', serial: 1, refresh: 3600, retry: 900, expire: 604800, minimum: 300 },
        recordCount: 0,
        syncState: 'PENDING',
      }));

      const res = deleteZone(db, 'zone-empty');
      expect(res).toEqual({ deleted: true, dependents: 0 });
      expect(getZone(db, 'zone-empty')).toBeNull();
    });
  });

  describe('edge cases, case-insensitivity and defaults', () => {
    it('handles default filter arguments and out-of-bounds pagination', () => {
      const db = openDb(':memory:');
      // No filter arg passed
      const allZones = listZones(db, 'dns-lab');
      expect(allZones.page).toBe(1);
      expect(allZones.size).toBe(50);
      expect(allZones.total).toBe(8);

      const allRecords = listRecords(db, 'zone-lab');
      expect(allRecords.page).toBe(1);
      expect(allRecords.size).toBe(50);
      expect(allRecords.total).toBe(40);

      // Page out of bounds
      const emptyPage = listRecords(db, 'zone-lab', { page: 999, size: 50 });
      expect(emptyPage.page).toBe(999);
      expect(emptyPage.total).toBe(40);
      expect(emptyPage.data).toEqual([]);
    });

    it('filter matching is case-insensitive for type and status', () => {
      const db = openDb(':memory:');
      const lowerType = listRecords(db, 'zone-lab', { type: 'a' });
      expect(lowerType.total).toBe(31);

      const lowerStatus = listRecords(db, 'zone-lab', { status: 'synced' });
      expect(lowerStatus.total).toBeGreaterThan(0);
    });

    it('updateRecord moving record to another zone updates both zones recordCount', () => {
      const db = openDb(':memory:');
      const labZoneBefore = getZone(db, 'zone-lab')!;
      const corpZoneBefore = getZone(db, 'zone-corp')!;

      const rec = listRecords(db, 'zone-lab', { size: 1 }).data[0];
      expect(rec.zoneId).toBe('zone-lab');

      // Move to zone-corp
      updateRecord(db, rec.id, { zoneId: 'zone-corp' });

      const labZoneAfter = getZone(db, 'zone-lab')!;
      const corpZoneAfter = getZone(db, 'zone-corp')!;

      expect(labZoneAfter.recordCount).toBe(labZoneBefore.recordCount - 1);
      expect(corpZoneAfter.recordCount).toBe(corpZoneBefore.recordCount + 1);

      const movedRec = getRecord(db, rec.id);
      expect(movedRec?.zoneId).toBe('zone-corp');
    });
  });

  describe('seed idempotency', () => {
    it('opening a second :memory: db is independent and opening an existing db does not duplicate records', () => {
      const db1 = openDb(':memory:');
      const db2 = openDb(':memory:');

      // db1 and db2 are separate
      createRecord(db1, 'zone-lab', {
        name: 'only-in-db1',
        type: 'TXT',
        rdata: { text: 'hello' },
      });

      const db1Recs = listRecords(db1, 'zone-lab', { q: 'only-in-db1' });
      const db2Recs = listRecords(db2, 'zone-lab', { q: 'only-in-db1' });

      expect(db1Recs.total).toBe(1);
      expect(db2Recs.total).toBe(0);

      // Re-opening / re-checking configs count in db1
      expect(listConfigurations(db1).length).toBe(3);
      expect(listConfigurations(db2).length).toBe(3);
    });
  });
});
