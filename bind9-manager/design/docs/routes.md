# Route map

Base path omitted. `:param` = path param. All list routes accept `page`, `size` (default from
performance-spec.md), `sort` (`field:asc|desc`). All record-typed filters are deep-linkable.

| Route | Params (query) | Screen |
|---|---|---|
| `/configurations` | `compare=idA,idB` | Configurations list |
| `/configurations/new` | `template=:templateId` | New Configuration (modal state, not a real navigation — see note) |
| `/config/:configId` | — | Redirects to `/config/:configId/zones` |
| `/config/:configId/views` | — | Views list |
| `/config/:configId/views/:viewId` | — | View detail (ACL editor, ordering) |
| `/config/:configId/zones` | `view`, `type`, `status`, `q`, `page`, `size`, `sort` | Zones list |
| `/config/:configId/zones/:zoneId/records` | `type`, `status`, `q`, `page`, `size`, `sort`, `recordId` (opens edit panel) | Zone detail / Records |
| `/config/:configId/external-hosts` | `q`, `page`, `size` | External Hosts |
| `/config/:configId/blocks` | `expanded=id1,id2` | Network Blocks & Reverse Zones |
| `/config/:configId/blocks/:blockId` | — | Block detail |
| `/config/:configId/roles` | `zone`, `server` (matrix filters) | Deployment Roles |
| `/config/:configId/options` | `scope`, `q` | Deployment Options |
| `/config/:configId/servers` | `lab`, `status` | Servers & Interfaces |
| `/config/:configId/servers/:serverId` | `tab=overview\|services\|roles\|config-review\|history` | Server Detail (tabbed) |
| `/config/:configId/config-review` | `server`, `tab=deployed\|pending`, `q` | Config Review (cross-server) |
| `/config/:configId/review-deploy` | `diff=unified\|split` | Review & Deploy |
| `/config/:configId/history` | `page`, `size`, `outcome` | Deployment History |
| `/config/:configId/backups` | `scope`, `trigger` | Snapshot list |
| `/config/:configId/backups/:snapshotId` | `restorePreview=1` | Snapshot detail / restore preview |
| `/config/:configId/backups/adopt` | `step=upload\|review` | Import-from-server (adopt) flow |

## URL state vs. component state

**In the URL:** active `configId`, active `viewId` (as a query param on view-scoped routes), all list
filters/sort/pagination, the open record/snapshot id (so an edit panel is a shareable/refreshable
link), the active Server Detail tab, diff view mode (unified/split) on Review & Deploy.

**Component state only:** panel/modal open-transition animation state, in-progress form field values
before submit, multi-row selection for bulk actions, command-palette query text, hover/focus, toast
queue, live deploy-progress ticks (poll results are pushed into a store keyed by job id, not the URL).

**Note on `/configurations/new`:** implemented as a modal over `/configurations`, not a route push —
listed above only to document the template query contract if a future deep link to a specific
template is wanted.

## Addendum 2 additions

Container-object detail routes now carry `?tab=` per `DESIGN.md` §6. Deployment Roles/Options are the
same tab everywhere — the `scope` query param is what the shared editor reads to pre-apply its locked
filter chip.

| Route | Params | Screen |
|---|---|---|
| `/config/:configId/zones/:zoneId?tab=records\|roles\|options\|settings\|history` | `type,status,q,page,size,sort,recordId` (records tab only) | Zone detail (tabbed) |
| `/config/:configId/views/:viewId?tab=zones\|roles\|options\|settings\|history` | — | View detail (tabbed) |
| `/config/:configId/blocks/:blockId?tab=blocks\|roles\|options\|settings\|history` | — | Block detail (tabbed) |
| `/config/:configId/servers/:serverId?tab=overview\|services\|roles\|config-review\|history` | — | Server detail (tabbed, unchanged shape) |
| `/config/:configId/groups` | `q` | Server Groups list |
| `/config/:configId/groups/:groupId?tab=members\|roles\|options\|settings\|history` | — | Server Group detail (tabbed) |
| `/config/:configId/roles` | `zone,server,group` (rollup filters) | Global Deployment Roles rollup (read-only + jump-to-source) |
| `/config/:configId/options` | `scope,q` | Global Deployment Options rollup (read-only + jump-to-source) |
| `/config/:configId/acls` | `q` | ACL list |
| `/config/:configId/acls/:aclId` | — | ACL detail/editor |
| `/config/:configId/acls/evaluate` | `clientIp,aclId,server,view` | ACL evaluator — both the simple (IP vs. one ACL) and full-chain (can-this-client-query-this-view-on-this-server) modes |
| `/config/:configId/keys` | `q` | TSIG key list |
| `/config/:configId/templates` | — | Record templates |
| `/config/:configId/health` | `severity,zone,rule` | Zone health / linting findings |
| `/config/:configId/query` | `server,name,type` | Query tool (also reachable as an overlay from the command palette, zone detail, server detail, and post-deploy) |
| `/config/:configId/rpz` | — | RPZ empty-state / v2 seam |

## URL state vs. component state (addendum)

**In the URL, additionally:** the active detail tab (`tab=`) on every container object, the locked
scope filter chip on a Deployment Roles/Options mount (`scope=`), ACL evaluator inputs (so a result is
shareable/linkable), saved-filter selection (`savedFilter=:id`, expands to its stored `filterParams`).

**Component state only, additionally:** pinned/recents list (client-side, not deep-linked), density
toggle (persisted to `localStorage`, not the URL), query-tool compare-mode server selection while
mid-edit.
