# API contract sketch

Rough OpenAPI-style sketch. Base path `/api/v1`. JSON everywhere. Consistency over completeness.

## Shared conventions

- **Pagination**: query `page` (1-based), `size`. Response envelope: `{data:[...], page, size, total}`.
- **Sorting**: query `sort=field:asc|field:desc`, single field per request.
- **Filtering**: one query param per filterable field (e.g. `type=A`, `status=pending`); `q` is a
  free-text search across the object's identifying fields.
- **Error envelope**: `{error: {code: string, message: string, field?: string, details?: any}}`,
  HTTP status matches (400 validation, 404 not found, 409 conflict e.g. duplicate record, 422
  pre-flight failed).
- **Long-running deploy jobs**: `POST /deploy-jobs` returns `{id, status:'QUEUED'}` immediately.
  Client either opens `GET /deploy-jobs/:id/stream` (SSE, `event: progress` / `event: done`) or polls
  `GET /deploy-jobs/:id` per the interval in `performance-spec.md`.
- All list endpoints below are implicitly scoped to a Configuration via the path unless noted.

## Configurations
- `GET /configurations` — list, includes `counts`
- `POST /configurations` — `{name, description?, templateId?}` → clone/template/blank
- `POST /configurations/:id/clone` — `{name}`
- `POST /configurations/:id/activate`
- `DELETE /configurations/:id` — `{confirmName}`, server validates match; creates a snapshot first
- `GET /configurations/compare?a=:idA&b=:idB` — object-level diff summary

## Views
- `GET /configurations/:configId/views`
- `POST /configurations/:configId/views` · `PATCH /views/:id` · `DELETE /views/:id`
- `POST /views/reorder` — `{orderedIds:[]}`

## Zones & Records
- `GET /configurations/:configId/zones` — filters `view,type,status,q`, paginated
- `GET /zones/:id` · `PATCH /zones/:id` (SOA, ACLs) · `DELETE /zones/:id`
- `GET /zones/:id/records` — filters `type,status,q`, paginated, `sort`
- `POST /zones/:id/records` · `PATCH /records/:id` · `DELETE /records/:id`
- `POST /records/bulk` — `{ids, action:'disable'|'delete'}`
- `POST /zones/:id/import` — raw zone file upload → parse report (mirrors adopt flow)
- `GET /zones/:id/export` — raw zone file download

## External Hosts
- `GET /configurations/:configId/external-hosts` — paginated
- `GET /external-hosts/:id/references` — records that point at it
- `POST /external-hosts` · `DELETE /external-hosts/:id`

## Network Blocks & Reverse Zones
- `GET /configurations/:configId/blocks` — tree
- `POST /blocks` · `PATCH /blocks/:id` · `DELETE /blocks/:id`
- `POST /blocks/:id/generate-reverse-zone`

## Deployment Roles & Options
- `GET /configurations/:configId/roles` — matrix rows
- `PUT /roles` — `{serverId, zoneId, role}` upsert single cell
- `GET /configurations/:configId/options?scopeType=&scopeId=` — includes `inheritedFrom`
- `PUT /options` — `{scopeType, scopeId, key, value}` (write null to clear an override, reverting to inherited)

## Servers & Services
- `GET /configurations/:configId/servers` — grouped by `labName` client-side from flat list
- `GET /servers/:id` · `PATCH /servers/:id` (admin state, mgmt/service interfaces)
- `GET /servers/:id/services` · `PATCH /servers/:id/services` — staged, goes through change set
- `POST /servers/:id/operations/:action` — `action ∈ {reload,reconfig,flush,dumpdb,start,stop,restart}` — immediate, NOT staged, returns `{output}` synchronously or a short-poll job for `restart`
- `GET /servers/:id/operations/status` — `rndc status` passthrough, on-demand
- `GET /servers/:id/config-review?tab=deployed|pending` — file tree + content
- `GET /servers/:id/config-review/live-diff` — fetches on-node config, diffs vs. last-known-deployed; `{outcome:'IN_SYNC'|'DRIFT'|'UNREACHABLE', diff?}`
- `POST /servers/:id/syslog/test` — `{result: 'sent'|'error', detail}`

## Review & Deploy
- `GET /configurations/:configId/change-set` — grouped `ChangeSetItem[]`
- `GET /configurations/:configId/change-set/diff` — unified/split lines per group
- `POST /deploy-jobs` — `{changeSetItemIds, targetServerIds}` → runs pre-flight then deploy
- `GET /deploy-jobs/:id` / `/stream`
- `POST /deploy-jobs/:id/retry` — `{serverId}` — retries only the failed server(s)
- `POST /servers/:id/rollback` — `{toDeployJobId}`

## Deployment History
- `GET /configurations/:configId/history` — paginated `DeployJob[]` summaries

## Backup & Restore
- `GET /configurations/:configId/snapshots` — filters `scope,trigger`
- `POST /snapshots` — `{label, scope, scopeRef}` manual; scheduler creates `SCHEDULED` ones server-side
- `GET /snapshots/:id`
- `POST /snapshots/:id/restore-preview` — `{}` → returns a diff (does not write)
- `POST /snapshots/:id/restore` — stages the previewed diff into the change set (does not deploy)
- `GET /snapshots/:id/export?format=object-model|bind-bundle`
- `POST /adopt` — multipart upload of named.conf + zone files → `{parseReport: {understood:[], skipped:[], needsAttention:[]}}`
- `POST /adopt/:reportId/commit` — creates the reviewed objects

## Command palette
- `GET /search?q=` — cross-object search, `{zones:[],records:[],servers:[],blocks:[]}`, top-N each
