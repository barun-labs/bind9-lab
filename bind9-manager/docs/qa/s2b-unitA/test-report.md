# Slice 2b Unit A — Independent Test Pass

Evaluator: independent adversarial pass over `src/server/entityStore.ts` + seeding in `src/server/db.ts`.
No production code modified; only `test/entityStore.adversarial.test.ts` added.

## Verdict

**DEFECTS FOUND: 1**

Suite: `npx vitest run` — `276` tests, `275` passed, `1` failed. The failure is a real defect,
left unfixed per instructions.

## Defect

### D1 — `listRecords` `q` filter ignores CAA/SRV/MX rdata fields

`src/server/entityStore.ts:232-245` — the `q` free-text filter checks only `name`, `id`, and three
rdata string fields (`target`, `address`, `text`). It does not search `rdata.value` / `rdata.tag`
(CAA), `rdata.port` / `priority` / `weight` (SRV/MX), or any numeric rdata field.

Repro (record `rec-18`, CAA, `rdata.value: "letsencrypt.org"`):

```ts
listRecords(db, 'zone-lab', { q: 'letsencrypt' }).total  // -> 0 (expected 1)
listRecords(db, 'zone-lab', { q: '5060' }).total         // -> 0 (rec-13 SRV, port 5060)
```

Severity: medium. Search is incomplete — a term present in a record's rdata returns no match,
so "search by content" silently misses CAA/SRV/MX values. Fix: search over the serialized
record (or a known set of string-typed rdata fields) rather than the three hardcoded keys.

## Probes that PASSED

- **Envelope** — every list returns `{data,page,size,total}`; `data.length <= size`; `total` counts
  the full match set (not the page); page walk has no overlap/gap vs the full set; `page:0` clamps to
  `1`, `size:0` falls back to default `50`, negative page/size clamp to `1`.
- **Filters** — `type` and `status` each narrow to exactly the matching set (oracle-checked),
  case-insensitive, and combine with AND; unknown filter values return empty `data` + `total 0` (no throw).
- **Sort** — `name:asc`/`name:desc` order correctly (concrete zone-name order asserted);
  record-name sort is numeric-aware (`host2` before `host10`); a bad sort field does not throw.
- **CRUD** — create appears + `total+1` and round-trips via `getRecord`; update persists one field
  and leaves the rest intact; delete removes + `total-1`; update/delete of a missing id throw
  `...not found` (documented); duplicate explicit create id throws rather than silently overwriting.
- **Referential integrity** — `deleteZone` `dependents` equals the live record count (after a create:
  41; after a move-out: 39); after delete, records are fully removed (direct SQL shows no orphans)
  and other zones are untouched.
- **Seed idempotency** — two `:memory:` dbs are independent; reopening the same file db twice yields
  identical counts (3 configs / 8 zones / 40 records), no duplication.
- **JSON columns** — record name and rdata with quotes, unicode, newline, and emoji round-trip intact.

## Notes (non-defects)

- `size: 0` resolves to the default `50` via `Number(...) || 50`, not clamped to `1`. Same observable
  behavior as omitting `size`; `data.length <= size` still holds. Sane.
- `deleteZone` cascades records via an explicit `DELETE ... WHERE zoneId` plus the `ON DELETE CASCADE`
  FK; no orphaned rows remain.
