# Network Blocks / Reverse-Zone IPAM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hierarchy of IPv4 network blocks and make `in-addr.arpa` reverse DNS maintain itself — a PTR appears, moves, and disappears automatically as the forward A record for an address inside a managed network is written.

**Architecture:** A `Block` metadata entity (BLOCK containers, NETWORK leaves) stored like every other entity. A dependency-free `ipv4.ts` does CIDR math. A `reverseSync` service, invoked from the three record routes after the forward write is applied, materializes a /24 `in-addr.arpa` zone on demand and mints/updates/removes the matching PTR, tracking a 1:1 forward→PTR link in a side table. Generated zones and PTRs are ordinary Zone/Record rows, so they render and deploy through the existing computed change-set / deploy-jobs pipeline with no change-set plumbing.

**Tech Stack:** Node 20 + Fastify 5 + better-sqlite3, TypeScript run via tsx, Vitest. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-16-ipam-reverse-zone-design.md`

## Global Constraints

- Backend-only. Do not touch `app/`. `shared/entities.ts` gains only the `Block`/`BlockKind` types.
- IPv4 only. AAAA records are recognized by the sync but match no IPv4 network and are a no-op.
- No new runtime dependencies. CIDR math is hand-written integer arithmetic in `ipv4.ts`.
- Ids are server-generated (`blk-` + hex for blocks; PTR ids come from `createRecord`). Client-supplied ids are ignored.
- Block CRUD and reconcile are `edit`-gated on the configuration (same predicate as other entity routes: `authorize(req.actor, 'edit', configId)`).
- Generated reverse-zone and PTR names are computed from parsed integers — never from raw user strings — so they are always `[0-9.]+\.in-addr.arpa` and injection-safe by construction.
- Reverse zones are /24-granular (`c.b.a.in-addr.arpa` for `a.b.c.d`) and materialized lazily the first time a PTR lands in them, in the NETWORK's `viewId`.
- Blocks are planning metadata: they are NOT deploy artifacts and do NOT enter the change-set. The reverse zones and PTRs they cause DO (automatically, via `computeChangeSet` diffing live DB against the deployed baseline).
- Each managed forward A record maps 1:1 to exactly one generated PTR via the `reverse_ptr_links` table.
- Every non-trivial unit ships a must-fail control test (an assertion that is false on correct code and would pass if the logic were dropped).

## File Structure

- Create `backend/src/server/ipv4.ts` — CIDR parsing, containment, overlap, reverse-name math. Pure, no db.
- Create `backend/src/server/blockStore.ts` — Block CRUD + hierarchy validation. Depends on `ipv4.ts` and the db.
- Create `backend/src/server/reverseSync.ts` — `reconcileReverseForRecord`, `reconcileBlock`, lazy reverse-zone materialization, and `reverse_ptr_links` access. Depends on `ipv4.ts`, `entityStore` (createZone/createRecord/getZone/deleteRecord), and the db.
- Modify `shared/entities.ts` — add `BlockKind` and `Block`.
- Modify `backend/src/server/db.ts` — add `blocks` and `reverse_ptr_links` tables + indexes.
- Modify `backend/src/server/app.ts` — add block routes + reconcile route; invoke `reconcileReverseForRecord` in the three record routes.
- Create tests: `backend/test/ipv4.test.ts`, `backend/test/app.blocks.test.ts`, `backend/test/app.reverseSync.test.ts`.

Run all verification from `backend/`. Decisive commands: `npx vitest run`, `npm run typecheck`, `npm run build`.

---

### Task 1: IPv4 CIDR + reverse-name helper

**Files:**
- Create: `backend/src/server/ipv4.ts`
- Test: `backend/test/ipv4.test.ts`

**Interfaces:**
- Produces:
  - `parseCidr(cidr: string): { network: number; prefix: number } | null` — null on any malformed input.
  - `cidrContainsCidr(parent: string, child: string): boolean`
  - `cidrsOverlap(a: string, b: string): boolean`
  - `cidrContainsIp(cidr: string, ip: string): boolean`
  - `reversePtrName(ip: string): string` — `'192.0.2.1'` → `'1.2.0.192.in-addr.arpa'`
  - `ptrZoneName(ip: string): string` — `'192.0.2.1'` → `'2.0.192.in-addr.arpa'`
  - `isValidIpv4(ip: string): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
