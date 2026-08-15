# Slice 4 — deploy engine: adversarial test report

**Verdict: DEFECTS FOUND — 1**

Suite: `backend/test/deployEngine.adversarial.test.ts` (8 tests).
Full backend run: 336 tests, **335 passed, 1 failed** (the failure is the intentional defect below).

## What passed

- **Gate un-bypassable.** For three broken models — CNAME at apex, forwarder `not-an-ip`, and a
  PRIMARY zone whose `named-checkzone` fails — `deploy(...)` returns `aborted: 'pre-flight failed'`
  and the mock runner never receives a script containing `containerlab deploy`. Exercised with
  `dryRun: false` explicitly; the gate sits above the dryRun branch so it cannot be skipped.
- **No partial deploy.** With two servers where `srv-bad` fails checkzone and `srv-good` validates
  clean (`ok: true`), the result still aborts and no `containerlab deploy` script reaches the mock.
  The valid server does not slip through.
- **dryRun never deploys.** Plan is returned, no deploy script executed.
- **Name safety.** With `topology.name = 'bind9mgr-demo'`, every script references `bind9mgr-demo`;
  no script contains `clab-dns-` or a bare ` dns ` token.
- **labDir injection.** `labDir = '/tmp/lab; rm -rf /tmp/pwned'` is emitted single-quoted
  (`mkdir -p '/tmp/lab; rm -rf /tmp/pwned'`) and the unquoted form is absent.
- **Runner failure surfaces.** A per-node `$? = 1` marker yields `ok: false` for that server and
  `ok: true` for a healthy one; a top-level runner `code: 1` with empty stdout yields `ok: false`
  for every server (never a silent success).

## The defect (test left failing)

**Node-name shell injection via the `echo` markers.** `buildDeployScript` interpolates `serverId`
into the per-node marker lines with plain double quotes, not `shellQuote`:

```ts
lines.push(`echo "${NODE_BEGIN} ${serverId}"`);
lines.push(`echo "${NODE_END} ${serverId} $?"`);
```

A node name that closes the double quote turns the rest of the line into a command. With
`serverId = 'srv"; rm -rf /tmp/pwned; echo "'` the built script contains:

```
echo "__BIND9MGR_NODE_BEGIN__ srv"; rm -rf /tmp/pwned; echo ""
```

`; rm -rf /tmp/pwned;` is a separate, executed command. The `docker exec` lines are correctly
`shellQuote`d (single-quoted, safe); only the two marker `echo` lines are exposed. This violates
requirement (2)'s spirit — all host interaction is confined to `opts.run`, but the script handed to
`run` is built by splicing an unsanitized name into a shell string.

Failing test: `test/deployEngine.adversarial.test.ts` →
`node name with shell metacharacters must be quoted in every interpolation`.

Fix direction (not applied): validate node names against `^[A-Za-z0-9_.-]+$` before building the
script, or shell-quote the `serverId` in the marker echoes and have `parseDeployed` strip the
quotes when matching markers.
