import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Block, BlockKind } from '../../../shared/entities';
import { cidrContainsCidr, cidrsOverlap } from './ipv4';

export function listBlocks(db: Database.Database, configId: string): Block[] {
  const rows = db.prepare('SELECT data FROM blocks WHERE configurationId = ?').all(configId) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Block);
}

export function getBlock(db: Database.Database, id: string): Block | null {
  const row = db.prepare('SELECT data FROM blocks WHERE id = ?').get(id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Block) : null;
}

export function createBlock(
  db: Database.Database,
  configId: string,
  input: { name: string; cidr: string; kind: BlockKind; parentBlockId?: string | null; viewId?: string }
): Block {
  const block: Block = {
    id: 'blk-' + randomBytes(6).toString('hex'),
    configurationId: configId,
    name: input.name,
    cidr: input.cidr,
    parentBlockId: input.parentBlockId ?? null,
    kind: input.kind,
    viewId: input.viewId,
  };
  db.prepare('INSERT INTO blocks (id, configurationId, data) VALUES (?, ?, ?)').run(block.id, configId, JSON.stringify(block));
  return block;
}

export function updateBlock(
  db: Database.Database,
  id: string,
  patch: { name?: string; cidr?: string; parentBlockId?: string | null; viewId?: string }
): Block {
  const existing = getBlock(db, id);
  if (!existing) throw new Error(`Block ${id} not found`);
  const updated: Block = {
    ...existing,
    name: patch.name ?? existing.name,
    cidr: patch.cidr ?? existing.cidr,
    parentBlockId: patch.parentBlockId !== undefined ? patch.parentBlockId : existing.parentBlockId,
    viewId: patch.viewId !== undefined ? patch.viewId : existing.viewId,
  };
  db.prepare('UPDATE blocks SET data = ? WHERE id = ?').run(JSON.stringify(updated), id);
  return updated;
}

export function deleteBlock(db: Database.Database, id: string): { deleted: true } {
  db.prepare('DELETE FROM blocks WHERE id = ?').run(id);
  return { deleted: true };
}

// Hierarchy rules: child CIDR strictly inside parent; no overlap with siblings under the
// same parent (or with other roots when parentBlockId is null); a NETWORK may not be a parent.
export function validateBlockHierarchy(
  db: Database.Database,
  configId: string,
  candidate: { id?: string; cidr: string; kind: BlockKind; parentBlockId: string | null }
): { ok: true } | { ok: false; code: 'INVALID_HIERARCHY' } {
  const all = listBlocks(db, configId).filter((b) => b.id !== candidate.id);

  if (candidate.parentBlockId) {
    const parent = all.find((b) => b.id === candidate.parentBlockId);
    if (!parent) return { ok: false, code: 'INVALID_HIERARCHY' };
    if (parent.kind === 'NETWORK') return { ok: false, code: 'INVALID_HIERARCHY' };
    if (!cidrContainsCidr(parent.cidr, candidate.cidr)) return { ok: false, code: 'INVALID_HIERARCHY' };
  }

  const siblings = all.filter((b) => b.parentBlockId === candidate.parentBlockId);
  for (const sib of siblings) {
    if (cidrsOverlap(sib.cidr, candidate.cidr)) return { ok: false, code: 'INVALID_HIERARCHY' };
  }

  // When editing an existing block, its current children must stay inside the new CIDR.
  if (candidate.id) {
    const children = all.filter((b) => b.parentBlockId === candidate.id);
    for (const child of children) {
      if (!cidrContainsCidr(candidate.cidr, child.cidr)) return { ok: false, code: 'INVALID_HIERARCHY' };
    }
  }
  return { ok: true };
}