// backend/test/ipv4.test.ts
import { describe, it, expect } from 'vitest';
import {
  parseCidr, cidrContainsCidr, cidrsOverlap, cidrContainsIp,
  reversePtrName, ptrZoneName, isValidIpv4,
} from '../src/server/ipv4';

describe('ipv4', () => {
  it('parses a valid CIDR and rejects malformed input', () => {
    expect(parseCidr('10.20.1.0/24')).toEqual({ network: 169083136, prefix: 24 });
    // must-fail control: a broken parser that returned an object here would fail these.
    expect(parseCidr('10.20.1.0/33')).toBeNull();
    expect(parseCidr('256.0.0.0/8')).toBeNull();
    expect(parseCidr('10.0.0.0')).toBeNull();
    expect(parseCidr('garbage')).toBeNull();
    expect(parseCidr('10.0.0.0/-1')).toBeNull();
  });

  it('normalizes the network address to the prefix', () => {
    // host bits are masked off: 10.20.1.55/24 -> network of 10.20.1.0/24
    expect(parseCidr('10.20.1.55/24')).toEqual(parseCidr('10.20.1.0/24'));
  });

  it('decides containment (parent contains child, not vice versa)', () => {
    expect(cidrContainsCidr('10.0.0.0/8', '10.20.1.0/24')).toBe(true);
    expect(cidrContainsCidr('10.0.0.0/8', '10.0.0.0/8')).toBe(true); // equal contains equal
    // must-fail control: child does NOT contain parent
    expect(cidrContainsCidr('10.20.1.0/24', '10.0.0.0/8')).toBe(false);
    expect(cidrContainsCidr('10.0.0.0/8', '192.168.0.0/16')).toBe(false);
  });

  it('detects overlap symmetrically and non-overlap', () => {
    expect(cidrsOverlap('10.0.0.0/8', '10.20.0.0/16')).toBe(true);
    expect(cidrsOverlap('10.20.0.0/16', '10.0.0.0/8')).toBe(true);
    // must-fail control: disjoint ranges do not overlap
    expect(cidrsOverlap('10.0.0.0/8', '11.0.0.0/8')).toBe(false);
  });

  it('tests ip membership', () => {
    expect(cidrContainsIp('192.0.2.0/24', '192.0.2.1')).toBe(true);
    expect(cidrContainsIp('192.0.2.0/24', '192.0.3.1')).toBe(false);
  });

  it('builds reverse PTR names and /24 zone names', () => {
    expect(reversePtrName('192.0.2.1')).toBe('1.2.0.192.in-addr.arpa');
    expect(ptrZoneName('192.0.2.1')).toBe('2.0.192.in-addr.arpa');
  });

  it('validates IPv4 literals', () => {
    expect(isValidIpv4('192.0.2.1')).toBe(true);
    expect(isValidIpv4('192.0.2.256')).toBe(false);
    expect(isValidIpv4('2001:db8::1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run ipv4`
Expected: FAIL — cannot resolve `../src/server/ipv4`.

- [ ] **Step 3: Implement `ipv4.ts`**

```ts
// backend/src/server/ipv4.ts
// IPv4-only CIDR math on unsigned 32-bit integers. No dependencies.

function ipToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

export function isValidIpv4(ip: string): boolean {
  return ipToInt(ip) !== null;
}

function maskFor(prefix: number): number {
  if (prefix === 0) return 0;
  // prefix in 1..32; keep the top `prefix` bits.
  return (0xffffffff << (32 - prefix)) >>> 0;
}

export function parseCidr(cidr: string): { network: number; prefix: number } | null {
  const slash = cidr.indexOf('/');
  if (slash < 0) return null;
  const ip = cidr.slice(0, slash);
  const prefixStr = cidr.slice(slash + 1);
  if (!/^\d{1,2}$/.test(prefixStr)) return null;
  const prefix = Number(prefixStr);
  if (prefix < 0 || prefix > 32) return null;
  const ipInt = ipToInt(ip);
  if (ipInt === null) return null;
  const network = (ipInt & maskFor(prefix)) >>> 0;
  return { network, prefix };
}

export function cidrContainsCidr(parent: string, child: string): boolean {
  const p = parseCidr(parent);
  const c = parseCidr(child);
  if (!p || !c) return false;
  if (p.prefix > c.prefix) return false;
  return ((c.network & maskFor(p.prefix)) >>> 0) === p.network;
}

export function cidrContainsIp(cidr: string, ip: string): boolean {
  const c = parseCidr(cidr);
  const ipInt = ipToInt(ip);
  if (!c || ipInt === null) return false;
  return ((ipInt & maskFor(c.prefix)) >>> 0) === c.network;
}

export function cidrsOverlap(a: string, b: string): boolean {
  const pa = parseCidr(a);
  const pb = parseCidr(b);
  if (!pa || !pb) return false;
  // The block with the shorter prefix (larger range) contains the other's network
  // address iff the ranges overlap.
  const wider = pa.prefix <= pb.prefix ? pa : pb;
  const narrower = pa.prefix <= pb.prefix ? pb : pa;
  return ((narrower.network & maskFor(wider.prefix)) >>> 0) === wider.network;
}

function octets(ip: string): string[] {
  return ip.split('.');
}

export function reversePtrName(ip: string): string {
  const o = octets(ip);
  return `${o[3]}.${o[2]}.${o[1]}.${o[0]}.in-addr.arpa`;
}

export function ptrZoneName(ip: string): string {
  const o = octets(ip);
  return `${o[2]}.${o[1]}.${o[0]}.in-addr.arpa`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run ipv4`
Expected: PASS (all cases, including the must-fail controls).

- [ ] **Step 5: Commit**

```bash
git add backend/src/server/ipv4.ts backend/test/ipv4.test.ts
git commit -m "feat(ipam): IPv4 CIDR + reverse-name helper (#57)"
```

---

### Task 2: Block entity, table, CRUD store, hierarchy validation, and API routes

**Files:**
- Modify: `shared/entities.ts` (add `BlockKind`, `Block` after the `ServerGroup` interface)
- Modify: `backend/src/server/db.ts` (add `blocks` table + index alongside `server_groups`)
- Create: `backend/src/server/blockStore.ts`
- Modify: `backend/src/server/app.ts` (block routes; import block store fns)
- Test: `backend/test/app.blocks.test.ts`

**Interfaces:**
- Consumes: `parseCidr`, `cidrContainsCidr`, `cidrsOverlap` from `ipv4.ts`; `getConfiguration`, `getView` from `entityStore`.
- Produces (from `blockStore.ts`):
  - `listBlocks(db, configId: string): Block[]`
  - `getBlock(db, id: string): Block | null`
  - `createBlock(db, configId, input: { name: string; cidr: string; kind: BlockKind; parentBlockId?: string | null; viewId?: string }): Block`
  - `updateBlock(db, id, patch: { name?: string; cidr?: string; parentBlockId?: string | null; viewId?: string }): Block`
  - `deleteBlock(db, id): { deleted: true }`
  - `validateBlockHierarchy(db, configId, candidate: { id?: string; cidr: string; kind: BlockKind; parentBlockId: string | null }): { ok: true } | { ok: false; code: 'INVALID_HIERARCHY' }`

- [ ] **Step 1: Add the shared types**

In `shared/entities.ts`, after the `ServerGroup` interface:

```ts
export type BlockKind = 'BLOCK' | 'NETWORK';
export interface Block {
  id: string;
  configurationId: string;
  name: string;
  cidr: string;               // IPv4 CIDR, e.g. '10.20.1.0/24'
  parentBlockId: string | null;
  kind: BlockKind;
  viewId?: string;            // NETWORK only: view its reverse zones live in
}
```

- [ ] **Step 2: Add the table**

In `backend/src/server/db.ts`, add alongside the `server_groups` CREATE TABLE:

```sql
CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  configurationId TEXT NOT NULL,
  data TEXT NOT NULL,
  FOREIGN KEY (configurationId) REFERENCES configurations(id) ON DELETE CASCADE
);
```

and with the other indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_blocks_configId ON blocks(configurationId);
```

- [ ] **Step 3: Write the failing CRUD + hierarchy tests**

```ts
// backend/test/app.blocks.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import { createView } from '../src/server/entityStore';

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
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd backend && npx vitest run app.blocks`
Expected: FAIL — routes/store not implemented.

- [ ] **Step 5: Implement `blockStore.ts`**

```ts
// backend/src/server/blockStore.ts
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
  return { ok: true };
}
```

- [ ] **Step 6: Implement the API routes**

In `backend/src/server/app.ts`, import the block store fns (with the other entity imports) and `parseCidr` from `./ipv4`, and add these routes (place them near the record-templates routes). Mirror the existing `edit`-gate + 404-scope pattern:

```ts
// --- NETWORK BLOCKS ROUTES (IPAM #57) ---

app.get('/api/v1/configurations/:configId/blocks', async (req, reply) => {
  const { configId } = req.params as { configId: string };
  if (!authorize(req.actor, 'view', configId)) {
    return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
  }
  if (!getConfiguration(db, configId)) {
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Configuration not found' } });
  }
  return reply.status(200).send(listBlocks(db, configId));
});

app.get('/api/v1/configurations/:configId/blocks/:blockId', async (req, reply) => {
  const { configId, blockId } = req.params as { configId: string; blockId: string };
  if (!authorize(req.actor, 'view', configId)) {
    return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
  }
  const block = getBlock(db, blockId);
  if (!block || block.configurationId !== configId) {
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Block not found' } });
  }
  return reply.status(200).send(block);
});

app.post('/api/v1/configurations/:configId/blocks', async (req, reply) => {
  const { configId } = req.params as { configId: string };
  if (!authorize(req.actor, 'edit', configId)) {
    return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
  }
  if (!getConfiguration(db, configId)) {
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Configuration not found' } });
  }
  const body = (req.body ?? {}) as any;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 128) {
    return reply.status(422).send({ error: { code: 'INVALID_NAME', message: 'name must be 1-128 chars' } });
  }
  if (typeof body.cidr !== 'string' || !parseCidr(body.cidr)) {
    return reply.status(422).send({ error: { code: 'INVALID_CIDR', message: 'cidr must be a valid IPv4 CIDR' } });
  }
  if (body.kind !== 'BLOCK' && body.kind !== 'NETWORK') {
    return reply.status(422).send({ error: { code: 'INVALID_KIND', message: "kind must be 'BLOCK' or 'NETWORK'" } });
  }
  const parentBlockId = typeof body.parentBlockId === 'string' ? body.parentBlockId : null;
  if (body.kind === 'NETWORK') {
    if (typeof body.viewId !== 'string' || !getView(db, body.viewId) || getView(db, body.viewId)!.configurationId !== configId) {
      return reply.status(422).send({ error: { code: 'INVALID_VIEW', message: 'NETWORK requires a viewId in this configuration' } });
    }
  }
  const hierarchy = validateBlockHierarchy(db, configId, { cidr: body.cidr, kind: body.kind, parentBlockId });
  if (!hierarchy.ok) {
    return reply.status(422).send({ error: { code: hierarchy.code, message: 'Block violates the hierarchy rules' } });
  }
  const block = createBlock(db, configId, { name, cidr: body.cidr, kind: body.kind, parentBlockId, viewId: body.kind === 'NETWORK' ? body.viewId : undefined });
  return reply.status(201).send(block);
});

app.patch('/api/v1/configurations/:configId/blocks/:blockId', async (req, reply) => {
  const { configId, blockId } = req.params as { configId: string; blockId: string };
  if (!authorize(req.actor, 'edit', configId)) {
    return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
  }
  const existing = getBlock(db, blockId);
  if (!existing || existing.configurationId !== configId) {
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Block not found' } });
  }
  const body = (req.body ?? {}) as any;
  const patch: { name?: string; cidr?: string; parentBlockId?: string | null; viewId?: string } = {};
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 128) return reply.status(422).send({ error: { code: 'INVALID_NAME', message: 'name must be 1-128 chars' } });
    patch.name = name;
  }
  if (body.cidr !== undefined) {
    if (typeof body.cidr !== 'string' || !parseCidr(body.cidr)) return reply.status(422).send({ error: { code: 'INVALID_CIDR', message: 'cidr must be a valid IPv4 CIDR' } });
    patch.cidr = body.cidr;
  }
  if (body.parentBlockId !== undefined) patch.parentBlockId = typeof body.parentBlockId === 'string' ? body.parentBlockId : null;
  if (body.viewId !== undefined) patch.viewId = body.viewId;
  const next = { id: existing.id, cidr: patch.cidr ?? existing.cidr, kind: existing.kind, parentBlockId: patch.parentBlockId !== undefined ? patch.parentBlockId : existing.parentBlockId };
  const hierarchy = validateBlockHierarchy(db, configId, next);
  if (!hierarchy.ok) return reply.status(422).send({ error: { code: hierarchy.code, message: 'Block violates the hierarchy rules' } });
  const updated = updateBlock(db, blockId, patch);
  return reply.status(200).send(updated);
});

app.delete('/api/v1/configurations/:configId/blocks/:blockId', async (req, reply) => {
  const { configId, blockId } = req.params as { configId: string; blockId: string };
  if (!authorize(req.actor, 'edit', configId)) {
    return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
  }
  const existing = getBlock(db, blockId);
  if (!existing || existing.configurationId !== configId) {
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Block not found' } });
  }
  const hasChildren = listBlocks(db, configId).some((b) => b.parentBlockId === blockId);
  if (hasChildren) {
    return reply.status(422).send({ error: { code: 'HAS_CHILDREN', message: 'Delete or reparent child blocks first' } });
  }
  return reply.status(200).send(deleteBlock(db, blockId));
});
```

Confirm `getView` is exported from `entityStore` and imported in `app.ts`; if not, add it to the import block. (`getView(db, viewId)` returns `View | null` with a `configurationId` field.)

- [ ] **Step 7: Run to verify it passes**

Run: `cd backend && npx vitest run app.blocks`
Expected: PASS (all cases, including the hierarchy must-fail controls).

- [ ] **Step 8: Full verify + commit**

Run: `cd backend && npx vitest run && npm run typecheck && npm run build`
Expected: all pass, typecheck + build clean.

```bash
git add shared/entities.ts backend/src/server/db.ts backend/src/server/blockStore.ts backend/src/server/app.ts backend/test/app.blocks.test.ts
git commit -m "feat(ipam): network blocks CRUD + hierarchy validation (#57)"
```

---

### Task 3: reverse_ptr_links table + reverseSync service + auto-sync on A-record writes

**Files:**
- Modify: `backend/src/server/db.ts` (add `reverse_ptr_links` table)
- Create: `backend/src/server/reverseSync.ts`
- Modify: `backend/src/server/app.ts` (call `reconcileReverseForRecord` in the three record routes)
- Test: `backend/test/app.reverseSync.test.ts`

**Interfaces:**
- Consumes: `cidrContainsIp`, `reversePtrName`, `ptrZoneName`, `isValidIpv4` from `ipv4.ts`; `listBlocks` from `blockStore`; `getZone`, `createZone`, `createRecord`, `deleteRecord` from `entityStore`.
- Produces (from `reverseSync.ts`):
  - `reconcileReverseForRecord(db, record: ResourceRecord, action: 'CREATE' | 'UPDATE' | 'DELETE'): void`
  - `reconcileBlock(db, blockId: string): { created: number }` (used by Task 4)

- [ ] **Step 1: Add the link table**

In `backend/src/server/db.ts`, alongside the other tables:

```sql
CREATE TABLE IF NOT EXISTS reverse_ptr_links (
  configurationId TEXT NOT NULL,
  forwardRecordId TEXT PRIMARY KEY,
  ptrRecordId     TEXT NOT NULL,
  ptrZoneId       TEXT NOT NULL,
  FOREIGN KEY (configurationId) REFERENCES configurations(id) ON DELETE CASCADE
);
```

- [ ] **Step 2: Write the failing auto-sync tests**

```ts
// backend/test/app.reverseSync.test.ts
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
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd backend && npx vitest run app.reverseSync`
Expected: FAIL — `reverseSync` not implemented and routes don't call it.

- [ ] **Step 4: Implement `reverseSync.ts`**

```ts
// backend/src/server/reverseSync.ts
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
```

- [ ] **Step 5: Wire the sync into the three record routes**

In `backend/src/server/app.ts`, import `reconcileReverseForRecord` from `./reverseSync`, then:

- POST `/api/v1/zones/:zoneId/records` — after `const record = createRecord(db, zoneId, body);` add `reconcileReverseForRecord(db, record, 'CREATE');`
- PATCH `/api/v1/records/:id` — after `const updated = updateRecord(db, id, body);` add `reconcileReverseForRecord(db, updated, 'UPDATE');`
- DELETE `/api/v1/records/:id` — the route already fetched `const record = getRecord(db, id);` before deleting. After `const result = deleteRecord(db, id);` add `reconcileReverseForRecord(db, record, 'DELETE');` (uses the pre-delete `record`, which carries the id the link is keyed on).

- [ ] **Step 6: Run to verify it passes**

Run: `cd backend && npx vitest run app.reverseSync`
Expected: PASS, including the out-of-range must-fail control.

- [ ] **Step 7: Full verify + commit**

Run: `cd backend && npx vitest run && npm run typecheck && npm run build`
Expected: all pass, clean.

```bash
git add backend/src/server/db.ts backend/src/server/reverseSync.ts backend/src/server/app.ts backend/test/app.reverseSync.test.ts
git commit -m "feat(ipam): auto-sync reverse PTRs on A-record writes (#57)"
```

---

### Task 4: Reconcile endpoint (backfill PTRs for existing records)

**Files:**
- Modify: `backend/src/server/app.ts` (add the reconcile route; import `reconcileBlock`)
- Test: extend `backend/test/app.blocks.test.ts` (or a new `app.reconcile.test.ts`)

**Interfaces:**
- Consumes: `reconcileBlock(db, blockId): { created: number }` from `reverseSync`; `getBlock` from `blockStore`.

- [ ] **Step 1: Write the failing backfill test**

```ts
// append to backend/test/app.reverseSync.test.ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run app.reverseSync`
Expected: FAIL — reconcile route returns 404.

- [ ] **Step 3: Implement the reconcile route**

In `backend/src/server/app.ts`, import `reconcileBlock` from `./reverseSync` and add near the block routes:

```ts
app.post('/api/v1/configurations/:configId/blocks/:blockId/reconcile', async (req, reply) => {
  const { configId, blockId } = req.params as { configId: string; blockId: string };
  if (!authorize(req.actor, 'edit', configId)) {
    return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
  }
  const block = getBlock(db, blockId);
  if (!block || block.configurationId !== configId) {
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Block not found' } });
  }
  if (block.kind !== 'NETWORK') {
    return reply.status(422).send({ error: { code: 'NOT_A_NETWORK', message: 'Only a NETWORK can be reconciled' } });
  }
  return reply.status(200).send(reconcileBlock(db, blockId));
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run app.reverseSync`
Expected: PASS (backfill + idempotent).

- [ ] **Step 5: Full verify + commit**

Run: `cd backend && npx vitest run && npm run typecheck && npm run build`
Expected: all pass, clean.

```bash
git add backend/src/server/app.ts backend/test/app.reverseSync.test.ts
git commit -m "feat(ipam): reconcile endpoint backfills reverse PTRs (#57)"
```

---

## Self-Review notes (author)

- **Spec coverage:** data model (Task 2) · ipv4 helper (Task 1) · lazy /24 reverse zones + auto-sync CREATE/UPDATE/DELETE + link table (Task 3) · API incl. reconcile (Tasks 2 & 4) · security (edit-gate + CIDR validation + integer-derived names across Tasks 2-3) · testing incl. must-fail controls (every task). Out-of-scope items (IPv6, inventory, RFC 2317, empty-zone cleanup, hand-edit overwrite) require no task by design.
- **Type consistency:** `Block`/`BlockKind` defined in Task 2 and consumed unchanged in Task 3; `reconcileReverseForRecord`/`reconcileBlock` signatures fixed in Task 3 and consumed verbatim in Task 4; `parseCidr` return shape fixed in Task 1 and used in Tasks 2-3.
- **Known integration assumption to verify during Task 2:** `getView(db, id)` and `getZone(db, id)` are exported from `entityStore` and return objects carrying `configurationId`; `listRecords(db, zoneId)` returns `{ data: ResourceRecord[] }`. If any differs, adjust the import or call at that step — do not invent a new helper.
