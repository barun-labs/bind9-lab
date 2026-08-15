# Slice 2a Unit B — Independent adversarial test report

Tester: independent (did not author the code). Date: 2026-08-15.

Scope: `backend/src/server/authorize.ts` (`authorize`) and `shared/can.ts` (`can`).
Verdict: **DEFECTS FOUND — 1 escalation path.**

## What was tested

Full suite: `cd backend && npx vitest run`.

- Test files: 11 (1 failed file = the adversarial suite, failing on purpose for the defect).
- Tests: 160 total — 157 passed, 3 failed (the 3 DEFECT tests below; every other adversarial case passed).

The clamp logic in `authorize()` is correct on every boundary I threw at it. The
escalation lives one layer down, in `can()`'s `deploy` branch.

## Coverage

- **api-key can never escalate to admin** — every role × every one of the 8 scope subsets ×
  readOnly true/false (48 combinations): all `false`, no throw. PASS.
- **read-only clamp** — `readOnly` key blocks `edit` and `deploy` even when owner is admin with
  canDeploy; `view` still passes when `read` is scoped. PASS.
- **scope enforcement** — for every owner role, missing mapped scope (view→read, edit→write,
  deploy→deploy) is `false`. PASS.
- **scope present but role absent** — viewer owner with `write` scope cannot `edit`; viewer with
  `deploy` scope cannot `edit`/`admin`. PASS.
- **config scoping** — role on `dns-lab`, ask `other-config`: `false` as session and as api-key. PASS.
- **degenerate inputs** — empty `roles: []`, undefined `roles`, inactive user, unknown permission
  string (cast) → `false` not throw; empty `scopes: []` → view/edit/deploy all false; undefined
  `scopes` → false; null/undefined actor, missing user → false. All PASS.
- **session actor not clamped** — admin session → admin/edit/deploy/view true; admin without
  canDeploy → deploy false, rest true. PASS.

## Defect 1 — viewer with `canDeploy=true` can deploy (privilege escalation)

**Where:** `shared/can.ts:29-31` — the `deploy` case.

```ts
case 'deploy':
  return Boolean(assignment.canDeploy);
```

`deploy` checks only `canDeploy` and never the role. `edit` (line 25-27) and `admin`
(line 27-28) both gate on role; `deploy` does not. So a `viewer` — a read-only role — with
`canDeploy: true` gains a production deploy right it should not have.

**Reachable?** Yes. `app/src/routes/Users/Users.tsx:40` (`handleRoleChange`) preserves
`canDeploy` on demotion: `canDeploy: newRole === 'admin' ? true : canDeploy`. Demote an
editor/admin (who legitimately had `canDeploy: true`) to `viewer` and the flag stays `true`.

**Repro (failing tests):**

- `can(viewer+canDeploy, 'deploy', 'dns-lab')` → `true` (should be `false`).
- `authorize({user: viewer+canDeploy}, 'deploy', 'dns-lab')` → `true` (session actor).
- `authorize({user: viewer+canDeploy, viaApiKey: {scopes:['deploy'], readOnly:false}}, 'deploy', 'dns-lab')` → `true` (api-key actor).

All three are left failing in `backend/test/authorize.adversarial.test.ts` under
`DEFECTS: escalation paths`.

**Why it matters for `authorize()`:** `authorize` correctly never widens past `can()`. But
`can()` itself over-grants deploy to viewers, so `authorize` faithfully reproduces the
escalation for both session and key actors. The fix belongs in `can()` (require
`editor`/`admin` in the `deploy` branch), not in `authorize`.

## Coverage gaps (defense-in-depth, not escalation in `authorize`'s contract)

- `authorize` does not check `viaApiKey.ownerUserId === actor.user.id`. It trusts the caller
  (middleware) to pass the key's resolved owner. A mismatched pair is not an escalation here
  (the key's scopes still clamp, and `can()` gates on `user`), but it is a data-consistency
  assumption worth a middleware test.
- `authorize` does not check `viaApiKey.expiresAt`. Expiry is `resolveApiKey`'s job; if a caller
  constructs an actor with an expired key directly, `authorize` will not reject it. Trust-boundary
  note only.
- `can()` uses `roles.find` — with duplicate assignments for one config, the first match wins.
  No dedup/ordering guarantee asserted.

## Defect summary

| # | Severity | Location | Effect |
|---|---|---|---|
| 1 | High | `shared/can.ts` `deploy` branch | viewer + `canDeploy:true` deploys (session and api-key) |
