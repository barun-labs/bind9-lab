# API Reference

All routes live under `/api/v1`. Every one of them except `POST /api/v1/sessions` requires a
`Bearer` token in the `Authorization` header. The token is either a session token (from login) or an
API key. Without a valid one, the server responds `401` with `UNAUTHORIZED`. Static files and SPA
routes are never under `/api/`, so they skip this hook entirely.

Permissions are per configuration and take one of three values used by the routes: `view`, `edit`,
or `deploy`. `edit` implies the actor can write objects; `deploy` is what gates lab deploy/destroy
and the change-set pipeline. An API key can grant these only if its scopes cover them, and a
read-only key can only ever pass `view`. See [Isolation & Security](isolation-security.md) for the
full model.

Errors follow one shape: `{ "error": { "code": "...", "message": "..." } }`. The code is a
stable identifier (`NOT_FOUND`, `FORBIDDEN`, `NOT_A_DNS_LAB`, …); the message is human-facing.

## Auth & session

| Method | Path | Purpose | Permission |
|---|---|---|---|
| `POST` | `/api/v1/sessions` | Log in with `username` + `password`; returns a session token. | none (login) |
| `DELETE` | `/api/v1/sessions/current` | Revoke the presenting session token. | session only (API keys get `NOT_A_SESSION`) |
| `GET` | `/api/v1/me` | Return the current actor's id, username, display name, and roles. | any Bearer |
| `POST` | `/api/v1/api-keys` | Create an API key (`name`, `scopes`, `readOnly`, `expiresAt`); returns the token once. | session only — API keys cannot create API keys |
| `GET` | `/api/v1/api-keys` | List the current user's API keys (never leaks the token/hash). | any Bearer |
| `DELETE` | `/api/v1/api-keys/:id` | Delete an API key (owner or admin; read-only keys cannot delete). | owner or admin |

## Configurations

| Method | Path | Purpose | Permission |
|---|---|---|---|
| `GET` | `/api/v1/configurations` | List configurations the actor can view, with live `counts`; supports `?q=`. | `view` (filtered per config) |
| `GET` | `/api/v1/configurations/:configId/search` | Search zones, records, views, servers, and external hosts by `?q=`. | `view` |

## Views

| Method | Path | Purpose | Permission |
|---|---|---|---|
| `GET` | `/api/v1/configurations/:configId/views` | List views. | `view` |
| `GET` | `/api/v1/configurations/:configId/views/:viewId` | Get one view. | `view` |
| `POST` | `/api/v1/configurations/:configId/views` | Create a view (`name`, `order`, `matchClients`). | `edit` |
| `PATCH` | `/api/v1/configurations/:configId/views/:viewId` | Update a view. | `edit` |
| `DELETE` | `/api/v1/configurations/:configId/views/:viewId` | Delete a view; `409 HAS_DEPENDENTS` if it still has zones. | `edit` |

## Zones

| Method | Path | Purpose | Permission |
|---|---|---|---|
| `GET` | `/api/v1/configurations/:configId/zones` | List zones with filters (`view`, `type`, `status`, `q`, `sort`, `page`, `size`). | `view` |
| `POST` | `/api/v1/configurations/:configId/zones` | Create a zone (`name`, `viewId`, `type`, `soa`, …). | `edit` |
| `GET` | `/api/v1/zones/:zoneId` | Get one zone. | `view` |
| `PATCH` | `/api/v1/zones/:zoneId` | Update a zone. | `edit` |
| `DELETE` | `/api/v1/zones/:zoneId` | Delete a zone and its records; returns dependent count. | `edit` |

## Records

| Method | Path | Purpose | Permission |
|---|---|---|---|
| `GET` | `/api/v1/zones/:zoneId/records` | List records in a zone with filters. | `view` |
| `POST` | `/api/v1/zones/:zoneId/records` | Create a record (`name`, `type`, `rdata`, `ttl`, …). | `edit` |
| `PATCH` | `/api/v1/records/:id` | Update a record (may move it between zones). | `edit` |
| `DELETE` | `/api/v1/records/:id` | Delete a record. | `edit` |

## External hosts

| Method | Path | Purpose | Permission |
|---|---|---|---|
| `GET` | `/api/v1/configurations/:configId/external-hosts` | List external hosts, `?q=` filters by fqdn or id. | `view` |

## ACLs

