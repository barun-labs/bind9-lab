# Keyed Manager↔DNS-Server Trust for Config Push — Design (Plane #36)

**Status:** self-approved under an autonomous "complete the backlog" directive. No
interactive user review gate was run; the rulings below stand in for it.

## Goal

Give every config push a verifiable trust relationship in both directions: the
Manager pushes only to a node it can prove it manages, and a node's applied config
carries a signature only its Manager could have produced. Today neither holds.

## The reality this must fit

The push transport is **local `docker exec`**, not a network protocol
(`changeSetDeploy.ts:141` `buildPushScript`, `:165` base64 file write, `:171`
`rndc reconfig/reload`). The container name is `clab-${lab.topology.name}-${node}`
(`:252`). There is no SSH, no HTTP agent on the node, and the `servers` row
(`db.ts:113`) is `(id, configurationId, data-JSON)` with **no auth field**
(`app/src/types/entities.ts:36`).

Because the channel is local exec into a stock-BIND container, a full mTLS or
per-node agent token is not a feature — it is a transport rewrite, and it buys
nothing while `docker exec` already implies root in the container. So this design
delivers the trust *artifacts and checks* that are real today, and names the
network-channel work as the explicit upgrade path.

## Approach

Three pieces, each independently testable.

### 1. Per-server trust key (entity)

Each Server gets a `trustKey`: a server-side-generated secret, following the TSIG
pattern exactly (`entityStore.ts:348`, `randomBytes(32).toString('base64')`,
stored in the `data` JSON, **stripped from list/get responses**, fetched
internally via a `getServerTrustSecret(db, serverId)` helper mirroring
`getTsigKeyWithSecret`). Fields on the Server `data` blob:

- `trustKeyId: string` — server-generated id (`tk-` + hex), returned by the API.
- `trustSecret: string` — base64, never returned after creation/rotation.
- `trustKeyCreatedAt: string` — ISO timestamp.

A key is minted automatically the first time a server is created or first deployed
without one (lazy), and can be rotated via `POST .../servers/:id/rotate-trust-key`
(admin-only). Rotation returns nothing secret — it just reports the new
`trustKeyId` + timestamp.

### 2. Manager validates the target (managed-target guard)

Before writing config to or exec'ing a container, the deploy path calls
`assertManagedTarget(container, lab, node)`:

- Inspect the container's containerlab labels
  (`clab-node-name`, `containerlab`/`clab-topo`).
- Require `clab-node-name === node.name` AND the topology label ===
  `lab.topology.name`.
- On mismatch or missing container, **abort the push for that node** with a
  `TARGET_UNTRUSTED` error recorded on the deploy job; do not exec.

This is the half that is fully real today: it stops the Manager from pushing into
an arbitrary or wrong container that merely matches a name.

### 3. Signed push manifest (integrity + manager authenticity)

Each per-node push computes a manifest:

```
manifest = {
  node, deployJobId, generatedAt,
  files: { "<relpath>": sha256(content), ... }
}
signature = HMAC-SHA256(trustSecret, canonicalJSON(manifest))
```

The push writes `.manager-manifest.json` (manifest + signature) alongside the
config on the node. A **verify** step (reused by post-deploy verify and by #59
adopt) recomputes the file hashes and the HMAC:

- Hashes differ → `CONFIG_DRIFT` (files changed out-of-band since the last push).
- Signature invalid under the current `trustSecret` → `UNTRUSTED_MANIFEST` (the
  applied config was not signed by this Manager's current key).

This is the concrete "server validates the push came from its Manager": the
evidence lives on the node and only the holder of `trustSecret` can produce it.

## Data model

No new table. Extend the Server `data` blob with the three `trust*` fields above.
Schema init (`db.ts`) is unchanged; the JSON store (`entityStore.ts:1103`
`upsertServer`) already accepts new fields.

## API

- `GET /configurations/:configId/servers` / `:id` — now include `trustKeyId` and
  `trustKeyCreatedAt`, never `trustSecret`.
- `POST /configurations/:configId/servers/:id/rotate-trust-key` — admin-only;
  regenerates the secret, returns `{ trustKeyId, trustKeyCreatedAt }`.
- Deploy job result gains per-node trust outcome: `trust: 'SIGNED' | 'TARGET_UNTRUSTED' | 'SKIPPED'`.

## Deploy integration

In `changeSetDeploy.ts`: after `buildPushScript` assembles a node's files and
before the exec, (a) call `assertManagedTarget`; on failure record
`TARGET_UNTRUSTED` and skip the node, (b) compute the manifest+signature and add
`.manager-manifest.json` to the pushed file set. The manifest is part of the
pushed bundle, so it flows through the same base64/decode path — no transport
change. `rndc reconfig/reload` is unchanged.

## Change-set

The manifest file is deploy-time metadata, not part of the generated config model,
so it is intentionally **outside** the change-set diff (it would otherwise churn
every deploy on its timestamp). Documented as such.

## Security constraints (binding, from the parity spec)

- `trustSecret` generated server-side (`randomBytes(32)`), stored hashed/opaque,
  **never returned** after creation or rotation.
- `trustKeyId` server-generated.
- Rotate route gates on RBAC `admin`.
- Container label values are compared as exact strings; no shell interpolation of
  untrusted container output into the push script (reuse `shellQuote.ts`).
- Manifest canonicalization is deterministic (sorted keys) so the HMAC is stable.

## Out of scope (upgrade path, named explicitly)

- Per-server **rndc key over `inet`** control channel (replacing `docker exec`
  with an authenticated network reload). This is the natural next step once nodes
  are reachable off-host; the per-server key minted here is the credential it will
  use.
- A node-side agent that rejects unsigned pushes at write time. Today the Manager
  is the only writer (local exec); the signed manifest gives after-the-fact
  detection, which is the achievable guarantee without an agent.

## Testing (must-fail controls required)

- Trust key is generated on first deploy; `trustSecret` is **absent** from every
  API response (must-fail: a test asserting the secret is returned must fail).
- `assertManagedTarget` rejects a container whose `clab-node-name` label mismatches
  (must-fail control: a wrong-label container must not be pushed to).
- Manifest signature verifies with the correct secret and **fails** with a rotated
  secret (must-fail: verifying a manifest under the wrong key must report
  `UNTRUSTED_MANIFEST`).
- Tampering with a file after push yields `CONFIG_DRIFT` on verify.
- Rotate route returns no secret and requires admin (must-fail: non-admin 403).
