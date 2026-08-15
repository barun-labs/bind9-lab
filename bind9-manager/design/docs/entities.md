# Entity / data model

Field names are the exact names the API should use (camelCase, matching JSON convention). All
timestamps are ISO 8601 UTC strings. All ids are strings (ULIDs recommended).

## Enums

- **RecordType**: `A | AAAA | CNAME | MX | TXT | SRV | NS | PTR | CAA | ALIAS`
- **ZoneType**: `PRIMARY | SECONDARY | FORWARD | STUB`
- **ServerRole**: `PRIMARY | SECONDARY | FORWARDER | STUB | RECURSIVE`
- **SyncState**: `SYNCED | PENDING | DEPLOYING | DRIFT | ERROR | NODE_ABSENT | UNREACHABLE`
- **ServerAdminState**: `ENABLED | DISABLED_IN_APP | NAMED_STOPPED | NODE_ABSENT`
- **DeployOutcome**: `SUCCEEDED | FAILED | PARTIAL | CANCELLED`
- **SnapshotTrigger**: `AUTO_PRE_DEPLOY | AUTO_PRE_DESTRUCTIVE | MANUAL | SCHEDULED`
- **SnapshotScope**: `SYSTEM | CONFIGURATION | VIEW | ZONE | SERVER`
- **ChangeSetItemAction**: `CREATE | UPDATE | DELETE | DISABLE | ENABLE`
- **LogSeverity**: `CRITICAL | ERROR | WARNING | NOTICE | INFO | DEBUG` (debug carries a level 1–99)
- **SnmpVersion**: `V2C | V3`

## Configuration
Root container. Isolated: nothing below is shared across Configurations.
| Field | Type | Req | Notes |
|---|---|---|---|
| id | string | yes | |
| name | string | yes | unique, used as the typed-delete-confirmation string |
| description | string | no | |
| isActive | boolean | yes | exactly one Configuration has `true` at a time |
| createdFromTemplateId | string | no | one of the seed template ids, or null for blank/clone |
| createdAt, updatedAt, lastDeployedAt | datetime | yes/yes/no | |
| counts | object `{views,zones,records,servers}` | yes | denormalized for the list screen |

## View
| Field | Type | Req | Notes |
|---|---|---|---|
| id, configurationId | string | yes | |
| name | string | yes | e.g. `internal` |
| order | int | yes | first-match-wins; drag-reorderable |
| matchClients | string[] | yes | ACL entries, CIDR or ACL-name |
| zoneCount | int | yes | denormalized |

## Zone
| Field | Type | Req | Notes |
|---|---|---|---|
| id, configurationId, viewId | string | yes | |
| name | string | yes | FQDN, e.g. `lab.lun.net` |
| type | ZoneType | yes | |
| soa | object `{primaryNs,adminEmail,serial,refresh,retry,expire,minimum}` | yes | ints except primaryNs/adminEmail |
| allowTransfer, allowUpdate | string[] | no | ACLs |
| dnssecStatus | `NOT_CONFIGURED` (only value in v1) | yes | placeholder per constraint C |
| recordCount | int | yes | denormalized |
| syncState | SyncState | yes | rolled up from its deployed servers |

## ResourceRecord
| Field | Type | Req | Notes |
|---|---|---|---|
| id, zoneId | string | yes | |
| name | string | yes | `@` for apex |
| type | RecordType | yes | |
| ttl | int | yes | seconds; see validation-rules.md for bounds |
| rdata | object | yes | shape depends on `type` — see below |
| disabled | boolean | yes | administratively disabled, still staged |
| syncState | SyncState | yes | |
| issue | string \| null | no | e.g. dangling-reference warning text |

`rdata` shapes: `A/AAAA → {address}` · `CNAME/NS/ALIAS → {target}` · `MX → {priority,target}` ·
`SRV → {priority,weight,port,target}` · `TXT → {text}` · `PTR → {target}` ·
`CAA → {flags,tag,value}`.

## ExternalHost
| Field | Type | Req | Notes |
|---|---|---|---|
| id, configurationId | string | yes | |
| fqdn | string | yes | |
| referenceCount | int | yes | denormalized "used by N records" |

