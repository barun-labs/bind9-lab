# Test lab: exercise DeploymentRoles + DeploymentOptions end-to-end

Goal: prove Bind9-Manager can set deployment roles + options on an object model and DEPLOY working
BIND servers via containerlab. A 5-node lab, fresh IP scheme, deployed through the slice-1..4 engine.

## Topology `bind9mgr-testlab` (IP scheme 10.60.0.0/16, distinct from the anycast lab)
- `router`  linux, ip_forward=1. eth1 10.60.1.1/24 (seg-A), eth2 10.60.2.1/24 (seg-B).
- seg-A 10.60.1.0/24: `cache` 10.60.1.10, `recursive` 10.60.1.20
- seg-B 10.60.2.0/24: `root` 10.60.2.53, `auth` 10.60.2.30
- Every DNS node default-routes via the router's IP on its segment.

## Roles (DeploymentRole) — the thing under test
- `auth`      PRIMARY for zone `test`  (records: SOA/NS, `ns.test A 10.60.2.30`, `www.test A 10.99.0.1`)
- `root`      PRIMARY for `.`          (root zone: SOA/NS, delegation `test. NS ns.test.` + glue `ns.test. A 10.60.2.30`)
- `recursive` RECURSIVE               (recursion yes; root-hints db.root -> root 10.60.2.53; no forwarders)
- `cache`     FORWARDER               (forward only; forwarders {10.60.1.20})

## Options (DeploymentOption) — also under test
- cache:     recursion=yes, forward=only, forwarders=[10.60.1.20]
- recursive: recursion=yes, dnssec-validation=no
- auth:      recursion=no
- root:      recursion=no

## Engine gaps a multi-node deploy reveals (fill these, with tests)
1. **Data-plane provisioning:** the deploy engine writes named.conf + starts named but does NOT assign
   data-plane IPs / routes. Add it: from the topology's node interface addressing, `docker exec` each
   node to `ip addr add`/`ip link set up` its data interfaces and add a default route via the router;
   enable `ip_forward` on the router. (Mirror what anycast-dns/deploy.sh does.)
2. **Root-hints generation:** a RECURSIVE node needs a `db.root` hints file pointing at the model's
   root server. generateServerConfig currently writes named.conf + PRIMARY zone files only. Generate a
   `db.root` for recursive/cache nodes listing the root server (the way anycast-dns/configs/*/db.root does).

## Verify (the real proof)
- `dig @127.0.0.1 www.test` on `cache` -> `10.99.0.1` (full chain cache->recursive->root->auth).
- role/option behavior: recursion refused on `auth`/`root`; `dig +trace`-style path root->auth.
- named-checkconf clean on all 4 BIND nodes.
Lab kept running (distinct name) for inspection; production `dns` lab untouched.
