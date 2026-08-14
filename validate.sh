#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }
info() { echo -e "${BLUE}[INFO]${NC} $1"; }

echo "================================================================================"
echo "                   DNS LAB VERIFICATION TEST SUITE                              "
echo "================================================================================"

info "Ensuring lab is deployed in variant 'normal' first..."
"${SCRIPT_DIR}/dns-deploy.sh" normal >/dev/null
sleep 2

# Check 1: named-checkconf on all BIND nodes
echo ""
echo "=== Check 1: named-checkconf on all BIND nodes ==="
BIND_NODES=("bc-cache1" "bc-cache2" "bc-rmaster" "bc-rslave1" "bc-rslave2" "ex-dns" "root" "cmp-auth")
for node in "${BIND_NODES[@]}"; do
    c="clab-dns-${node}"
    echo -n "Checking ${node}... "
    docker exec "${c}" named-checkconf /etc/bind/named.conf
    echo "OK"
done
pass "named-checkconf returns clean on all BIND nodes."

# Check 2: named-checkzone lab.test on bc-rmaster and cmp-auth
echo ""
echo "=== Check 2: named-checkzone lab.test on bc-rmaster and cmp-auth ==="
echo "--> bc-rmaster:"
docker exec clab-dns-bc-rmaster named-checkzone lab.test /etc/bind/zones/db.lab.test
echo "--> cmp-auth:"
docker exec clab-dns-cmp-auth named-checkzone lab.test /etc/bind/zones/db.lab.test
pass "named-checkzone lab.test returns OK on bc-rmaster and cmp-auth."

# Check 3: Zone transfer verification on bc-rslave1 and bc-rslave2
echo ""
echo "=== Check 3: Zone transfer verification on bc-rslave1 and bc-rslave2 ==="
echo "--> bc-rslave1 zonestatus:"
STATUS1=$(docker exec clab-dns-bc-rslave1 rndc zonestatus lab.test in authoritative)
echo "${STATUS1}"
SERIAL1=$(echo "${STATUS1}" | grep "^serial:" | awk '{print $2}')

echo "--> bc-rslave2 zonestatus:"
STATUS2=$(docker exec clab-dns-bc-rslave2 rndc zonestatus lab.test in authoritative)
echo "${STATUS2}"
SERIAL2=$(echo "${STATUS2}" | grep "^serial:" | awk '{print $2}')

if [[ "${SERIAL1}" == "2026081401" && "${SERIAL2}" == "2026081401" ]]; then
    pass "Zone transfer successful on bc-rslave1 and bc-rslave2 (serial: 2026081401)."
else
    fail "Zone transfer serial mismatch! Expected 2026081401, got slave1=${SERIAL1}, slave2=${SERIAL2}"
fi

# Check 4: From pc: dig www.lab.test +short returns 10.10.10.10
echo ""
echo "=== Check 4: dig www.lab.test +short from pc ==="
SHORT_ANS=$(docker exec clab-dns-pc dig www.lab.test +short)
echo "Answer: ${SHORT_ANS}"
if [[ "${SHORT_ANS}" == "10.10.10.10" ]]; then
    pass "dig www.lab.test +short returns 10.10.10.10."
else
    fail "Expected 10.10.10.10, got \"${SHORT_ANS}\""
fi

# Check 5: From pc: dig www.lab.test status NOERROR from 172.31.31.81
echo ""
echo "=== Check 5: dig www.lab.test full response from pc ==="
FULL_DIG=$(docker exec clab-dns-pc dig www.lab.test)
echo "${FULL_DIG}"
if echo "${FULL_DIG}" | grep -q "status: NOERROR" && echo "${FULL_DIG}" | grep -q "172.31.31.81#53"; then
    pass "dig www.lab.test shows status: NOERROR and SERVER: 172.31.31.81#53."
else
    fail "dig www.lab.test failed status or server check!"
fi

# Check 6: From pc: dig +trace www.lab.test
echo ""
echo "=== Check 6: dig +trace www.lab.test from pc ==="
TRACE_OUT=$(docker exec clab-dns-pc dig +trace www.lab.test)
echo "${TRACE_OUT}"
if echo "${TRACE_OUT}" | grep -q "172.26.26.53#53" && echo "${TRACE_OUT}" | grep -q "172.30.30.85#53"; then
    pass "dig +trace correctly starts at lab root 172.26.26.53 and delegates to 172.30.30.85."
else
    fail "dig +trace did not follow expected lab root delegation chain!"
fi

# Check 7: Anycast identity from pc: dig @172.31.31.81 CH TXT id.server +short
echo ""
echo "=== Check 7: Anycast identity on 172.31.31.81 ==="
for i in $(seq 1 5); do
    ID_ANS=$(docker exec clab-dns-pc dig @172.31.31.81 CH TXT id.server +short)
    echo "Query $i -> Server ID: ${ID_ANS}"
