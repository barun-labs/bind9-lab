# Security Review: bind9-manager/backend/src/server/app.ts

**Date**: 2026-08-15
**Reviewer**: Security Audit
**Scope**: HTTP auth surface of Fastify DNS-manager backend (auth hook, token parsing, route protection, permission enforcement)

## Findings

### app.ts:140 - HIGH: Unhandled JSON.parse() can throw 500 on malformed scopes

In the `POST /api/v1/api-keys` handler, scopes are parsed from the database without error handling:

```typescript
scopes: JSON.parse(row.scopes),
```

If the `scopes` column is malformed JSON (data corruption, concurrent schema change, etc.), `JSON.parse()` throws an unhandled exception, resulting in a 500 error instead of graceful error handling. This violates handler robustness and may leak internal details.

**Fix**: Replace with safe parsing like GET /api/v1/api-keys uses:
```typescript
scopes: safeParseJson<('read' | 'write' | 'deploy')[]>(row.scopes, []),
```

## Verification

### Routes & Auth Hook
- All routes except `POST /api/v1/sessions` correctly protected by global onRequest hook ✓
- Hook logic correctly exempts only login endpoint ✓

### Bearer Token Parsing
- Missing Authorization header → 401 ✓
- Missing "Bearer " prefix → 401 ✓
- Empty token (whitespace-only) → 401 ✓
- Lowercase "bearer" → accepted (case-insensitive regex with `i` flag) ✓
- All cases handled; no bypass or crash ✓

### Secret Handling
- `GET /api/v1/api-keys` response: does NOT include `token` or `keyHash` ✓
- `POST /api/v1/api-keys` response: includes plaintext token once (intentional per spec) ✓
- Tokens stored as sha256 hashes in database (keyHash, tokenHash columns) ✓
- No plaintext token or password in database schema ✓

### API Key Deletion Authorization
- `DELETE /api/v1/api-keys/:id` fetches key ownership BEFORE deletion ✓
- Owner-or-admin permission check enforced BEFORE deleteApiKey() call (lines 174–183) ✓
- Read-only API key check for deletion (403 if readOnly) in place (lines 168–172) ✓

### Token Lookups
- Session resolution: token → sha256 hash → database lookup (line 50, authStore.ts:72) ✓
- API key resolution: token → sha256 hash → database lookup (line 57, authStore.ts:146) ✓
- Both use hash-based queries (not plaintext comparison) ✓
- No timing vulnerability in lookups ✓

### Password Verification
- Uses `timingSafeEqual()` for hash comparison (crypto.ts:23) ✓
- Scrypt with 16-byte salt and 64-byte output ✓

### Logging
- No explicit logging of Authorization header or plaintext tokens in code ✓
- `req.token` stored on request object for handler use (safe, not logged) ✓

## Summary

**1 HIGH severity finding** (line 140: unhandled JSON.parse).
All other security checks pass: auth hook universal (except login), Bearer parsing robust, secret separation maintained, permission enforcement before deletion, hash-based token lookups, timing-safe password verification.
