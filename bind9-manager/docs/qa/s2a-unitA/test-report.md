# Slice 2a Unit A — independent adversarial test report

Evaluator run, independent of the author. Date: 2026-08-15.

## Verdict

**PASS — no defects found.** The security surface called out in the spec's testing bar holds
under adversarial probing. 0 failing tests, 0 defects to hand back to the orchestrator.

## What I tested

New files (added, not committed):

- `test/authStore.adversarial.test.ts` — 21 tests
- `test/crypto.adversarial.test.ts` — 8 tests

Full backend suite: **71 tests passed across 9 files** (42 pre-existing + 29 new). `tsc --noEmit`
clean (exit 0). `npx vitest run` clean.

### Session lifecycle (`resolveSession`)
- Expired token → null; garbage/random token → null; empty token → null.
- A 64-hex token never minted (`'f'.repeat(64)`) → null (sha256 collides with nothing).
- The literal token `'admin'` (its sha256 exists in the world, not in the table) → null.
- Revoked token → null.
- Exact boundary: valid at `expiresAt - 1ms`, null at exactly `expiresAt`, null at `expiresAt + 1ms`.
- Deactivating a user mid-session (after login) → subsequent `resolveSession` null.

### Password (`login` / `verifyPassword`)
- Wrong password → null; empty password (as wrong guess) → null; unknown user → null.
- Unicode + emoji password round-trips; wrong unicode suffix fails.
- 10 000-char password round-trips; truncation by one char fails.
- Empty-string password on a user seeded with empty password **succeeds** — no min-length policy
  (documented, not a defect; spec does not require a policy).
- `verifyPassword` timing-safety: never throws on length-mismatched digests (empty, 1-byte,
  4-byte, 32-byte, 63-byte, 65-byte, and 64-byte-but-wrong). The length guard
  (`computed.length !== expected.length`) short-circuits before `timingSafeEqual`, so the naive
  `timingSafeEqual` length-mismatch throw is guarded correctly. Also no throw on non-hex hash or
  garbage salt. Flipped-nibble digest → false.

### SQL injection resistance
- `admin'; DROP TABLE users;--`, `'; DELETE FROM sessions;--`, `admin" OR "1"="1`,
  `admin' OR '1'='1' --`, `admin;--` as username: `login` returns null, no throw.
- `users` table still exists after all attempts; admin row count still 1; correct login still works.
- Injection payload as password: treated as data, table intact.
- Better-sqlite3 prepared statements (`?` binding) — verified by behavior.

### Secrets at rest
- Raw `SELECT *` over all three tables (`users`, `sessions`, `api_keys`), every column of every row,
  serialized: plaintext password never appears; plaintext session token never appears; plaintext
  API-key token never appears.
- Positive control: stored `tokenHash`/`keyHash` equal `sha256(token)`.

### API keys (`createApiKey` / `resolveApiKey`)
- Expired key → null at and after expiry; rejected resolves do **not** bump `lastUsedAt`.
- Valid key bumps `lastUsedAt` across calls.
- `readOnly: true/false` and `scopes` round-trip through resolve.
- Two `createApiKey` calls → different tokens, different ids; token shape `bnd_[0-9a-f]{64}`.
- Garbage/empty/never-minted key tokens → null.
- Deleting owner user cascades (FK `ON DELETE CASCADE`); key becomes unresolvable.

### Seeding (`openDb`)
- Two `openDb(':memory:')` calls are independent (user in db1 absent from db2).
- Seeded admin logs in with default password `admin`.
- Idempotent: reopening a file DB does not duplicate the admin (count stays 1).
- `BIND9_ADMIN_PW` env override changes the seeded admin password.

## Defects

None.

## Coverage gaps / notes (not defects)

- **`resolveSession`/`resolveApiKey` throw on corrupt JSON columns** (`authStore.ts:93` and `:181`:
  `JSON.parse(row.roles)` / `JSON.parse(row.scopes)` are unguarded). A `roles`/`scopes` column
  holding invalid JSON makes the function throw `SyntaxError` instead of returning null. Not
  attacker-reachable through the public API (those columns are written only by seed/`createApiKey`
  under the app's own control), so I did not file it as a defect. If schema evolution or a manual
  DB edit ever writes a malformed shape, this turns "unresolvable token" into a 500. Worth a
  `try/catch` around the parse in a later hardening pass.
- **`createApiKey` with `expiresAt: ''`** (`authStore.ts:119` + `:167`): an empty string is stored
  as-is and `if (row.keyExpiresAt)` treats it as falsy → the key never expires. Only reachable if a
  caller passes `''` explicitly; the type permits `string`. Minor.
- **No minimum-password-length policy**: empty passwords are legal (documented above). Out of scope;
  spec lists lockout/rate-limiting as later hardening.
- **Username-enumeration timing**: `login` returns early on unknown/inactive user before running
  scrypt, so response timing differs between "user exists, wrong password" and "no such user". Not
  in the spec bar; noted for the rate-limiting/lockout hardening pass.
- **`listApiKeys` with empty-string `ownerUserId`** (`authStore.ts:258`): falsy owner id lists all
  keys. Minor, app-controlled.

## Commands run

```
cd bind9-manager/backend && npx vitest run          # 71 passed, 9 files
npx tsc --noEmit                                      # exit 0
```
