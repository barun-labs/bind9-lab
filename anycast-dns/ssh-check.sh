#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

NODES=(
    "isp-r1"
    "bc-cache1"
    "bc-cache2"
    "bc-rmaster"
    "bc-rslave1"
    "bc-rslave2"
    "ex-dns"
    "root"
    "cmp-auth"
    "pc"
)

MGMT_IPS=(
    "10.233.4.11"
    "10.233.4.21"
    "10.233.4.22"
    "10.233.4.30"
    "10.233.4.31"
    "10.233.4.32"
    "10.233.4.41"
    "10.233.4.51"
    "10.233.4.52"
    "10.233.4.101"
)

VRF_MGMT=(
    "Yes (VRF: mgmt)"
    "Yes (VRF: mgmt)"
    "Yes (VRF: mgmt)"
    "No (default VRF)"
    "Yes (VRF: mgmt)"
    "Yes (VRF: mgmt)"
    "No (default VRF)"
    "No (default VRF)"
    "No (default VRF)"
    "No (default VRF)"
)

SSH_PASS="clab@123"
SSH_USER="admin"

PASSED=0
FAILED=0
TOTAL=${#NODES[@]}

echo "=========================================================================================="
echo "                           DNS LAB SSH MANAGEMENT ACCESS CHECK                            "
echo "=========================================================================================="
printf "%-12s | %-14s | %-18s | %-16s | %-8s\n" "Node" "Management IP" "VRF Config" "Remote Hostname" "Status"
printf "%-12s-+-%-14s-+-%-18s-+-%-16s-+-%-8s\n" "------------" "--------------" "------------------" "----------------" "--------"

for i in "${!NODES[@]}"; do
    node="${NODES[$i]}"
    ip="${MGMT_IPS[$i]}"
    vrf="${VRF_MGMT[$i]}"
    
    # Run ssh command with password and capture output
    if HOSTNAME_RESP=$(sshpass -p "${SSH_PASS}" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=5 "${SSH_USER}@${ip}" "hostname" 2>&1); then
        # Trim output
        HOSTNAME_CLEAN=$(echo "${HOSTNAME_RESP}" | tr -d '\r\n')
        if [[ "${HOSTNAME_CLEAN}" == "${node}" ]]; then
            printf "%-12s | %-14s | %-18s | %-16s | ${GREEN}%-8s${NC}\n" "$node" "$ip" "$vrf" "$HOSTNAME_CLEAN" "OK"
            PASSED=$((PASSED + 1))
        else
            printf "%-12s | %-14s | %-18s | %-16s | ${YELLOW}%-8s${NC}\n" "$node" "$ip" "$vrf" "$HOSTNAME_CLEAN" "MISMATCH"
            FAILED=$((FAILED + 1))
        fi
    else
        printf "%-12s | %-14s | %-18s | %-16s | ${RED}%-8s${NC}\n" "$node" "$ip" "$vrf" "ERR_CONNECT" "FAIL"
        FAILED=$((FAILED + 1))
    fi
done

printf "%-12s-+-%-14s-+-%-18s-+-%-16s-+-%-8s\n" "------------" "--------------" "------------------" "----------------" "--------"
echo "SSH Check Summary: ${PASSED}/${TOTAL} nodes accessible via SSH (user: ${SSH_USER})."

if [[ $FAILED -gt 0 ]]; then
    echo -e "${RED}[FAIL] SSH connectivity failed on ${FAILED} node(s).${NC}"
    exit 1
else
    echo -e "${GREEN}[PASS] All 10 lab nodes are fully accessible over SSH on management network.${NC}"
    exit 0
fi
