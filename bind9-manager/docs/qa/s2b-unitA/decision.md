# Slice 2b Unit A — decision

**Verdict: DEFECT (MED) → fix round 1 → accept.** Lighter loop (data plumbing) — deepseek-pro test only.

- Tester (deepseek-v4-pro, $1.96): 275 pass / 1 fail. All correct except `listRecords` `q`.
- **Defect (MED):** `q` free-text search covers only name/id/rdata.target/address/text; misses CAA
  `value`/`tag`, SRV `port`, MX `priority`. api-contract says `q` is free-text over identifying fields.
- Fix: extend `q` to match a stringification of ALL rdata values. The tester's failing test then passes.
- Everything else verified: envelope+pagination, filter AND, sort (numeric-aware, bad-field safe),
  CRUD round-trips, referential integrity (dependents exact, no orphans), seed idempotency, JSON
  quote/unicode round-trip.

**Committed:** 29b5f84