## NetworkBlock
| Field | Type | Req | Notes |
|---|---|---|---|
| id, configurationId, parentBlockId | string | yes/yes/no | tree via parent pointer |
| cidr | string | yes | e.g. `10.20.30.0/24` |
| isOctetAligned | boolean | yes | drives RFC 2317 delegation UI |
| reverseZoneId | string \| null | no | set once generated |
| utilization | float 0–1 | yes | |

## ReverseZone
Same shape as Zone, with `blockId` added and `name` following `in-addr.arpa` / `ip6.arpa` convention.

## Server
| Field | Type | Req | Notes |
|---|---|---|---|
| id, configurationId | string | yes | |
| hostname | string | yes | DNS hostname, e.g. `bind-pri-01` |
| labName, nodeName | string | yes | containerlab lab and node name |
| mgmtAddress | string | yes | containerlab management IP — reachability transport, not a service interface |
| serviceInterfaces | object[] `{address,port}` | yes | listen-on addresses; visually distinct from mgmtAddress |
| adminState | ServerAdminState | yes | |
| syncState | SyncState | yes | |
| bindVersion, debianVersion | string | no | |
| lastDeployedAt | datetime | no | |
| services | ServerServices | no | see below |

## ServerServices (nested under Server)
- `dns: {listenOn:[{address,port}], recursion:boolean, allowQuery, allowRecursion, allowTransfer, forwarders:[], forwardPolicy:'first'|'only', dnssecValidation:boolean, maxCacheSize, ednsBufferSize, rrl:{responsesPerSecond,window}, statisticsChannels:[{address,port}]}` — each field may be `{value, inheritedFrom: ScopeRef|null}`.
- `logging: {channels:[{name,destination:'file'|'syslog'|'stderr'|'null',severity,level?,path?,versions?,size?,printTime?,printCategory?,printSeverity?}], categoryMap:[{category,channelNames:string[]}], queryLoggingEnabled:boolean}`
- `syslog: {enabled,host,port,protocol:'UDP'|'TCP'|'TLS',facility,minSeverity,tag}`
- `snmp: {version:SnmpVersion, v2c:{community,allowedManagers:string[]}, v3:{user,authProtocol,authPassphrase,privProtocol,privPassphrase}, sysLocation,sysContact,trapDestinations:string[]}` — passphrase fields are write-only from the API's perspective; GET responses return `"<redacted>"`.

## DeploymentRole
`{id, configurationId, serverId, zoneId, role: ServerRole}` — one row per server×zone cell with a role.

## DeploymentOption
`{id, configurationId, scopeType:'SERVER'|'VIEW'|'ZONE'|'BLOCK', scopeId, key, value, inheritedFrom: {scopeType,scopeId,value}|null}`

## ChangeSetItem
`{id, configurationId, objectType, objectId, action: ChangeSetItemAction, diff:{before,after}, createdAt, createdBy:'user'}` — the pending change set is just the open list of these.

## DeployJob
`{id, configurationId, changeSetItemIds:string[], targetServerIds:string[], status:'QUEUED'|'RUNNING'|'SUCCEEDED'|'FAILED'|'PARTIAL'|'CANCELLED', preflight:{checkconf:[{serverId,result,detail}], checkzone:[{zoneId,result,detail}]}, serverResults:[{serverId,outcome:DeployOutcome,startedAt,finishedAt,stderr?}], createdAt}`

## Snapshot
`{id, configurationId, label, trigger:SnapshotTrigger, scope:SnapshotScope, scopeRef, sizeBytes, createdAt, createdBy, containedObjectSummary:{views,zones,records,blocks,servers}, referencesMissingServers:boolean}`

---

## Addendum 2 additions

New enums: **AclEntryType**: `ADDRESS | CIDR | ACL_REF | TSIG_KEY | ANY | NONE | LOCALHOST | LOCALNETS`.
**PlacementBlock**: `OPTIONS | VIEW | ZONE` (Axis 1). **OptionScopeType** (Axis 2, extends the earlier
`DeploymentOption.scopeType`): `CONFIGURATION | SERVER_GROUP | SERVER | VIEW | ZONE`.
**HealthSeverity**: `CRITICAL | WARNING | INFO`. **DeployTargetType**: `SERVER | SERVER_GROUP | AFFECTED_BY_CHANGESET`.
**TsigAlgorithm**: `HMAC_SHA256` (default) `| HMAC_SHA1 | HMAC_MD5`.

