# What Bind9-Manager Is

Bind9-Manager is a web app that manages a self-contained BIND9 DNS lab deployed with
containerlab. You declare DNS objects in a UI — views, zones, resource records, ACLs, and the
servers that host them — and the app renders those objects into real BIND configuration, validates
it, and pushes it into running lab containers.

It exists for one job: making it safe and repeatable to build a DNS topology in a lab and reason
about exactly what configuration each BIND node ends up running. Nothing here touches a production
resolver. The app only ever operates on its own lab, and it enforces that at the code level (see
[Isolation & Security](isolation-security.md)).

## Who it's for

The primary audience is someone who wants to experiment with BIND without hand-editing `named.conf`
and zone files directly. Declaring a zone in a form and reviewing the generated config as a diff is
a different workflow from writing the file by hand, and it catches mistakes earlier.

It is also a worked example of a specific architecture: a Node backend that renders BIND config from
a typed model, validates that config inside a throwaway container, and deploys it with containerlab.
If you want to see how a config-generation pipeline like this fits together, the code is the point
as much as the tool.

## The core idea

The app is declarative. You describe the DNS objects you want, not the config lines. A
**Configuration** holds a set of **Views**, **Zones**, **ResourceRecords**, **ACLs**, and
**Servers**. When you deploy, the backend assembles those objects into a `ConfigModel`, then the
config-engine renders two kinds of output from that model:

- `named.conf` and per-zone files for each BIND server.
- a containerlab topology file that describes the containers the lab runs in.

So the flow is one direction: declare objects, render config, deploy to containers, reconcile what
actually came up. The live containers are the last step, not the source of truth. The source of
truth is the object model in the database.

## The pieces

The repository is three packages plus a docs site:

- `backend/` — a Fastify server that owns the REST API, the entity store, the config-engine, and the
  deploy pipeline.
- `app/` — the React single-page app.
- `shared/` — the TypeScript types both packages import, so an entity shape is defined once.
- `docs-site/` — this documentation.

The tech stack is Node.js on the backend, running TypeScript directly through `tsx`, with Fastify 5
and better-sqlite3 for storage. The frontend is React 19 with Vite. There is no build step for the
backend — `tsx` executes the TypeScript source as-is.

## Where to go next

- [Architecture](architecture.md) — how the three packages fit together and how config gets rendered.
- [Entities & Data Model](entities.md) — the object model and how it is stored.
- [API Reference](api.md) — the REST routes.
- [Deploy & Change Sets](deploy-and-changeset.md) — the two deploy paths.
- [Isolation & Security](isolation-security.md) — why the app can't touch anything but its own lab.
- [Runbook](runbook.md) — operating the app on the lab host.
