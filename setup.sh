#!/usr/bin/env bash
set -euo pipefail

BRIDGES=("br-dnscache" "br-dnsrec" "br-dnsext")

for br in "${BRIDGES[@]}"; do
    if ! ip link show "$br" >/dev/null 2>&1; then
        echo "Creating bridge $br..."
        sudo ip link add "$br" type bridge
    fi
    sudo ip link set "$br" up
done

echo "Host bridges are ready:"
ip -br link show type bridge
