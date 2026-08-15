# Security Review: Backend Slice 2b Unit B - CRUD Routes with Permission Enforcement

**Review Date:** 2026-08-15
**Scope:** bind9-manager/backend/src/server/app.ts (uncommitted changes)
**Focus:** Authorization enforcement on mutating routes, IDOR/confused-deputy vulnerabilities, deferred fixes

## Findings Summary

No issues.

## Detailed Analysis

### 1. Authorization Checks on Mutations

All POST/PATCH/DELETE routes for records and zones verify permissions BEFORE touching the store:

- **PATCH /api/v1/zones/:zoneId** (line ~282): Calls `authorize(req.actor, 'edit', zone.configurationId)` before `updateZone()`
- **DELETE /api/v1/zones/:zoneId** (line ~312): Calls `authorize(req.actor, 'edit', zone.configurationId)` before `deleteZone()`
- **POST /api/v1/zones/:zoneId/records** (line ~357): Calls `authorize(req.actor, 'edit', zone.configurationId)` before `createRecord()`
- **PATCH /api/v1/records/:id** (line ~388): Calls `authorize(req.actor, 'edit', zone.configurationId)` before `updateRecord()`
- **DELETE /api/v1/records/:id** (line ~431): Calls `authorize(req.actor, 'edit', zone.configurationId)` before `deleteRecord()`

Cross-config mutations protected: PATCH /zones and PATCH /records check authorization against the target config if the configurationId or zoneId differs in the request body.

### 2. ConfigurationId Resolution for Nested Resources

No IDOR/confused-deputy vulnerabilities found:

- **Records:** Route receives record ID from params. `getRecord(db, id)` returns the record with its `zoneId`. `getZone(db, record.zoneId)` returns zone with `configurationId`. Authorization checked against the correct `zone.configurationId`. Attacker cannot pass a record ID from config A while authorizing against config B they have access to — the zone lookup enforces the true parent.
- **Zones:** Zone ID param is looked up to get the true `configurationId`. Cannot be spoofed.

### 3. GET Routes Gated on 'view' Permission

All read-only routes properly enforce 'view' permission:

- **GET /api/v1/configurations**: Filters results with `authorize(req.actor, 'view', c.id)`
- **GET /api/v1/configurations/:configId/zones**: Checks `authorize(req.actor, 'view', configId)` before returning zones
- **GET /api/v1/zones/:zoneId**: Checks `authorize(req.actor, 'view', zone.configurationId)` before returning zone
- **GET /api/v1/zones/:zoneId/records**: Checks `authorize(req.actor, 'view', zone.configurationId)` before returning records
- **GET /api/v1/configurations/:configId/external-hosts**: Checks `authorize(req.actor, 'view', configId)` before returning hosts

### 4. Auth Middleware Coverage

All routes except `POST /api/v1/sessions` (login) are protected by the onRequest hook requiring a valid bearer token. No routes accidentally escape authentication.

### 5. Deferred Fixes

✓ **safeParseJson for scopes** (commit): Changed from raw `JSON.parse(row.scopes)` to `safeParseJson<('read' | 'write' | 'deploy')[]>(row.scopes, [])` at line ~162 in POST /api-keys response.

✓ **DELETE /sessions/current returns 400 on api-key bearer** (commit): Lines ~106–110 now check `if (req.actor.viaApiKey)` and return 400 with code `NOT_A_SESSION` before attempting logout.

✓ **No response leaks token/keyHash/pwHash**: 
  - Login and API-key creation intentionally return token once; never leaked in list/get responses.
  - GET /me returns only non-sensitive user fields (id, username, displayName, roles, viaApiKey flag).
  - Entity responses (zones, records, configs, external hosts) never include credentials.

### 6. Error Handling and Input Validation

- **POST /api/v1/zones/:zoneId/records** validates required fields (name: string, type: string, rdata: object) and returns 400 on invalid input.
- **PATCH /zones** and **PATCH /records** check body is object and return 400 if not; partial updates are accepted as per REST convention.
- No paths that accept user input will crash with a 500 error from malformed JSON (entity store functions rely on stringified data from the app itself).

---

## Conclusion

All authorization checks are correctly placed, configurationId resolution prevents IDOR, GET routes enforce 'view', and deferred fixes are applied. The CRUD API is secure for slice 2b unit B.
