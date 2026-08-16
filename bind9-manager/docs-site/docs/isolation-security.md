# Isolation & Security

The central safety property is this: Bind9-Manager only ever manages its own DNS lab. Every design
decision on this page exists to make that property hold even when a request is malformed, hostile,
or simply wrong.

## The `isDnsLab` guard

`labStore.ts` defines `isDnsLab(lab)`: a lab is a DNS lab iff its topology has at least one node
with `intent: 'bind'`. Every route that deploys, destroys, or inspects a lab checks this first and
returns `422 NOT_A_DNS_LAB` otherwise. The consequence: the app will not deploy, destroy, or stream
state for a containerlab topology that is not a BIND lab. If you point it at a lab with no bind
nodes, it refuses — it never treats an arbitrary containerlab project as something it owns.

## Container names come from the model, not the request

The container name for a node is always derived server-side as `clab-<topology.name>-<node.name>`.
The request supplies an id or a node name; the code resolves that id against the configuration's own
model, then rebuilds the container name from the lab's stored topology name and the now-validated
node name. The `:node` log route spells out the three defences in order:

1. Charset — the node param must match `^[A-Za-z0-9_-]+$`.
2. Membership — the name must be one of this lab's own topology nodes.
3. Derivation — the container name is built from the lab's topology name and the validated node
   name, never taken from the raw request, and shell-quoted before interpolation.

The deploy-push path applies the same rule to `targetServerIds`: an id becomes a container name and
a filesystem path, so an unvalidated body id like `../../etc` would be an arbitrary-write vector.
The routes allowlist every target against `buildConfigModel(...).servers`, so the id is always a
server-generated, charset-validated value.

## Charset validation, because shell-quoting is not enough

Names that become filesystem paths or container arguments are validated against `^[A-Za-z0-9_-]+$`
(topology names, node names) or a DNS-safe variant for hostnames and view/zone/ACL names. The reason
is stated in the code: shell-quoting stops shell metacharacters, but not path traversal. `shellQuote`
wraps a value in single quotes and escapes embedded quotes — it will not stop `../`. The charset
check is the thing that makes a traversal impossible, because a `..` or `/` can't pass it. Both
defences are applied, not just one.

## RBAC: view / edit / deploy per configuration

Authorization (`authorize.ts` plus `shared/can.ts`) is scoped per `configurationId`. A user has a
role assignment per configuration — `viewer`, `editor`, or `admin` — and the permissions follow:

- `view` — viewer, editor, or admin.
- `edit` — editor or admin.
- `deploy` — editor or admin **with** `canDeploy` set.
- `admin` — admin only, and an API key can never grant it.

API keys layer on top of that. A key carries scopes (`read`, `write`, `deploy`) and a `readOnly`
flag. A read-only key fails any `edit`/`deploy` check. A key whose scopes don't include the required
scope fails too. Keys also cannot create other keys, and cannot be revoked through the session
logout route.

## Server-side id generation

Object ids are assigned by the server, not trusted from the client. Views, zones, ACLs, servers, and
labs all generate their own ids and ignore any client-supplied one (records are the one exception —
they accept an optional id but default to a server counter). Combined with the target allowlist
above, this means a deploy can only ever reference an id the server itself minted.

## A self-contained lab

The lab must never silently resolve against the real internet. Two renderer defaults enforce that:

- `dnssec-validation` defaults to `no` on generated configs, so recursive nodes don't try to validate
  against the real DNS root's trust anchor.
- Root hints are replaced with the lab's own root. `rootHints.ts` finds the server holding the `.`
  zone as `PRIMARY` and generates a `db.root` pointing at that server's service address, so a
  recursive in the lab follows the lab root — not the IANA root servers.

The practical effect: a typo in a lab zone produces an NXDOMAIN or SERVFAIL inside the lab. It does
not leak the query to public DNS.

## What this does and does not mean

These measures keep the app from touching machines it doesn't own and from being steered into
arbitrary file writes or shell injection through request input. They are not a substitute for running
the app behind a trusted network boundary, keeping credentials out of committed files (see
[Runbook](runbook.md)), and treating the API as authoritative for the lab it manages.
