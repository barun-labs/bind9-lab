# Security Review: Deploy Endpoint (POST /labs/:id/deploy, GET /deploy-jobs/:id)

## Findings

### 1. CRITICAL: Arbitrary Directory Write via User-Provided labDir
**File**: bind9-manager/backend/src/server/app.ts:937  
**Severity**: CRITICAL

The POST endpoint accepts a user-provided `labDir` parameter in the request body without any validation:
```typescript
const labDir = body.labDir || opts.labDir || `/home/lun/${lab.topology.name}`;
```

A user with `deploy` permission can specify any filesystem path (e.g., `/etc`, `/root`, etc.) to cause the deploy process to write files to arbitrary system directories. This depends only on the process's file permissions.

**Fix**: Remove user control over labDir or implement strict path validation (e.g., must be within `/home/lun/labs/` or a configured safe directory).

---

### 2. HIGH: Path Traversal in Default labDir Construction
**File**: bind9-manager/backend/src/server/app.ts:937  
**Severity**: HIGH

When `opts.labDir` is not provided and the user has not specified one, the default path is `/home/lun/${lab.topology.name}`. The `topology.name` is user-controlled but not validated against path traversal sequences.

A user could set `topology.name="../../../etc"` which evaluates to `/home/lun/../../../etc` → `/etc` after path normalization by shell tools and mkdir.

**Fix**: Validate `topology.name` against a strict pattern like `/^[a-zA-Z0-9._-]+$/` to prevent `../`, `./`, and other traversal attempts. (See also reserved-name check gap below.)

---

### 3. HIGH: Incomplete Reserved-Name Guard
**File**: bind9-manager/backend/src/server/deployEngine.ts:261  
**Severity**: HIGH

The reserved-name validation only blocks exact match `dns` and prefix `clab-`:
```typescript
if (/^dns$/.test(topology.name) || topology.name.startsWith('clab-')) {
```

This does not prevent `../` or `./` sequences that could be used to escape the deployment directory. Combined with Finding 2, this allows directory traversal even when the pre-flight guard was intended to restrict deployment scope.

**Fix**: Expand the pattern to reject any topology name containing path separators or traversal sequences: `/^[a-zA-Z0-9._-]+$/ OR reject early if path.resolve(topology.name) !== path.resolve('./' + topology.name)`.

---

## Security Controls: Present and Correct

### Authorization Checks
- **Finding**: Both POST and GET endpoints perform authorization checks *before* creating or returning job data.
- **POST** (L930): `authorize(req.actor, 'deploy', lab.configurationId)` checked before `startDeployJob()`.
- **GET** (L960): `authorize(req.actor, 'view', lab.configurationId)` checked after retrieving the job.
- **No IDOR in GET**: Job is fetched by ID, but authorization is on the *lab's* configuration, preventing cross-configuration access.

### Error Handling
- **404 Responses**: Nonexistent lab (L924–926) and nonexistent job (L947–950) return 404, not 500.
- **Async Deployment**: Errors during background deployment are caught (L64) and stored in `job.error` (visible only to authorized users). No unhandled exceptions escape to the client.

### Shell Injection Prevention
- **Properly Escaped**: All user-controlled input passed to bash (`labDir`, `topology.name`, `serverId`, `filePath`) is escaped via `shellQuote()` before insertion into bash commands (L90, L167, L172, L180, L189, etc. in deployEngine.ts).
- **Base64 Encoding**: File contents are base64-encoded before embedding in shell scripts (L171, L179), eliminating shell metacharacter injection.

### Data Leakage
- **POST Response** (L940): Only `{ jobId: job.id }` is returned, not the full job object. Prevents leaking deployment details in the immediate response.
- **GET Response** (L966): Full job object (including result/error) is returned. Error messages may reveal implementation details, but only to authorized users. Acceptable risk.

---

## Summary

**Critical Risk**: Remove or validate the user-supplied `labDir` parameter.  
**High Risk**: Implement strict topology name validation to prevent path traversal.  
**Status**: All authorization, error handling, and shell-injection defenses are correctly implemented.
