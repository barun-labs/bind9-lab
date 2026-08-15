# Unit A — orchestrator decision

**Verdict: ACCEPT after one hardening round.**

## Inputs
- **Tester (deepseek-v4-pro):** PASS, no defects. 71 tests / 9 files green, `tsc` clean. Added 29
  adversarial tests (expiry boundary, garbage/revoked tokens, SQL-injection username, secret-at-rest,
  api-key expiry + lastUsedAt, seed idempotency). Cost $1.38, deepseek-only.
- **Reviewer (cavecrew / Claude):** 1 HIGH + 6 MED. No auth-bypass, no secret leak.

## Synthesis
The security core is sound — both models agree: no bypass, no plaintext at rest, prepared statements,
expiry enforced. Cross-model agreement on the one substantive nit (unguarded `JSON.parse` on the JSON
columns). The reviewer's "HIGH" (salt passed as hex string, not decoded bytes) is **not** a functional
bug — hash/verify use the same salt string, so it is self-consistent and keeps 16 bytes of entropy;
the tester's password tests pass. Downgraded to a best-practice fix.

## Fixes applied this round (real, cross-model-agreed, cheap)
1. `crypto.ts` — pass `Buffer.from(salt,'hex')` to scrypt (use the raw 16 bytes). Best practice.
2. `authStore.ts` — a `safeParseJson(text, fallback)` helper for every `roles`/`scopes` parse, so a
   corrupted row degrades instead of crashing the process (6 sites; reviewer + tester agreed).
3. `authStore.ts` — treat `expiresAt: ''` (falsy but not null) as "never expires" bug: normalize empty
   string to `null` on `createApiKey` so an empty string does not silently disable expiry.

## Deferred to a later hardening pass (logged, not blocking)
- Username-enumeration timing (login early-returns before scrypt on unknown user).
- No password-length policy (empty password legal).
Both out of this slice's testing bar; recorded for a security-hardening slice.

Commit follows after the fix re-runs green.

**Committed:** eddc2e8
