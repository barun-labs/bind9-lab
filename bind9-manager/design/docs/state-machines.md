# State machines

Enum values are SCREAMING_SNAKE_CASE and shared verbatim between design and code.

## Pending change set (per Configuration)
```
NO_CHANGES → (edit made) → HAS_PENDING_CHANGES
HAS_PENDING_CHANGES → (all items discarded/reverted) → NO_CHANGES
HAS_PENDING_CHANGES → (Deploy clicked, pre-flight starts) → VALIDATING
VALIDATING → (checkconf/checkzone pass or pass-with-warning) → VALIDATED
VALIDATING → (checkconf/checkzone hard failure) → VALIDATION_FAILED → (back to) HAS_PENDING_CHANGES
VALIDATED → (operator confirms deploy) → DEPLOYING
DEPLOYING → (all targeted servers succeed) → NO_CHANGES (change set clears)
DEPLOYING → (one or more servers fail) → HAS_PENDING_CHANGES (failed items remain pending for retry)
```
Note: `VALIDATED` with an acknowledged warning still requires the explicit ack checkbox (see
validation-rules.md) before `DEPLOYING` is reachable.

## Deploy job
```
QUEUED → RUNNING → SUCCEEDED
RUNNING → FAILED           (all targeted servers failed)
RUNNING → PARTIAL          (mixed outcome — some servers succeeded, some failed)
QUEUED → CANCELLED         (operator cancels before it starts running)
```
`PARTIAL`/`FAILED` jobs expose a `retry` action scoped to the failed server(s) only; retry creates a
new DeployJob referencing the same `changeSetItemIds` but a narrowed `targetServerIds`.

## Per-server sync state
```
SYNCED ⇄ PENDING            (a change targets this server; reverts to SYNCED if the change is discarded)
PENDING → DEPLOYING → SYNCED            (deploy succeeds)
PENDING → DEPLOYING → ERROR             (deploy fails — see DeployOutcome)
SYNCED → DRIFT                          (live-vs-expected check finds a difference not caused by us)
DRIFT → DEPLOYING → SYNCED               ("re-deploy to correct" action)
(any) → NODE_ABSENT                      (containerlab node not present — health check can't even connect at the container level)
(any) → UNREACHABLE                      (node present but not answering — network/service issue)
NODE_ABSENT/UNREACHABLE → SYNCED|PENDING (node comes back; state re-evaluated on next health check)
```
`NODE_ABSENT` and `UNREACHABLE` are distinct and never conflated (see also ServerAdminState, which is
a separate axis — a server can be `ENABLED` and `NODE_ABSENT` simultaneously).

## Server administrative state
```
ENABLED ⇄ DISABLED_IN_APP     (operator toggle in Bind9-Manager; object definitions untouched)
ENABLED ⇄ NAMED_STOPPED       (rndc / service stop-start; the node itself stays up)
(any) → NODE_ABSENT           (containerlab destroy; outside the app's control)
NODE_ABSENT → ENABLED         (containerlab deploy brings the node back; app detects it on next health check and offers "push full config")
```
These three "off" causes are mutually distinguishable and rendered as three different badges — never
collapsed into one "offline" state.

## Snapshot / restore
```
(none) → SNAPSHOT_CREATED                       (auto pre-deploy/pre-destructive, manual, or scheduled)
SNAPSHOT_CREATED → RESTORE_PREVIEWED             (operator opens restore preview; read-only diff computed)
RESTORE_PREVIEWED → RESTORE_STAGED               (operator stages it — items enter the normal change set)
RESTORE_STAGED → (falls into the pending change set state machine above) → DEPLOYING → RESTORE_COMPLETE | RESTORE_FAILED
```
A restore is never a direct write — `RESTORE_STAGED` is indistinguishable from any other staged
change once it's in the change set, and goes through the same VALIDATING → DEPLOYING path.

## Health finding mute (per zone, per rule)
```
ACTIVE ⇄ MUTED
```
Muting is per (zone, rule) pair, always visible on the zone's Health tab (a small "muted" list, not a
hidden setting) — never a silent suppression.

## Deploy target resolution (Addendum 2 — target picker spans servers, groups, and change-set impact)
```
(operator picks) SERVER(S) | SERVER_GROUP(S) | AFFECTED_BY_CHANGESET
  → resolves to a concrete targetServerIds[] before the DeployJob is created
  → AFFECTED_BY_CHANGESET computes targetServerIds from the change set's own objects (their Deployment Roles)
  → a chosen SERVER_GROUP expands to its memberServerIds; a member-level result rolls up to a group-level
    outcome: ALL_SUCCEEDED | PARTIAL | ALL_FAILED (PARTIAL is visually distinct from ALL_SUCCEEDED — never rendered as success)
```
