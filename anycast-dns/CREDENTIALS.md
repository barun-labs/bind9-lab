# DNS Lab Credentials and Operational Guide

This document contains complete access credentials, configuration paths, control interfaces, and network roles for all 10 nodes in the containerlab DNS lab.

---

## 1. Node Access Matrix (SSH & Docker Exec)

All nodes run SSH on port 22 reachable via their management IPs on the `dns-mgmt` network (`10.233.4.0/24`).

* **Default User:** `admin` (uid 0, root equivalent)
* **Root User:** `root`
* **Default Password (all nodes):** `clab@123`

| Node | Management IP | Data IP(s) | Anycast VIP | SSH Command | Docker Exec Command |
|---|---|---|---|---|---|
| **isp-r1** | `10.233.4.11` | `172.21.21.254`<br>`172.22.22.1`<br>`172.23.23.1`<br>`172.25.25.1`<br>`172.26.26.1` | — | `ssh admin@10.233.4.11` | `docker exec -it clab-dns-isp-r1 bash` |
| **bc-cache1** | `10.233.4.21` | `172.22.22.100` | `172.31.31.81/32` | `ssh admin@10.233.4.21` | `docker exec -it clab-dns-bc-cache1 bash` |
| **bc-cache2** | `10.233.4.22` | `172.22.22.200` | `172.31.31.81/32` | `ssh admin@10.233.4.22` | `docker exec -it clab-dns-bc-cache2 bash` |
| **bc-rmaster** | `10.233.4.30` | `172.23.23.97` | — | `ssh admin@10.233.4.30` | `docker exec -it clab-dns-bc-rmaster bash` |
| **bc-rslave1** | `10.233.4.31` | `172.23.23.129` | `172.30.30.85/32` | `ssh admin@10.233.4.31` | `docker exec -it clab-dns-bc-rslave1 bash` |
| **bc-rslave2** | `10.233.4.32` | `172.23.23.100` | `172.30.30.85/32` | `ssh admin@10.233.4.32` | `docker exec -it clab-dns-bc-rslave2 bash` |
| **ex-dns** | `10.233.4.41` | `172.25.25.127` | — | `ssh admin@10.233.4.41` | `docker exec -it clab-dns-ex-dns bash` |
| **root** | `10.233.4.51` | `172.26.26.53` | — | `ssh admin@10.233.4.51` | `docker exec -it clab-dns-root bash` |
| **cmp-auth** | `10.233.4.52` | `172.26.26.54` | — | `ssh admin@10.233.4.52` | `docker exec -it clab-dns-cmp-auth bash` |
| **pc** | `10.233.4.101` | `172.21.21.1` | — | `ssh admin@10.233.4.101` | `docker exec -it clab-dns-pc bash` |

> **Note on Management VRF:**
> Nodes `isp-r1`, `bc-cache1`, `bc-cache2`, `bc-rslave1`, and `bc-rslave2` have their management interface `eth0` bound to a Linux VRF (`mgmt`, table 100) with `tcp_l3mdev_accept=1` and `udp_l3mdev_accept=1`. SSH directly connects without special client flags.

---

## 2. BIND9 Configuration and Zone File Locations

### File Paths inside Containers
* **Main Configuration:** `/etc/bind/named.conf`
* **RNDC Key:** `/etc/bind/rndc.key`
* **Primary / Authoritative Master Zones:** `/etc/bind/zones/`
  * `db.lab.test`
  * `db.sub.lab.test`
  * `db.0.20.10.in-addr.arpa`
* **Root Hint File:** `/etc/bind/db.root` (points to lab root `172.26.26.53`)
* **Secondary / Slave Zone Storage:** `/var/bind/sec/`
* **BIND Log File:** `/var/log/named.log`

### File Paths on Host (Rendered from `dns-deploy.sh`)
Host files live under `~/lab/dns/configs/<node>/`:
* `~/lab/dns/configs/<node>/named.conf`
* `~/lab/dns/configs/<node>/db.root`
* `~/lab/dns/configs/<node>/zones/*`

---

## 3. RNDC Control

Every BIND node includes the shared key at `/etc/bind/rndc.key`.

### Example `rndc` Commands
* **Flush Cache:**
  ```bash
  docker exec clab-dns-bc-cache1 rndc flush
  ```
* **Reload Configuration and Zones:**
  ```bash
  docker exec clab-dns-bc-rmaster rndc reload
  ```