| Method | Path | Purpose | Permission |
|---|---|---|---|
| `GET` | `/api/v1/configurations/:configId/acls` | List ACLs. | `view` |
| `GET` | `/api/v1/configurations/:configId/acls/:aclId` | Get one ACL. | `view` |
| `POST` | `/api/v1/configurations/:configId/acls` | Create an ACL (`name`, `entries`). | `edit` |
| `PATCH` | `/api/v1/configurations/:configId/acls/:aclId` | Update an ACL. | `edit` |
| `DELETE` | `/api/v1/configurations/:configId/acls/:aclId` | Delete an ACL. | `edit` |
| `POST` | `/api/v1/configurations/:configId/acls/evaluate` | Evaluate an ACL against `target` and `clientIp`. | `view` |

## Servers

| Method | Path | Purpose | Permission |
|---|---|---|---|
| `GET` | `/api/v1/configurations/:configId/servers` | List servers. | `view` |
| `GET` | `/api/v1/configurations/:configId/servers/:serverId` | Get one server. | `view` |
| `POST` | `/api/v1/configurations/:configId/servers` | Register a DNS server directly (`hostname`, `nodeName`, `serviceInterfaces`, …). | `edit` |
| `PATCH` | `/api/v1/configurations/:configId/servers/:serverId` | Update a server. | `edit` |
| `DELETE` | `/api/v1/configurations/:configId/servers/:serverId` | Delete a server. | `edit` |

## Labs

| Method | Path | Purpose | Permission |
|---|---|---|---|
| `GET` | `/api/v1/labs` | List labs, optionally `?configurationId=`. | `view` |
| `POST` | `/api/v1/labs` | Create a lab (`name`, `configurationId`, `topology`). | `edit` |
| `POST` | `/api/v1/labs/import` | Import a containerlab YAML into a lab (`configurationId`, `yaml`). | `edit` |
| `GET` | `/api/v1/labs/:id` | Get one lab. | `view` |
| `PATCH` | `/api/v1/labs/:id` | Update a lab. | `edit` |
| `DELETE` | `/api/v1/labs/:id` | Delete a lab and its reconciled servers. | `edit` |
| `POST` | `/api/v1/labs/:id/render` | Render the containerlab YAML for the lab. | `view` |
| `GET` | `/api/v1/labs/:id/yaml` | Same YAML, returned as `text/yaml`. | `view` |
| `POST` | `/api/v1/labs/:id/validate` | Validate topology and each BIND server's config. | `view` |
| `POST` | `/api/v1/labs/:id/deploy` | Deploy the lab; returns a `jobId`. | `deploy` |
| `POST` | `/api/v1/labs/:id/destroy` | Tear down the lab's containers. | `deploy` |
| `POST` | `/api/v1/labs/:id/sync` | Re-inspect runtime state without deploying. | `view` |
| `GET` | `/api/v1/labs/:id/telemetry` | Point-in-time runtime snapshot. DNS-lab only. | `view` |
| `GET` | `/api/v1/labs/:id/statistics` | Per-server BIND statistics snapshot. DNS-lab only. | `view` |
| `POST` | `/api/v1/labs/:id/query` | Run `dig` inside a bind node. DNS-lab only. | `view` |
| `GET` | `/api/v1/labs/:id/telemetry/stream` | Server-sent events, one snapshot every 2.5s. DNS-lab only. | `view` |
| `GET` | `/api/v1/labs/:id/nodes/:node/logs` | Docker logs for one node, `?tail=N`. DNS-lab only. | `view` |
| `GET` | `/api/v1/configurations/:configId/health` | Static config health analysis. | `view` |
| `GET` | `/api/v1/deploy-jobs` | List lab deploy jobs, optionally `?labId=`. | `view` (per job's lab) |
| `GET` | `/api/v1/deploy-jobs/:id` | Get one lab deploy job. | `view` (on the job's lab) |

## Review & Deploy

| Method | Path | Purpose | Permission |
|---|---|---|---|
| `GET` | `/api/v1/configurations/:configId/change-set` | Compute the pending change set (live model vs baseline). | `view` |
| `GET` | `/api/v1/configurations/:configId/change-set/diff` | Per-server rendered diff; `?mode=split` and `?server=` supported. | `view` |
| `POST` | `/api/v1/configurations/:configId/deploy-jobs` | Preflight + run a change-set deploy; returns a `jobId`. | `deploy` |
| `GET` | `/api/v1/configurations/:configId/deploy-jobs/:jobId` | Get one change-set deploy job. | `view` |
| `POST` | `/api/v1/configurations/:configId/deploy-jobs/:jobId/retry` | Retry failed servers (`serverId` optional, defaults to all failed). | `deploy` |
