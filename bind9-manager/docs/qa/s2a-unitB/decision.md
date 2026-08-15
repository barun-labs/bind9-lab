# Unit B — orchestrator decision

**Verdict: DEFECT FOUND → fix (round 1), then accept.**

## Inputs
- **Tester (deepseek-v4-pro):** DEFECTS FOUND. 157 passed / 3 failed (the 3 are intentional
  defect-proving tests). Full clamp matrix on `authorize()` — admin-block (48 combos), readOnly clamp,
  scope enforcement, role-absent clamp, config scoping, degenerate inputs, session-not-clamped — all
  pass. Cost $1.32, deepseek-only.
- **Reviewer (cavecrew / Claude):** "No issues." Reasoned about `authorize()`'s clamp but did NOT catch
  the underlying `can()` deploy bug.

## The defect (HIGH — real privilege escalation)
`shared/can.ts` returns `deploy` as `Boolean(assignment.canDeploy)` with **no role check**. A `viewer`
with `canDeploy:true` can deploy — as a session and via an api-key (the clamp maps deploy→deploy scope
but the base `can()` already wrongly allowed it). Reachable: `app/src/routes/Users/Users.tsx` preserves
`canDeploy` when a user is demoted to viewer.

**Cross-model value, demonstrated:** a single build + a code review both passed this; only the
independent adversarial test pass caught it. This is the reason the tester and reviewer are different
models.

**The duplication bit us:** the same bug is in `app/src/auth/can.ts` (the original) and `shared/can.ts`
(the slice-2a copy). Fix BOTH. (Reinforces the note to unify the two `can.ts` in a cleanup slice.)

## Fix (round 1)
In BOTH `shared/can.ts` and `app/src/auth/can.ts`: `deploy` requires the assignment's role to be
`editor` or `admin` AND `canDeploy === true`. A viewer can never deploy regardless of the flag.
Re-run: the 3 adversarial tests flip to pass; frontend `can.test` + full app suite + backend suite all
green. Update any existing test that encoded the buggy behavior (it was asserting a bug).

**Committed:** f1acb03
