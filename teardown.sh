#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOPO="${SCRIPT_DIR}/dns.clab.yml"

echo "Destroying containerlab topology..."
sudo clab destroy -t "$TOPO" --cleanup

BRIDGES=("br-dnscache" "br-dnsrec" "br-dnsext")

for br in "${BRIDGES[@]}"; do
    if ip link show "$br" >/dev/null 2>&1; then
        echo "Deleting bridge $br..."
        sudo ip link del "$br"
    fi
done

echo "Teardown complete."
