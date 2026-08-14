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

TARGET_NAMES=(
    "isp-r1"
    "cache1"
    "cache2"
    "rmaster"
    "rslave1"
    "rslave2"
    "ex-dns"
    "root"
    "cmp-auth"
    "pc"
    "any-cac"
    "any-aut"
)

TARGET_IPS=(
    "172.21.21.254"
    "172.22.22.100"
    "172.22.22.200"
    "172.23.23.97"
    "172.23.23.129"
    "172.23.23.100"
    "172.25.25.127"
    "172.26.26.53"
    "172.26.26.54"
    "172.21.21.1"
    "172.31.31.81"
    "172.30.30.85"
)

TOTAL_CELLS=$((${#NODES[@]} * ${#TARGET_IPS[@]}))
PASSED_CELLS=0
FAILED_CELLS=0

echo "======================================================================================================================"
echo "                                   DNS LAB FULL DATA-PLANE REACHABILITY MATRIX                                        "
echo "======================================================================================================================"
echo ""

# Print header
printf "%-12s |" "Source \\ Target"
for tname in "${TARGET_NAMES[@]}"; do
    printf " %-7s |" "$tname"
done
echo ""

# Print separator
printf "%-12s-+" "------------"
for _ in "${TARGET_NAMES[@]}"; do
    printf "%-8s-+" "--------"
done
echo ""

# Iterate over each source node
for src in "${NODES[@]}"; do
    printf "%-12s |" "$src"
    for dst_ip in "${TARGET_IPS[@]}"; do
        if docker exec "clab-dns-${src}" ping -c 1 -W 1 "$dst_ip" >/dev/null 2>&1; then
            printf " ${GREEN}%-7s${NC} |" "OK"
            PASSED_CELLS=$((PASSED_CELLS + 1))
        else
            printf " ${RED}%-7s${NC} |" "FAIL"
            FAILED_CELLS=$((FAILED_CELLS + 1))
        fi
    done
    echo ""
done

# Print separator
printf "%-12s-+" "------------"
for _ in "${TARGET_NAMES[@]}"; do
    printf "%-8s-+" "--------"
done
echo ""

# Control Row: Ping guaranteed unreachable IP (172.99.99.99) from every node
CONTROL_IP="172.99.99.99"
CONTROL_PASS=0
CONTROL_FAIL=0

printf "%-12s |" "CTRL(99.99)"
for src in "${NODES[@]}"; do
    if docker exec "clab-dns-${src}" ping -c 1 -W 1 "$CONTROL_IP" >/dev/null 2>&1; then
        # Ping succeeded unexpectedly -> harness/routing broken!
        printf " ${RED}%-7s${NC} |" "PASS(!)"
        CONTROL_FAIL=$((CONTROL_FAIL + 1))
    else
        # Ping failed as expected
        printf " ${GREEN}%-7s${NC} |" "FAIL(ok)"
        CONTROL_PASS=$((CONTROL_PASS + 1))
    fi
done
# Fill remaining columns if any
for ((i=${#NODES[@]}; i<${#TARGET_NAMES[@]}; i++)); do
    printf " %-7s |" "-"
done
echo ""

echo "======================================================================================================================"
echo "Reachability Summary: ${PASSED_CELLS}/${TOTAL_CELLS} data-plane matrix cells passed."

if [[ $CONTROL_FAIL -gt 0 ]]; then
    echo -e "${RED}[FATAL] Control test FAILED! $CONTROL_FAIL nodes reached supposedly unreachable IP ${CONTROL_IP}.${NC}"
    echo -e "${RED}[FATAL] Test harness is broken. Exiting non-zero.${NC}"
    exit 1
else
    echo -e "${GREEN}[OK] Control test PASSED: ${CONTROL_PASS}/${#NODES[@]} nodes correctly failed to reach ${CONTROL_IP}.${NC}"
fi

if [[ $FAILED_CELLS -gt 0 ]]; then
    echo -e "${RED}[FAIL] Reachability matrix has ${FAILED_CELLS} failing cell(s).${NC}"
    exit 1
else
    echo -e "${GREEN}[PASS] Full reachability matrix is 100% GREEN.${NC}"
    exit 0
fi