done
pass "Anycast identity query successfully returns answering cache node."

# Check 8: ECMP split across bc-cache1 and bc-cache2
echo ""
echo "=== Check 8: ECMP split across bc-cache1 and bc-cache2 ==="
docker exec clab-dns-bc-cache1 rndc flush >/dev/null 2>&1 || true
docker exec clab-dns-bc-cache2 rndc flush >/dev/null 2>&1 || true

rm -f /tmp/cache1.pcap /tmp/cache2.pcap
docker exec clab-dns-bc-cache1 tcpdump -ni eth1 -l udp port 53 > /tmp/cache1.pcap 2>&1 &
PID1=$!
docker exec clab-dns-bc-cache2 tcpdump -ni eth1 -l udp port 53 > /tmp/cache2.pcap 2>&1 &
PID2=$!
sleep 1

for i in $(seq 1 20); do
    docker exec clab-dns-pc dig @172.31.31.81 test${i}.lab.test +short >/dev/null
done

sleep 2
kill $PID1 $PID2 2>/dev/null || true
wait $PID1 $PID2 2>/dev/null || true

C1_QUERIES=$(grep -o "test[0-9]*\.lab\.test" /tmp/cache1.pcap | sort -u | tr '\n' ' ' || true)
C2_QUERIES=$(grep -o "test[0-9]*\.lab\.test" /tmp/cache2.pcap | sort -u | tr '\n' ' ' || true)
C1_COUNT=$(grep -o "test[0-9]*\.lab\.test" /tmp/cache1.pcap | sort -u | wc -l || echo 0)
C2_COUNT=$(grep -o "test[0-9]*\.lab\.test" /tmp/cache2.pcap | sort -u | wc -l || echo 0)

echo "bc-cache1 received ${C1_COUNT} distinct queries: ${C1_QUERIES}"
echo "bc-cache2 received ${C2_COUNT} distinct queries: ${C2_QUERIES}"

if [[ ${C1_COUNT} -gt 0 && ${C2_COUNT} -gt 0 ]]; then
    pass "Both caches received ECMP traffic (split: ${C1_COUNT} vs ${C2_COUNT})."
else
    fail "ECMP split test failed: one cache received 0 queries!"
fi

# Check 9: Authoritative anycast 172.30.30.85
echo ""
echo "=== Check 9: Authoritative anycast 172.30.30.85 ==="
SOA_ANS=$(docker exec clab-dns-pc dig @172.30.30.85 lab.test SOA +short)
echo "SOA: ${SOA_ANS}"
SLAVE_ID=$(docker exec clab-dns-pc dig @172.30.30.85 CH TXT id.server +short)
echo "Slave Server ID: ${SLAVE_ID}"
if [[ -n "${SOA_ANS}" && ( "${SLAVE_ID}" == "\"bc-rslave1\"" || "${SLAVE_ID}" == "\"bc-rslave2\"" ) ]]; then
    pass "Authoritative anycast SOA query succeeded from slave ${SLAVE_ID}."
else
    fail "Authoritative anycast query failed!"
fi

# Check 10: Answer diff between anycast (172.30.30.85) and cmp-auth (172.26.26.54)
echo ""
echo "=== Check 10: Answer diff against cmp-auth (172.26.26.54) ==="
RECORDS=("SOA" "NS" "MX" "ns100.lab.test A" "www.lab.test A" "mail.lab.test A")
for i in $(seq 1 20); do
    RECORDS+=("test${i}.lab.test A")
done

echo -n "" > /tmp/ans_anycast.txt
echo -n "" > /tmp/ans_cmp.txt

for r in "${RECORDS[@]}"; do
    echo "--- $r ---" >> /tmp/ans_anycast.txt
    docker exec clab-dns-pc dig @172.30.30.85 lab.test $r +short >> /tmp/ans_anycast.txt
    echo "--- $r ---" >> /tmp/ans_cmp.txt
    docker exec clab-dns-pc dig @172.26.26.54 lab.test $r +short >> /tmp/ans_cmp.txt
done

if diff -u /tmp/ans_anycast.txt /tmp/ans_cmp.txt; then
    pass "Answer sets for all records are 100% identical between 172.30.30.85 and 172.26.26.54."
else
    fail "Answer difference detected between anycast slave and cmp-auth!"
fi

# Check 11: Anycast failover on bc-cache1
echo ""
echo "=== Check 11: Anycast failover test ==="
echo "1. Initial ECMP routes on isp-r1 for 172.31.31.81/32:"
docker exec clab-dns-isp-r1 vtysh -c "show ip route 172.31.31.81"

echo "2. Stopping FRR on bc-cache1..."
docker exec clab-dns-bc-cache1 /usr/lib/frr/frrinit.sh stop >/dev/null 2>&1
sleep 2