* **Check Zone Status (Authoritative View):**
  ```bash
  docker exec clab-dns-bc-rslave1 rndc zonestatus lab.test in authoritative
  docker exec clab-dns-bc-rslave1 rndc zonestatus sub.lab.test in authoritative
  docker exec clab-dns-bc-rslave1 rndc zonestatus 0.20.10.in-addr.arpa in authoritative
  ```
* **Force Zone Transfer on Slave:**
  ```bash
  docker exec clab-dns-bc-rslave1 rndc retransfer lab.test in authoritative
  ```

---

## 4. FRR and BGP Routing (`vtysh`)

The following nodes run FRRouting (BGP daemon):
* `isp-r1` (AS 65000, BGP Route Reflector / Core Router)
* `bc-cache1` (AS 65001, announces `172.31.31.81/32`)
* `bc-cache2` (AS 65001, announces `172.31.31.81/32`)
* `bc-rslave1` (AS 65002, announces `172.30.30.85/32`)
* `bc-rslave2` (AS 65002, announces `172.30.30.85/32`)

### Accessing `vtysh`
* **From Host (via docker):**
  ```bash
  docker exec -it clab-dns-isp-r1 vtysh
  ```
* **From Node Shell / SSH:**
  ```bash
  vtysh
  ```
* **Useful `vtysh` Commands:**
  ```text
  show ip bgp summary
  show ip route
  show ip route 172.31.31.81
  show ip route 172.30.30.85
  ```

---

## 5. DNS Zones and Anycast Architecture

### Anycast VIPs
* **`172.31.31.81/32` (DNS Caching Resolver VIP):**
  * Announced by `bc-cache1` and `bc-cache2` via BGP ECMP.
  * Configured as the default nameserver in `/etc/resolv.conf` on `pc`.
* **`172.30.30.85/32` (Authoritative Anycast VIP for `ns100.lab.test`):**
  * Announced by `bc-rslave1` and `bc-rslave2` via BGP ECMP.
  * Serves `lab.test`, `sub.lab.test`, and `0.20.10.in-addr.arpa` authoritatively to recursive resolvers.

### DNS Zones
* **`.` (Root Zone):** Hosted on `root` (`172.26.26.53`). Contains delegations for `test.` and `arpa.`.
* **`test.` (TLD Zone):** Hosted on `root` (`172.26.26.53`). Delegates `lab.test.` to `ns100.lab.test.` (`172.30.30.85`).
* **`arpa.` & `in-addr.arpa.` (Infrastructure Zones):** Hosted on `root` (`172.26.26.53`). Delegates `0.20.10.in-addr.arpa.` to `ns100.lab.test.` (`172.30.30.85`).
* **`lab.test.` (Primary Zone):**
  * Master on `bc-rmaster` (`172.23.23.97`).
  * Slaves on `bc-rslave1` (`172.23.23.129`) and `bc-rslave2` (`172.23.23.100`).
  * Baseline duplicate copy on `cmp-auth` (`172.26.26.54`) for automated answer-set diffing.
* **`sub.lab.test.` (Delegated Subzone):** Delegated from `lab.test.` to `ns100.lab.test.`, served on `bc-rmaster` (master), `bc-rslave1`/`bc-rslave2` (slaves), and `cmp-auth`.
* **`0.20.10.in-addr.arpa.` (Reverse Zone):** Reverse PTR records for `10.20.0.0/24` (`test1`..`test20.lab.test.`), served on `bc-rmaster` (master), `bc-rslave1`/`bc-rslave2` (slaves), and `cmp-auth`.

---

## 6. Switching Forwarding Variants

The lab supports two operational variants configured via `./dns-deploy.sh`:

### Normal Variant (`normal`)
```bash
./dns-deploy.sh normal
```
* Caches forward recursion queries directly to `bc-rmaster` and `bc-rslave1`/`bc-rslave2`.
* Clean, non-looping DNS resolution from subscriber `pc` to authoritative backends.

### Loop Variant (`loop` — Deliberately Broken)
```bash
./dns-deploy.sh loop
```
> **IMPORTANT NOTICE:**
> The `loop` variant is **DELIBERATELY BROKEN**. It is engineered to create a cyclic forwarding dependency between `bc-cache1/2`, `bc-rmaster`, `bc-rslave1/2`, and `ex-dns`.
>
> In this variant, queries for `www.lab.test` bounce between recursive forwarders until BIND times out and returns `SERVFAIL`. This exists intentionally so operators can inspect forwarding loops, timeout mechanisms, and lame server log messages (`timed out`, `non-improving referral`, `FORMERR`). It is **NOT** a defect.
