# Security Code Review: Slice 2a Auth + Persistence

**Files reviewed:**
- bind9-manager/backend/src/server/crypto.ts
- bind9-manager/backend/src/server/db.ts
- bind9-manager/backend/src/server/authStore.ts

**Spec:** 2026-08-15-backend-slice2a-auth-persistence.md

---

## Findings

### 1. crypto.ts:18 — HIGH: Salt not decoded from hex before scryptSync

**Problem:** Salt is stored as hex string (`randomBytes(16).toString('hex')`) but passed directly to `scryptSync(pw, salt, 64)`. Node.js crypto documentation specifies that string salts are UTF-8 encoded; the hex string's ASCII character bytes are used, not the bytes they represent.

**Impact:** Salt strength degraded. While password verification still works (both hash and verify use the same incorrect salt), the effective salt is 32 ASCII bytes (values 0x30-0x39, 0x61-0x66) instead of 16 random bytes. This violates proper cryptographic API usage.

**Fix:** Decode hex to buffer before scryptSync:
```typescript
const computed = scryptSync(pw, Buffer.from(salt, 'hex'), 64);
```

---

### 2. authStore.ts — MED: JSON.parse without try-catch (6 locations)

**Problem:** User roles and API key scopes are parsed from DB without error handling:
- Line 93 (resolveSession)
- Line 181 (resolveApiKey, scopes)
- Line 193 (resolveApiKey, roles)
- Line 217 (getUserById)
- Line 239 (getUserByUsername)
- Line 268 (listApiKeys)

**Impact:** If a DB row becomes corrupted (malformed JSON in roles/scopes column), parsing crashes the process (unhandled exception).

**Fix:** Wrap each `JSON.parse()` in try-catch or validate before parsing:
```typescript
roles: (() => { try { return JSON.parse(row.roles); } catch { return []; } })() as RoleAssignment[]
```

---

## Passing Checks

- ✓ Timing-safe comparison (`timingSafeEqual`) used correctly with length guard
- ✓ Passwords stored only as scrypt salt+hash, never plaintext
- ✓ Tokens stored only as sha256 hash, never plaintext
- ✓ Token returned once (login, createApiKey) then never exposed again
- ✓ All SQL queries parameterized; no string interpolation
- ✓ Session expiry: `expiresAt <= now` (correct boundary, not `<`)
- ✓ API-key expiry: `expiresAt <= now` (correct boundary)
- ✓ Token entropy: 32 bytes (256 bits) from `crypto.randomBytes`
- ✓ Scrypt parameters: 64-byte output, 16-byte salt, memory-hard
- ✓ No secrets logged
- ✓ Admin seed uses env var `BIND9_ADMIN_PW` with safe fallback for dev
- ✓ Foreign keys enabled; indexes on join columns

---

## Summary

1 HIGH severity bug (salt hex-to-bytes conversion), 6 MED risks (JSON parse error handling). Core secret storage and session lifecycle are implemented correctly.

