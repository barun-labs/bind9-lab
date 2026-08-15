# Bind9 Manager

## Run it

```
./run.sh
```

This builds the React frontend (`app/dist`) and starts the Fastify backend
on port 8080, serving both the JSON API (`/api/v1/*`) and the built app
from the same process.

Open http://localhost:8080 and log in with:

- username: `admin`
- password: `admin`

The admin password is set on first run and can be overridden by setting
`BIND9_ADMIN_PW` before starting the backend (e.g.
`BIND9_ADMIN_PW=secret ./run.sh`). The port can be changed with `PORT`
(e.g. `PORT=9000 ./run.sh`).
