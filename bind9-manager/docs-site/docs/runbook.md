# Runbook

Operations for the deployed instance on `clab-mini`. The app runs there as a systemd unit,
`bind9-manager.service`, on port 8080 as user `lun`. The backend runs from source through `tsx` —
there is no compiled backend to ship.

## Deploying an update

The app directory on `clab-mini` is a synced copy, not a git checkout. You build locally and copy
the pieces over with `rsync`. Four things travel:

- `backend/src/` — the backend source.
- `shared/` — the shared types package the backend imports.
- `app/dist/` — the built frontend.
- `docs-site/site/` — the built docs.

First build the frontend with the API base pointed at the same origin:

```bash
cd app
VITE_API_BASE=/api npm run build
```

Then sync everything up and restart the service:

```bash
rsync -avz backend/src/ shared/ app/dist/ docs-site/site/ \
  clab-mini:/home/lun/bind9-manager/
ssh clab-mini sudo systemctl restart bind9-manager.service
```

Confirm it came up clean:

```bash
ssh clab-mini systemctl is-active bind9-manager.service
```

`active` means the unit started. The service listens on `127.0.0.1:8080` (or the configured port),
which is where the API, the SPA, and `/docs` are all served.

## Credentials and config

Credentials and environment-specific config are read from local files on `clab-mini`, never
committed to the repository. The admin password, for example, comes from the environment
(`BIND9_ADMIN_PW`) when the database is first seeded — if it is unset, the seeder falls back to a
built-in default and logs a warning telling you to set it for any real deployment. Treat that
default as a placeholder: set the environment variable before first boot if the database has not
been created yet.

## Troubleshooting

**The service isn't active.** Check the journal:

```bash
ssh clab-mini journalctl -u bind9-manager.service -n 100 --no-pager
```

The most common causes are a missing frontend build (`app/dist` absent) or a backend import error
after a partial sync.

**Every `/api` call returns 401.** The Bearer token is missing or expired. Log in again at
`POST /api/v1/sessions` and use the returned session token, or regenerate an API key. If a script
using an API key suddenly starts failing, check the key's `expiresAt` and scopes.

**Deploy fails with `NOT_A_DNS_LAB`.** The target lab has no `intent: 'bind'` node. The app only
manages DNS labs; it will not deploy anything else.

**Deploy fails with `PREFLIGHT_FAILED` or `PREFLIGHT_WARNING_UNACK`.** The rendered BIND config
failed `named-checkconf`/`named-checkzone` (FAIL blocks outright), or produced a warning that needs
an explicit acknowledgment (`warningAck: true` on the deploy request). Read the job's `preflight`
detail to see the exact checker output.

**A server is stuck `NODE_ABSENT` or `UNREACHABLE`.** The node is either not running in containerlab
or up but not answering. `POST /api/v1/labs/:id/sync` re-inspects runtime state without redeploying;
redeploying the lab brings nodes back and lets the next health check re-evaluate state.