### ServerGroup
| Field | Type | Req | Notes |
|---|---|---|---|
| id, configurationId | string | yes | |
| name | string | yes | e.g. `all-secondaries` |
| description | string | no | |
| memberServerIds | string[] | yes | a server may belong to >1 group |
| rollup | object | yes (computed) | `{healthCounts:{synced,pending,drift,error,unreachable,nodeAbsent}, bindVersions:string[], disagreement:boolean}` — `disagreement=true` when members differ on BIND version or sync state; never averaged away |

### DeploymentRole (updated)
Adds `groupId: string|null` alongside `serverId` (exactly one of the two is set). A group-level role
row exposes `expandsTo: {serverId, role, overridden:boolean}[]` — the per-member roles it produced,
with any individually-overridden member flagged.

### DeploymentOption (updated)
`scopeType` now `OptionScopeType` (adds `SERVER_GROUP`). Adds `placement: PlacementBlock` (Axis 1,
independent of `scopeType`/Axis 2) and keeps `inheritedFrom` as before but its `scopeType` also uses
the expanded enum.

### Acl
| Field | Type | Req | Notes |
|---|---|---|---|
| id, configurationId | string | yes | |
| name | string | yes | referenced as `acl "name"` |
| entries | AclEntry[] | yes | ordered, index = evaluation order |
| usedByCount | int | yes (computed) | views/zones/servers referencing it |

### AclEntry
`{id, aclId, order:int, type:AclEntryType, value:string|null (address/CIDR/ACL name/key name, null for ANY/NONE/LOCALHOST/LOCALNETS), negated:boolean}`

### TsigKey
`{id, configurationId, name, algorithm:TsigAlgorithm, secret:'<redacted>' (write-only), createdAt, rotatedAt, usedBy:{zoneTransfers:string[], ddnsZones:string[], rndc:boolean, aclEntryIds:string[]}}`

### HealthFinding
`{id, configurationId, objectType, objectId, rule:string, severity:HealthSeverity, message, mutedForObject:boolean, jumpToRoute:string, detectedAt}`

### SavedFilter
`{id, configurationId, userScope:'GLOBAL', screen:string, name, filterParams:object, createdAt}`

### PinnedObject / RecentlyViewed
`{id, objectType, objectId, pinnedAt}` · recents are a client-side ring buffer (last 10), not persisted server-side.

### RecordTemplate
`{id, configurationId, name, description, produces:[{type:RecordType, nameExpr:string, rdataExpr:string}]}` — e.g. "web host" → `[{A,'{host}','{ip}'},{PTR,'{ip}','{host}.{zone}'},{CNAME,'www.{host}','{host}.{zone}'}]`.

### QueryToolRequest / QueryToolResult
`{serverId, name, type:RecordType, flags:{norecurse,trace,dnssec,tcp}}` → `{answer:[], authority:[], additional:[], flags:[], responseTimeMs, answeredBy:serverId}`. Compare mode runs the same request against `serverIds:string[]` or a `groupId` and diffs the answer sections.

### RpzPolicy (v2 seam — entity shape reserved, no UI beyond an empty state in v1)
`{id, configurationId, name, order:int, action:'NXDOMAIN'|'REDIRECT'|'PASSTHRU', targetViewIds:string[]}`

### DnssecStatusDetail (read-only in v1)
`{zoneId, signingPolicy:string|null, keys:[{type:'KSK'|'ZSK', state, rolloverPhase}], nextSignatureExpiry:datetime|null, dsPublished:boolean}`

### StatisticsSnapshot (per server, polled from statistics-channels when enabled)
`{serverId, capturedAt, queryRate, responseCodes:{NOERROR,NXDOMAIN,SERVFAIL,REFUSED}, cacheHitRatio, recursionCount}`
