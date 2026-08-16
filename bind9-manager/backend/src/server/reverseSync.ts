import type Database from 'better-sqlite3';
import type { ResourceRecord, Zone } from '../../../shared/entities';
import { cidrContainsIp, reversePtrName, ptrZoneName, isValidIpv4 } from './ipv4';
import { listBlocks } from './blockStore';
import { getZone, createZone, createRecord, deleteRecord } from './entityStore';

const DEFAULT_REVERSE_SOA = {
  primaryNs: 'ns.invalid.', adminEmail: 'hostmaster.invalid.',
  serial: 1, refresh: 3600, retry: 600, expire: 604800, minimum: 3600,
};

interface PtrLink { configurationId: string; forwardRecordId: string; ptrRecordId: string; ptrZoneId: string; }

function getLink(db: Database.Database, forwardRecordId: string): PtrLink | null {
  return (db.prepare('SELECT * FROM reverse_ptr_links WHERE forwardRecordId = ?').get(forwardRecordId) as PtrLink | undefined) ?? null;
}
function putLink(db: Database.Database, link: PtrLink): void {
  db.prepare('INSERT OR REPLACE INTO reverse_ptr_links (configurationId, forwardRecordId, ptrRecordId, ptrZoneId) VALUES (?, ?, ?, ?)')
    .run(link.configurationId, link.forwardRecordId, link.ptrRecordId, link.ptrZoneId);
}
function dropLink(db: Database.Database, forwardRecordId: string): void {
  db.prepare('DELETE FROM reverse_ptr_links WHERE forwardRecordId = ?').run(forwardRecordId);
}

// The forward record's fully-qualified name, used as the PTR target.
function forwardFqdn(record: ResourceRecord, forwardZone: Zone): string {
  if (record.name === '@') return forwardZone.name.endsWith('.') ? forwardZone.name : forwardZone.name + '.';
  if (record.name.endsWith('.')) return record.name;
  return `${record.name}.${forwardZone.name}.`;
}

// Find the NETWORK block whose CIDR contains the address, most specific (longest prefix) first.
function networkFor(db: Database.Database, configId: string, address: string) {
  const nets = listBlocks(db, configId).filter((b) => b.kind === 'NETWORK' && b.viewId && cidrContainsIp(b.cidr, address));
  if (nets.length === 0) return null;
  return nets.sort((a, b) => Number(b.cidr.split('/')[1]) - Number(a.cidr.split('/')[1]))[0];
}

// Raw lookup avoids the paginated list envelope; a reverse zone is unique by (view, name).
function findZoneByName(db: Database.Database, configId: string, viewId: string, name: string): Zone | null {
  const rows = db.prepare('SELECT data FROM zones WHERE configurationId = ?').all(configId) as { data: string }[];
  for (const r of rows) {
    const z = JSON.parse(r.data) as Zone;
    if (z.viewId === viewId && z.name === name) return z;
  }
  return null;
}

function materializeReverseZone(db: Database.Database, configId: string, viewId: string, address: string): Zone {
  const zoneName = ptrZoneName(address);
  const existing = findZoneByName(db, configId, viewId, zoneName);
  if (existing) return existing;
  return createZone(db, configId, { viewId, name: zoneName, type: 'PRIMARY', soa: DEFAULT_REVERSE_SOA });
}

function createPtr(db: Database.Database, record: ResourceRecord): void {
  const forwardZone = getZone(db, record.zoneId);
  if (!forwardZone) return;
  const address = (record.rdata as { address?: string }).address;
  if (!address || !isValidIpv4(address)) return;
  const net = networkFor(db, forwardZone.configurationId, address);
  if (!net || !net.viewId) return;
  const revZone = materializeReverseZone(db, forwardZone.configurationId, net.viewId, address);
  const ptr = createRecord(db, revZone.id, {
    name: reversePtrName(address), type: 'PTR', ttl: 3600,
    rdata: { type: 'PTR', target: forwardFqdn(record, forwardZone) },
  });
  putLink(db, { configurationId: forwardZone.configurationId, forwardRecordId: record.id, ptrRecordId: ptr.id, ptrZoneId: revZone.id });
}

function removePtr(db: Database.Database, forwardRecordId: string): void {
  const link = getLink(db, forwardRecordId);
  if (!link) return;
  deleteRecord(db, link.ptrRecordId);
  dropLink(db, forwardRecordId);
}

// Only A records drive reverse DNS for now. AAAA matches no IPv4 network and is a no-op.
export function reconcileReverseForRecord(db: Database.Database, record: ResourceRecord, action: 'CREATE' | 'UPDATE' | 'DELETE'): void {
  if (record.type !== 'A') return;
  if (action === 'DELETE') { removePtr(db, record.id); return; }
  if (action === 'CREATE') { createPtr(db, record); return; }
  // UPDATE: if the address is unchanged and a PTR exists, update its target in place;
  // otherwise remove-then-add (add no-ops when the new address is out of range).
  const link = getLink(db, record.id);
  const address = (record.rdata as { address?: string }).address;
  if (link && address) {
    const existingPtr = db.prepare('SELECT data FROM records WHERE id = ?').get(link.ptrRecordId) as { data: string } | undefined;
    const stillSameZone = existingPtr && (JSON.parse(existingPtr.data) as ResourceRecord).name === reversePtrName(address);
    if (stillSameZone) {
      const forwardZone = getZone(db, record.zoneId);
      if (forwardZone) {
        const ptr = JSON.parse(existingPtr!.data) as ResourceRecord;
        ptr.rdata = { type: 'PTR', target: forwardFqdn(record, forwardZone) } as ResourceRecord['rdata'];
        db.prepare('UPDATE records SET data = ? WHERE id = ?').run(JSON.stringify(ptr), ptr.id);
      }
      return;
    }
  }
  removePtr(db, record.id);
  createPtr(db, record);
}

// Backfill: generate PTRs for every in-range A record in a NETWORK that has no link yet.
export function reconcileBlock(db: Database.Database, blockId: string): { created: number } {
  const blockRow = db.prepare('SELECT data FROM blocks WHERE id = ?').get(blockId) as { data: string } | undefined;
  if (!blockRow) return { created: 0 };
  const block = JSON.parse(blockRow.data) as { configurationId: string; cidr: string; kind: string };
  if (block.kind !== 'NETWORK') return { created: 0 };
  const rows = db.prepare(
    'SELECT records.data AS data FROM records JOIN zones ON records.zoneId = zones.id WHERE zones.configurationId = ?'
  ).all(block.configurationId) as { data: string }[];
  let created = 0;
  for (const r of rows) {
    const rec = JSON.parse(r.data) as ResourceRecord;
    if (rec.type !== 'A') continue;
    const address = (rec.rdata as { address?: string }).address;
    if (!address || !cidrContainsIp(block.cidr, address)) continue;
    if (getLink(db, rec.id)) continue;
    createPtr(db, rec);
    created += 1;
  }
  return { created };
}
