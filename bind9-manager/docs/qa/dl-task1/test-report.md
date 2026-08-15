# Declarative-lab Task 1 — Independent Adversarial Test Report

Verdict: **DEFECTS FOUND**

Date: 2026-08-15
Evaluator: independent (did not author the code under test)
Code under test: `src/server/labStore.ts` (Lab CRUD + `reconcileServers`) and the
`/api/v1/labs` routes in `src/server/app.ts`.

## Result

- Full backend suite: **382 passed, 1 failed** (383 tests, 26 files).
- `npx tsc --noEmit`: clean.
- New adversarial files: `test/labStore.adversarial.test.ts` (11 tests),
  `test/app.labs.adversarial.test.ts` (8 tests).

## Defect found (failing test left in place, not fixed)

**Two labs in the SAME configuration with the SAME bind node name clobber each
other's Server.**

`reconcileServers` derives a Server's identity from the node name alone —
`id: 'srv-' + node.name` — and `deleteServerByNode` / `upsertServer` match on
`id`/`nodeName` without scoping to the lab. So:

1. `createLab(A, node "ns-shared")` creates server `srv-ns-shared` with
   `labName: "labA"`.
2. `createLab(B, node "ns-shared")` upserts `srv-ns-shared` and, on the PK
   conflict, overwrites it with `labName: "labB"`. Lab A's server is gone; only
   one server remains.
3. `deleteLab(A)` then runs `deleteServerByNode(config, "ns-shared")`, which
   also deletes lab B's server.

Failing assertion (`test/labStore.adversarial.test.ts`): after creating two labs
with the same node name, expect one Server per lab (`length 2`); actual `1`.

This is adjacent to, not covered by, the acceptance probe "two labs in the SAME
configuration with **different** bind nodes don't clobber" (which passes). Node
names are unique only per topology, not per lab, so `ns1` in two labs is a
realistic case.

Suggested fix (not applied): scope server identity/cleanup to the lab — e.g.
`id: 'srv-' + lab.id + '-' + node.name` (or a lab-scoped lookup in
`deleteServerByNode`), so reconcile never touches another lab's servers.

## Acceptance probes — all PASS

| Probe | Result |
|---|---|
| bind node creates exactly one Server (nodeName match) | PASS |
| router/bridge nodes create none | PASS |
| renaming a bind node leaves exactly the new Server, not both | PASS |
| two labs, same config, **different** bind nodes don't clobber each other | PASS |
| update lab to remove ALL bind nodes unlinks all its Servers | PASS |
| bind node with no `interfaces` → Server with empty `serviceInterfaces`, no throw | PASS |
| interface `10.70.0.11/24` → `serviceInterfaces[0].address === '10.70.0.11'`, port 53 | PASS |
| CRUD missing id sane: get→null, list→[], delete→no-throw, update→throws (route → 404) | PASS |
| `listLabs` filters by `configurationId` (lab in config A absent from config B list) | PASS |
| unauth → 401 on every `/labs` route | PASS |
| viewer → 403 on POST/PATCH/DELETE, 200 on GET | PASS |
| admin → full access; create (201) then GET returns it | PASS |
| lab response never leaks `token`/`keyHash`/`pwHash`/`pwSalt`/`password` | PASS |
| lab name / node name with quotes + unicode round-trips through the JSON column intact | PASS |

## Notable non-defect finding

Changing a lab's `configurationId` **relocates** its Server to the new config
(no orphan in the old config). This is correct, but by accident: the
`ON CONFLICT(id)` upsert moves the row because the id is config-independent.
Locked in as a passing probe in `test/labStore.adversarial.test.ts`.
