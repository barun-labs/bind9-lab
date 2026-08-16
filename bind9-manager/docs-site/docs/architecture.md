# Architecture

Bind9-Manager is a single-process web app: one Fastify server owns the HTTP API, the object store,
and the config renderer. The frontend is a separate build that the same server serves as static
files. There is no second service to run and no message queue between pieces.

## The three packages

The repository is split into `backend/`, `app/`, and `shared/`.

`shared/` holds the TypeScript types both sides agree on. Entities like `Configuration`, `View`,
`Zone`, `ResourceRecord`, `Acl`, and the change-set types live here, along with the RBAC helper
`can()`. Defining them once is what keeps the backend's JSON responses and the frontend's
expectations from drifting apart.

`backend/` is the whole server. It contains the REST routes (`server/app.ts`), the entity store
(`server/entityStore.ts`), the deploy and change-set engines (`server/deployEngine.ts`,
`server/changeSetDeploy.ts`), and the config-engine (`config-engine/`). It also owns the lab
store and the authorization model.

`app/` is the React single-page app. It talks only to `/api/v1/*` and enforces login on the client.
It builds to `app/dist`, which the backend serves.

## The config-engine

The config-engine is where declared DNS objects become BIND files. It has three responsibilities:

- **Render** `named.conf` and zone files. `generateNamedConf.ts` walks the views and zones for a
  server and emits `options`, `logging`, `controls`, and one `view`/`zone` block per object.
  `renderZoneFile.ts` emits the `$TTL`, `$ORIGIN`, and SOA header plus one line per enabled record.
- **Validate** the rendered files. `validate.ts` writes the generated files into a temporary
  directory, then runs `named-checkconf` and `named-checkzone` inside a throwaway Docker container
  (`dnsnode:1.0`). Validation never touches the lab containers.
- **Render the topology**. `topology.ts` turns the stored `TopologyModel` into a containerlab YAML
  document, and `rootHints.ts` generates the `db.root` hint file that points recursives at the lab's
  own root server instead of the real internet.

`index.ts` ties these together with `generateServerConfig(model, serverId)`, which returns the full
file set for one server: `named.conf`, one `zones/db.<name>` file per primary zone, and `db.root`
when the server needs root hints.

Option resolution follows a nearest-wins precedence: a value set on a zone overrides the view, which
overrides the server, which overrides the server group, which overrides the configuration. The
`resolveOption` function in `resolve.ts` implements that order.

## One port, three things

A single Fastify instance serves everything. `run.sh` starts it on port 8080:

- `/api/v1/*` — the REST API, protected by a Bearer-token hook.
- `/` — the built SPA from `app/dist`, with a fallback to `index.html` so client-side routes work on
  a hard refresh.
- `/docs` — the built Zensical documentation from `docs-site/site`, mounted when the directory is
  present.

The auth hook in `app.ts` only applies to paths starting with `/api/`. Static assets and SPA routes
never require a token; the React app itself decides when to show the login screen. The docs mount
lives in `static.ts` alongside the SPA mount.

## Where it runs

The app is deployed to a host called `clab-mini`. A systemd unit, `bind9-manager.service`, runs it
on port 8080 as user `lun`. The backend runs from source — the unit invokes `npx tsx
src/server/index.ts`, so there is no compiled backend artifact. The frontend is the only thing built
ahead of time.

## Data flow

One edit moves through the system like this:

```
UI edit → entity store (sqlite) → buildConfigModel → config-engine render → deploy
```

The UI calls a `/api/v1` route. The route writes or updates an object in the entity store, which is
a better-sqlite3 database. When config is needed — for a diff, a validation, or a deploy — the
backend calls `buildConfigModel(db, configId)`, which assembles the configuration, views, zones,
records, servers, ACLs, and external hosts into a single `ConfigModel`. The config-engine renders
that model into BIND files, and the deploy engine pushes them into the lab containers. The database
is the source of truth at every step; containers are only ever receivers.
