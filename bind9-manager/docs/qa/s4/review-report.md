# Security & Correctness Review: deployEngine.ts + validation chain

**Date:** 2026-08-15  
**Scope:** Un-bypassable pre-flight gate, command injection, blast radius, runner failure handling  
**File under review:** `backend/src/server/deployEngine.ts` + `backend/src/config-engine/validate.ts`

---

## Findings

### backend/src/config-engine/validate.ts:77
CRITICAL: Zone name command injection via double-quote interpolation.

```bash
docker run --rm -v "$TMPDIR":/etc/bind dnsnode:1.0 named-checkzone "${zoneName}" ...
```

A crafted zone name like `$(rm -rf /data) || true` will execute arbitrary commands inside the validation container. The double quotes `"${zoneName}"` allow shell metacharacter expansion.

**Fix:** Single-quote the zoneName: `named-checkzone '${zoneName}'`. The zone name argument does not expand variables, so quoting is safe.

---

### backend/src/config-engine/validate.ts:63
CRITICAL: File path command injection via double-quote interpolation.

```bash
echo '${b64}' | base64 -d > "$TMPDIR/${filePath}"
```

If `filePath` contains backticks or `$(...)`, the shell will execute them during redirection. Example: file key `zones/db.$(touch /tmp/pwned)` will create that file.

**Fix:** Quote the entire path: `> "${TMPDIR}/$(printf '%s\n' "$filePath")"` or use shellQuote on the path. Safer: `> "$(printf '%s' "$TMPDIR/$filePath")"` or apply `shellQuote()` to the path string.

---

### backend/src/server/deployEngine.ts:122–126
CRITICAL: Exit code capture masks reload failures. The `docker exec` command chain is:

```bash
docker exec $container rndc reload 2>&1 || docker exec $container named 2>&1
```

Followed by:

```bash
echo "${NODE_END} ${serverId} $?"
```

The `$?` captures the exit code of the **last** command in the chain: `docker exec ... named 2>&1`. This command will typically succeed (exit 0) even if `rndc reload` failed, because `named` either starts a daemon or outputs status. The reload failure is masked, and `parseDeployed()` records `ok: true` when it should be `false`.

**Fix:** Capture the rndc exit explicitly:

```bash
docker exec $container rndc reload 2>&1
RC=$?
[ $RC -ne 0 ] && docker exec $container named 2>&1
echo "${NODE_END} ${serverId} $RC"
```

Or use a subshell to ensure the reload exit is captured:

```bash
( docker exec $container rndc reload 2>&1 || ( docker exec $container named 2>&1; exit $? ) )
echo "${NODE_END} ${serverId} $?"
```

---

### backend/src/server/deployEngine.ts:177–179
PASS (Un-bypassable pre-flight gate is correctly implemented).

```typescript
if (validated.some((entry) => !entry.ok)) {
  return { validated, aborted: 'pre-flight failed' };
}
```

The gate aborts **before** calling `buildDeployScript()` if any server config fails validation. There is no code path to `opts.run(script)` when validation fails. ✓

---

### backend/src/server/deployEngine.ts:115
PASS (labDir and paths correctly quoted).

Both `topo.clab.yml` and config file paths are passed through `shellQuote()` before shell interpolation. ✓

---

### backend/src/server/deployEngine.ts:119–120
MEDIUM: No validation that `topology.name` does not match production lab patterns.

```typescript
const container = `${topology.name}-${serverId}`;
```

If `topology.name` is accidentally set to `dns` (matching the production lab name from the plan), the deploy will target `dns-<node>` containers, potentially corrupting production. The plan states the lab should use a "throwaway lab name" distinct from `dns`.

**Recommendation:** Add a validation check in `deploy()` to reject `topology.name` matching patterns like `^dns$|^clab-dns`, or document this as a deployment policy (model must be vetted by human before calling `deploy()`).

---

## Summary

| Line | File | Severity | Issue |
|------|------|----------|-------|
| 77 | validate.ts | CRITICAL | Zone name injection in double quotes |
| 63 | validate.ts | CRITICAL | File path injection in double quotes |
| 122–126 | deployEngine.ts | CRITICAL | Exit code masking on rndc reload failure |
| 119 | deployEngine.ts | MEDIUM | No validation of topology.name against production patterns |

**Blockers (fix before deploy):** Lines 77, 63, 122–126.  
**Polish (before production):** Line 119.
