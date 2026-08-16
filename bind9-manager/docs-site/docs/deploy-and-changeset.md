# Deploy & Change Sets

There are two distinct deploy paths, and they do different things. Do not read one as a synonym for
the other.

1. **Lab lifecycle** brings a whole topology up or down with containerlab.
2. **Review & Deploy** pushes config changes to the servers of an already-existing lab.

The first is about containers existing at all. The second is about the BIND config those containers
run.

## Path 1: lab lifecycle

`POST /api/v1/labs/:id/deploy` renders a containerlab topology and per-node BIND config, runs
`containerlab deploy`, and reconciles the runtime state back into the entity store. `POST
/api/v1/labs/:id/destroy` tears it down with `containerlab destroy`.

Deploy is a job, not a synchronous wait. The route returns a `jobId`, and the caller polls
`GET /api/v1/deploy-jobs/:id` for the outcome. The job, defined in `deployJobs.ts`, moves from
`QUEUED` to `RUNNING` and lands on `SUCCEEDED` or `FAILED`. What the deploy engine does under the
hood, in order:

- Validates every BIND server's generated config with `named-checkconf`/`named-checkzone` in a
  throwaway container. A failed validation aborts before any container is touched.
- Writes `topo.clab.yml` and, per bind node, its `named.conf` and zone files under the lab directory.
- Brings up any `kind: bridge` nodes on the host (`ip link add … type bridge`), because containerlab
  references host bridges but never creates them.
- Runs `containerlab deploy -t … --reconfigure`.
- Applies data-plane provisioning (`ip addr replace`, `ip route replace`, `sysctl ip_forward`) for
  nodes that declare interfaces, routes, or forwarding.
- Starts (or reloads) `named` in each bind container, then inspects the result and reconciles
  `syncState` on each server (`SYNCED`, `ERROR`, `NODE_ABSENT`, …).

Destroy is simpler and irreversible: it runs `containerlab destroy --cleanup`, then marks every bind
server `NODE_ABSENT` and the lab `DESTROYED`. It never stamps `lastDeployedAt` — the servers were
not just deployed.

## Path 2: Review & Deploy (config change-set)

The second path handles config drift: objects you changed in the UI that have not yet been pushed to
the lab. The key detail is that the pending change set is **computed, not stored**. There is no
"staged changes" table. On every `GET /api/v1/configurations/:configId/change-set`, the backend
builds the live `ConfigModel`, loads the stored per-configuration baseline (the last successfully
deployed model), and diffs the two with `computeChangeSet`. `baseline === null` means every current
object is a `CREATE`.

Deploying a change set (`POST /api/v1/configurations/:configId/deploy-jobs`) goes through these
gates, in order:

- The configuration must have a lab, and that lab must be a DNS lab (otherwise `NOT_A_DNS_LAB`).
- `targetServerIds` must be non-empty and every target must be a real server in the config's model.
- Preflight runs `named-checkconf` and `named-checkzone` per target server. A `FAIL` blocks the
  deploy with `PREFLIGHT_FAILED`. A `WARN` blocks it too (`PREFLIGHT_WARNING_UNACK`) unless the
  request sets `warningAck: true`.
- On success through preflight, the job pushes each target server's regenerated files to
  `configs/<node>/…` and runs `rndc reconfig` then `rndc reload` in its container.

The baseline is replaced **only on full success** — every target `SUCCEEDED`. A `PARTIAL` or
`FAILED` deploy leaves the old baseline in place, which keeps the failed items pending on the next
change-set compute. Full success replaces the baseline, and because the baseline now equals the live
model, the change set computes to empty.

Retry (`POST …/deploy-jobs/:jobId/retry`) narrows to the failed servers: it defaults to every server
whose outcome was `FAILED`, or a single `serverId` in the body. It re-runs preflight and creates a
new job referencing the same `changeSetItemIds` but a narrower `targetServerIds`.

## The state machines

From `design/docs/state-machines.md`, quoted verbatim:

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

`VALIDATED` with an acknowledged warning still requires the explicit ack checkbox before `DEPLOYING`
is reachable.

The deploy job itself:

```
QUEUED → RUNNING → SUCCEEDED
RUNNING → FAILED           (all targeted servers failed)
RUNNING → PARTIAL          (mixed outcome — some servers succeeded, some failed)
QUEUED → CANCELLED         (operator cancels before it starts running)
```

`PARTIAL`/`FAILED` jobs expose a `retry` action scoped to the failed server(s) only; retry creates a
new DeployJob referencing the same `changeSetItemIds` but a narrowed `targetServerIds`.

## Which path to read when

If you want to know whether a lab is up, that's the lab deploy job. If you want to know whether your
last UI edits reached the running `named`, that's the change-set deploy job. The two jobs are stored
in separate tables (`deploy_jobs` vs `changeset_deploy_jobs`) and surfaced under different routes.
