#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOPO="${SCRIPT_DIR}/dns.clab.yml"

echo "==> Setting up host bridges..."
"${SCRIPT_DIR}/setup.sh"

echo "==> Deploying containerlab topology..."
sudo clab deploy -t "$TOPO" --reconfigure

echo "==> Configuring Management VRF and FRR on router and anycast nodes..."

setup_mgmt_vrf() {
    local node="$1"
    local container="clab-dns-${node}"

    echo "Configuring VRF mgmt on ${node}..."
    docker exec "${container}" sysctl -w net.ipv4.tcp_l3mdev_accept=1 >/dev/null
    docker exec "${container}" sysctl -w net.ipv4.udp_l3mdev_accept=1 >/dev/null

    # Create VRF mgmt if not exists
    docker exec "${container}" sh -c "ip link show mgmt >/dev/null 2>&1 || ip link add mgmt type vrf table 100"
    docker exec "${container}" ip link set mgmt up

    # Enslave eth0 to VRF mgmt
    docker exec "${container}" ip link set eth0 master mgmt

    # Restore default route in table 100 via management gateway (10.233.4.1)
    docker exec "${container}" ip route replace default via 10.233.4.1 dev eth0 table 100
}

start_frr() {
    local container="$1"
    docker exec "${container}" sh -c "if /usr/lib/frr/frrinit.sh status >/dev/null 2>&1; then /usr/lib/frr/frrinit.sh restart; else /usr/lib/frr/frrinit.sh start; fi"
}

# 1. isp-r1
setup_mgmt_vrf "isp-r1"
docker exec clab-dns-isp-r1 sysctl -w net.ipv4.ip_forward=1 >/dev/null
docker exec clab-dns-isp-r1 ip link set eth1 up
docker exec clab-dns-isp-r1 ip addr replace 172.21.21.254/24 dev eth1
docker exec clab-dns-isp-r1 ip link set eth2 up
docker exec clab-dns-isp-r1 ip addr replace 172.22.22.1/24 dev eth2
docker exec clab-dns-isp-r1 ip link set eth3 up
docker exec clab-dns-isp-r1 ip addr replace 172.23.23.1/24 dev eth3
docker exec clab-dns-isp-r1 ip link set eth4 up
docker exec clab-dns-isp-r1 ip addr replace 172.25.25.1/24 dev eth4
docker exec clab-dns-isp-r1 ip link set eth5 up
docker exec clab-dns-isp-r1 ip addr replace 172.26.26.1/24 dev eth5
start_frr "clab-dns-isp-r1"

# 2. bc-cache1
setup_mgmt_vrf "bc-cache1"
docker exec clab-dns-bc-cache1 ip link set eth1 up
docker exec clab-dns-bc-cache1 ip addr replace 172.22.22.100/24 dev eth1
docker exec clab-dns-bc-cache1 ip addr replace 172.31.31.81/32 dev lo
docker exec clab-dns-bc-cache1 ip route replace default via 172.22.22.1 dev eth1
start_frr "clab-dns-bc-cache1"

# 3. bc-cache2
setup_mgmt_vrf "bc-cache2"
docker exec clab-dns-bc-cache2 ip link set eth1 up
docker exec clab-dns-bc-cache2 ip addr replace 172.22.22.200/24 dev eth1
docker exec clab-dns-bc-cache2 ip addr replace 172.31.31.81/32 dev lo
docker exec clab-dns-bc-cache2 ip route replace default via 172.22.22.1 dev eth1
start_frr "clab-dns-bc-cache2"

# 4. bc-rslave1
setup_mgmt_vrf "bc-rslave1"
docker exec clab-dns-bc-rslave1 ip link set eth1 up
docker exec clab-dns-bc-rslave1 ip addr replace 172.23.23.129/24 dev eth1
docker exec clab-dns-bc-rslave1 ip addr replace 172.30.30.85/32 dev lo
docker exec clab-dns-bc-rslave1 ip route replace default via 172.23.23.1 dev eth1
start_frr "clab-dns-bc-rslave1"

# 5. bc-rslave2
setup_mgmt_vrf "bc-rslave2"
docker exec clab-dns-bc-rslave2 ip link set eth1 up
docker exec clab-dns-bc-rslave2 ip addr replace 172.23.23.100/24 dev eth1
docker exec clab-dns-bc-rslave2 ip addr replace 172.30.30.85/32 dev lo
docker exec clab-dns-bc-rslave2 ip route replace default via 172.23.23.1 dev eth1
start_frr "clab-dns-bc-rslave2"

echo "==> Configuring non-FRR nodes (static routes)..."

# Helper for static route nodes
setup_static_node() {
    local node="$1"
    local ip_cidr="$2"
    local local_subnet="$3"
    local gw="$4"
    local container="clab-dns-${node}"

    echo "Configuring static routes on ${node}..."
    docker exec "${container}" ip link set eth1 up
    docker exec "${container}" ip addr replace "${ip_cidr}" dev eth1

    # Lab prefixes to route via isp-r1 gateway (skip local subnet)
    local all_prefixes=(
        "172.21.21.0/24"
        "172.22.22.0/24"
        "172.23.23.0/24"
        "172.25.25.0/24"
        "172.26.26.0/24"
        "172.30.30.85/32"
        "172.31.31.81/32"
    )

    for pfx in "${all_prefixes[@]}"; do
        if [ "${pfx}" != "${local_subnet}" ]; then
            docker exec "${container}" ip route replace "${pfx}" via "${gw}" dev eth1
        fi
    done
}

# pc
setup_static_node "pc" "172.21.21.1/24" "172.21.21.0/24" "172.21.21.254"

# bc-rmaster
setup_static_node "bc-rmaster" "172.23.23.97/24" "172.23.23.0/24" "172.23.23.1"

# ex-dns
setup_static_node "ex-dns" "172.25.25.127/24" "172.25.25.0/24" "172.25.25.1"

# root
setup_static_node "root" "172.26.26.53/24" "172.26.26.0/24" "172.26.26.1"

# cmp-auth
setup_static_node "cmp-auth" "172.26.26.54/24" "172.26.26.0/24" "172.26.26.1"

echo "==> Lab deployment and configuration finished successfully!"

# Deploy BIND9 DNS layer
"${SCRIPT_DIR}/dns-deploy.sh" "${1:-loop}"