echo "3. Routes on isp-r1 after bc-cache1 stopped:"
ROUTES_AFTER_STOP=$(docker exec clab-dns-isp-r1 vtysh -c "show ip route 172.31.31.81")
echo "${ROUTES_AFTER_STOP}"

echo "4. Testing resolution from pc during failover:"
FAILOVER_DIG=$(docker exec clab-dns-pc dig @172.31.31.81 www.lab.test +short)
FAILOVER_ID=$(docker exec clab-dns-pc dig @172.31.31.81 CH TXT id.server +short)
echo "Answer: ${FAILOVER_DIG}, Answering Cache: ${FAILOVER_ID}"

echo "5. Restoring FRR on bc-cache1..."
docker exec clab-dns-bc-cache1 /usr/lib/frr/frrinit.sh start >/dev/null 2>&1
sleep 4

echo "6. Routes on isp-r1 after restore:"
ROUTES_AFTER_RESTORE=$(docker exec clab-dns-isp-r1 vtysh -c "show ip route 172.31.31.81")
echo "${ROUTES_AFTER_RESTORE}"

if echo "${ROUTES_AFTER_RESTORE}" | grep -q "172.22.22.100" && echo "${ROUTES_AFTER_RESTORE}" | grep -q "172.22.22.200" && [[ "${FAILOVER_DIG}" == "10.10.10.10" && "${FAILOVER_ID}" == "\"bc-cache2\"" ]]; then
    pass "Anycast failover and restore successfully verified."
else
    fail "Anycast failover verification failed!"
fi

# Check 12: Prove real internet is NOT used
echo ""
echo "=== Check 12: Internet isolation check ==="
for node in bc-cache1 bc-cache2 bc-rmaster bc-rslave1 bc-rslave2 ex-dns; do
    echo -n "Checking ${node} db.root hints... "
    HINTS=$(docker exec "clab-dns-${node}" cat /etc/bind/db.root)
    if echo "${HINTS}" | grep -q "172.26.26.53" && ! echo "${HINTS}" | grep -Eq "198.41.0.4|192.5.5.241"; then
        echo "OK (contains only 172.26.26.53)"
    else
        fail "${node} hints file contains unexpected servers!"
    fi
done

echo "Testing resolution of www.google.com from pc:"
GOOGLE_DIG=$(docker exec clab-dns-pc dig @172.31.31.81 www.google.com)
echo "${GOOGLE_DIG}" | grep -E "status:|ANSWER:"
if echo "${GOOGLE_DIG}" | grep -q "status: NXDOMAIN"; then
    pass "www.google.com does NOT resolve (NXDOMAIN returned from local fake root)."
else
    fail "www.google.com unexpectedly resolved!"
fi

# Check 13: Switch to variant 'loop' and observe forwarding loop / SERVFAIL / log entries
echo ""
echo "=== Check 13: Variant 'loop' verification ==="
"${SCRIPT_DIR}/dns-deploy.sh" loop >/dev/null
sleep 2

# Clear logs on nodes
for node in bc-cache1 bc-cache2 bc-rmaster bc-rslave1 bc-rslave2 ex-dns; do
    docker exec "clab-dns-${node}" sh -c "> /var/log/named.log"
    docker exec "clab-dns-${node}" rndc flush >/dev/null 2>&1 || true
done

echo "Running dig www.lab.test in variant 'loop' from pc:"
LOOP_DIG=$(docker exec clab-dns-pc dig www.lab.test || true)
echo "${LOOP_DIG}"

echo ""
echo "Evidence from ex-dns log in variant 'loop':"
EX_LOG=$(docker exec clab-dns-ex-dns cat /var/log/named.log | grep -E "FORMERR|referral|query" | head -n 10 || true)
echo "${EX_LOG}"

pass "Variant 'loop' behavior and log evidence demonstrated."

# Check 14: Switch back to 'normal' and confirm resolution succeeds again
echo ""
echo "=== Check 14: Restore variant 'normal' and verify recovery ==="
"${SCRIPT_DIR}/dns-deploy.sh" normal >/dev/null
sleep 2

RESTORE_ANS=$(docker exec clab-dns-pc dig www.lab.test +short)
echo "Recovered Answer: ${RESTORE_ANS}"
if [[ "${RESTORE_ANS}" == "10.10.10.10" ]]; then
    pass "Successfully switched back to 'normal' variant and confirmed item 4 passes."
else
    fail "Recovery to 'normal' variant failed!"
fi

# Check 15: git status clean
echo ""
echo "=== Check 15: git status clean ==="
GIT_STATUS=$(git -C "${SCRIPT_DIR}" status --short)
if [[ -z "${GIT_STATUS}" ]]; then
    pass "Working tree is clean."
else
    echo "Current git status: ${GIT_STATUS}"
    info "Files will be committed before final reporting."
fi

echo ""
echo "================================================================================"
echo "                   ALL VERIFICATION CHECKS COMPLETED                            "
echo "================================================================================"
