# Containerlab BIND9 Anycast DNS Lab

A multi-node containerized DNS testbed demonstrating BGP Anycast with ECMP load balancing, authoritative master/slave zone replication, split-horizon view architectures, recursive forwarding, subzone delegation, reverse in-addr.arpa lookups, and complete internet isolation.

---

## Topology Architecture

The lab connects 10 Linux containers across an ISP routing core and three shared broadcast domains:

* **Subscriber / Client (`pc`):** Represents the client endpoint generating DNS queries to the cache anycast VIP.
* **Core Router (`isp-r1`):** Multipath BGP router running FRRouting with ECMP multipath hashing across anycast backends.
* **Recursive Caches (`bc-cache1`, `bc-cache2`):** BIND9 recursive resolvers sharing Anycast VIP `172.31.31.81/32` over BGP AS 65001.
* **Authoritative Master (`bc-rmaster`):** BIND9 primary master for `lab.test`, delegated child zone `sub.lab.test`, and reverse zone `0.20.10.in-addr.arpa`.
* **Authoritative Slaves (`bc-rslave1`, `bc-rslave2`):** BIND9 secondary servers sharing Anycast VIP `172.30.30.85/32` (`ns100.lab.test`) over BGP AS 65002 with automatic AXFR synchronization.
* **External Forwarder (`ex-dns`):** Intermediate recursive forwarder used for forwarding topology experiments.
* **Lab Root (`root`):** Isolated fake root server authoritative for `.`, `test.`, `arpa.`, and `in-addr.arpa.`.
* **Comparison Authoritative (`cmp-auth`):** Independent baseline copy of authoritative zones used for automated answer-set verification.
* **Host Bridges:** Three Linux bridge devices (`br-dnscache`, `br-dnsrec`, `br-dnsext`) interconnecting the routing interfaces.

---

## Deploying from Scratch

Deploy the entire infrastructure from clean state with the following workflow:

1. **Create Host Bridges:**
   ```bash
   ./setup.sh
   ```
   Creates and brings up the three Linux bridge interfaces (`br-dnscache`, `br-dnsrec`, `br-dnsext`).

2. **Deploy Containerlab & Infrastructure:**
   ```bash
   ./deploy.sh normal
   ```
   Deploys `dns.clab.yml`, configures Management VRFs on router and anycast nodes, installs data-plane static routing tables on non-FRR nodes, and invokes `dns-deploy.sh normal`.

3. **Deploy or Switch DNS Configurations:**
   ```bash
   ./dns-deploy.sh normal
   ```
   Renders BIND configurations, zone files, root hints, pushes files to all running containers, validates configurations with `named-checkconf` and `named-checkzone`, and reloads `named`.

---

## Running Validation Suites

Three comprehensive automated test suites verify the lab end-to-end:

### 1. Full DNS Functional Test Suite (`validate.sh`)
```bash
./validate.sh
```
Executes a 15-check test suite verifying configuration syntax, AXFR serial synchronization, client resolution, CNAME chasing, TXT/SRV/AAAA/PTR lookups, delegation tracing, Anycast server identity, ECMP split distribution, answer-set equality against `cmp-auth`, anycast failover recovery, internet isolation, and the deliberate forwarding loop variant.

### 2. Full Data-Plane Reachability Matrix (`reachability.sh`)
```bash
./reachability.sh
```
Runs a complete N x N ping reachability matrix across all 10 nodes and both anycast VIPs (`172.31.31.81`, `172.30.30.85`), displaying a readable grid and asserting that a designated unreachable control destination (`172.99.99.99`) fails.

### 3. SSH Management Access Check (`ssh-check.sh`)
```bash
./ssh-check.sh
```
Tests password-authenticated SSH logins (`admin`/`clab@123`) across all 10 nodes over the management network (`10.233.4.0/24`), verifying both default and VRF-enslaved management stacks.

---

## Forwarding Variants

* **`normal`:** Production-like forwarding topology where recursive caches query master and slave resolvers cleanly.
* **`loop`:** Deliberately circular forwarding configuration engineered to demonstrate recursive forwarding loops, query timeouts, and BIND `SERVFAIL` behavior.

---

## Clean Teardown

To stop and remove all containers and clean up host bridges:

```bash
./teardown.sh
```
Runs `sudo clab destroy -t dns.clab.yml --cleanup` and deletes the Linux host bridges.
