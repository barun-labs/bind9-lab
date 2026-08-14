#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VARIANT="${1:-${VARIANT:-normal}}"

if [[ "$VARIANT" != "loop" && "$VARIANT" != "normal" ]]; then
    echo "ERROR: Unknown variant \"$VARIANT\". Supported variants are \"loop\" and \"normal\"." >&2
    exit 1
fi

echo "=========================================================="
echo "==> Deploying BIND9 DNS configurations (variant: ${VARIANT})"
echo "=========================================================="

# Create directory structures
mkdir -p "${SCRIPT_DIR}/configs/bc-cache1" \
         "${SCRIPT_DIR}/configs/bc-cache2" \
         "${SCRIPT_DIR}/configs/bc-rmaster/zones" \
         "${SCRIPT_DIR}/configs/bc-rslave1" \
         "${SCRIPT_DIR}/configs/bc-rslave2" \
         "${SCRIPT_DIR}/configs/ex-dns" \
         "${SCRIPT_DIR}/configs/root/zones" \
         "${SCRIPT_DIR}/configs/cmp-auth/zones"

# 1. db.root hint file for all recursive nodes (pointing ONLY to 172.26.26.53)
cat << 'ROOT_HINT_EOF' > "${SCRIPT_DIR}/configs/bc-cache1/db.root"
.                        3600000      IN      NS    ns.root.
ns.root.                 3600000      IN      A     172.26.26.53
ROOT_HINT_EOF

cp "${SCRIPT_DIR}/configs/bc-cache1/db.root" "${SCRIPT_DIR}/configs/bc-cache2/db.root"
cp "${SCRIPT_DIR}/configs/bc-cache1/db.root" "${SCRIPT_DIR}/configs/bc-rmaster/db.root"
cp "${SCRIPT_DIR}/configs/bc-cache1/db.root" "${SCRIPT_DIR}/configs/bc-rslave1/db.root"
cp "${SCRIPT_DIR}/configs/bc-cache1/db.root" "${SCRIPT_DIR}/configs/bc-rslave2/db.root"
cp "${SCRIPT_DIR}/configs/bc-cache1/db.root" "${SCRIPT_DIR}/configs/ex-dns/db.root"

# 2. Root zone files (on root node 172.26.26.53)
cat << 'ROOT_ZONE_EOF' > "${SCRIPT_DIR}/configs/root/zones/db.root"
$TTL 86400
@   IN  SOA ns.root. hostmaster.root. (
        2026081401 ; serial
        3600       ; refresh
        1800       ; retry
        604800     ; expire
        86400 )    ; minimum
    IN  NS  ns.root.
ns.root. IN A  172.26.26.53

; Delegation of test.
test. IN NS ns.root.
ROOT_ZONE_EOF

cat << 'TEST_ZONE_EOF' > "${SCRIPT_DIR}/configs/root/zones/db.test"
$TTL 86400
$ORIGIN test.
@   IN  SOA ns.root. hostmaster.test. (
        2026081401 ; serial
        3600       ; refresh
        1800       ; retry
        604800     ; expire
        86400 )    ; minimum
    IN  NS  ns.root.

; Delegation of lab.test.
lab.test.       IN  NS  ns100.lab.test.
ns100.lab.test. IN  A   172.30.30.85
TEST_ZONE_EOF

# 3. Zone lab.test (on bc-rmaster and cmp-auth)
cat << 'LAB_TEST_EOF' > "${SCRIPT_DIR}/configs/bc-rmaster/zones/db.lab.test"
$TTL 86400
$ORIGIN lab.test.
@   IN  SOA ns100.lab.test. hostmaster.lab.test. (
        2026081401 ; serial
        3600       ; refresh
        1800       ; retry
        604800     ; expire
        86400 )    ; minimum
    IN  NS  ns100.lab.test.
    IN  MX  10 mail.lab.test.

ns100   IN  A   172.30.30.85
www     IN  A   10.10.10.10
mail    IN  A   10.10.10.20

test1   IN  A   10.20.0.1
test2   IN  A   10.20.0.2
test3   IN  A   10.20.0.3
test4   IN  A   10.20.0.4
test5   IN  A   10.20.0.5
test6   IN  A   10.20.0.6
test7   IN  A   10.20.0.7
test8   IN  A   10.20.0.8
test9   IN  A   10.20.0.9
test10  IN  A   10.20.0.10
test11  IN  A   10.20.0.11
test12  IN  A   10.20.0.12
test13  IN  A   10.20.0.13
test14  IN  A   10.20.0.14
test15  IN  A   10.20.0.15
test16  IN  A   10.20.0.16
test17  IN  A   10.20.0.17
test18  IN  A   10.20.0.18
test19  IN  A   10.20.0.19
test20  IN  A   10.20.0.20
LAB_TEST_EOF

cp "${SCRIPT_DIR}/configs/bc-rmaster/zones/db.lab.test" "${SCRIPT_DIR}/configs/cmp-auth/zones/db.lab.test"

# 4. Root named.conf
cat << 'ROOT_CONF_EOF' > "${SCRIPT_DIR}/configs/root/named.conf"
options {
    directory "/var/bind";
    listen-on { any; };
    listen-on-v6 { none; };
    allow-query { any; };
    recursion no;
    dnssec-validation no;
};

logging {
    channel default_log {
        file "/var/log/named.log" versions 3 size 5m;
        severity info;
        print-time yes;
        print-severity yes;
        print-category yes;
    };
    category default { default_log; };
    category queries { default_log; };
};

include "/etc/bind/rndc.key";
controls {
    inet 127.0.0.1 allow { localhost; } keys { "rndc-key"; };
};

zone "." {
    type master;
    file "/etc/bind/zones/db.root";
};

zone "test" {
    type master;
    file "/etc/bind/zones/db.test";
};
ROOT_CONF_EOF

# 5. cmp-auth named.conf
cat << 'CMP_CONF_EOF' > "${SCRIPT_DIR}/configs/cmp-auth/named.conf"
options {
    directory "/var/bind";
    listen-on { any; };
    listen-on-v6 { none; };
    allow-query { any; };
    recursion no;
    dnssec-validation no;
};

logging {
    channel default_log {
        file "/var/log/named.log" versions 3 size 5m;
        severity info;
        print-time yes;
        print-severity yes;
        print-category yes;
    };
    category default { default_log; };
    category queries { default_log; };
};

include "/etc/bind/rndc.key";
controls {
    inet 127.0.0.1 allow { localhost; } keys { "rndc-key"; };
};

zone "lab.test" {
    type master;
    file "/etc/bind/zones/db.lab.test";
};
CMP_CONF_EOF

# 6. Render variant-dependent named.conf files
if [[ "$VARIANT" == "loop" ]]; then
    # bc-cache1 & bc-cache2 in loop
    for c in bc-cache1 bc-cache2; do
        cat << 'CACHE_LOOP_EOF' > "${SCRIPT_DIR}/configs/${c}/named.conf"
options {
    directory "/var/bind";
    listen-on { any; };
    listen-on-v6 { none; };
    server-id hostname;
    dnssec-validation no;
};

logging {
    channel default_log {
        file "/var/log/named.log" versions 3 size 5m;
        severity info;
        print-time yes;
        print-severity yes;
        print-category yes;
    };
    category default { default_log; };
    category queries { default_log; };
    category resolver { default_log; };
};

include "/etc/bind/rndc.key";
controls {
    inet 127.0.0.1 allow { localhost; } keys { "rndc-key"; };
};

view "cache" {
    match-clients     { 172.21.21.1; };
    allow-query       { 172.21.21.1; };
    allow-query-cache { 172.21.21.1; };
    allow-recursion   { 172.21.21.1; };

    recursion yes;
    dnssec-validation no;

    forwarders { 172.25.25.127; 172.23.23.97; 172.23.23.129; };
    forward only;

    zone "." {
        type hint;
        file "/etc/bind/db.root";
    };
};
CACHE_LOOP_EOF
    done

    # bc-rmaster in loop
    cat << 'RMASTER_LOOP_EOF' > "${SCRIPT_DIR}/configs/bc-rmaster/named.conf"
options {
    directory "/var/bind";
    listen-on { any; };
    listen-on-v6 { none; };
    dnssec-validation no;
};

logging {
    channel default_log {
        file "/var/log/named.log" versions 3 size 5m;
        severity info;
        print-time yes;
        print-severity yes;
        print-category yes;
    };
    category default { default_log; };
    category queries { default_log; };
    category resolver { default_log; };
};

include "/etc/bind/rndc.key";
controls {
    inet 127.0.0.1 allow { localhost; } keys { "rndc-key"; };
};

view "recursive" {
    match-clients     { 172.22.22.0/24; 172.23.23.0/24; 172.25.25.0/24; };
    allow-query       { 172.22.22.0/24; 172.23.23.0/24; 172.25.25.0/24; };
    allow-query-cache { 172.22.22.0/24; 172.23.23.0/24; 172.25.25.0/24; };
    allow-recursion   { 172.22.22.0/24; 172.23.23.0/24; 172.25.25.0/24; };
    recursion yes;
    dnssec-validation no;

    forwarders { 172.25.25.127; 172.23.23.97; 172.23.23.129; };
    forward only;

    zone "." {
        type hint;
        file "/etc/bind/db.root";
    };
};

view "authoritative" {
    match-clients { any; };
    recursion no;

    zone "lab.test" {
        type master;
        file "/etc/bind/zones/db.lab.test";
        allow-transfer { 172.23.23.129; 172.23.23.100; };
        also-notify { 172.23.23.129; 172.23.23.100; };
    };
};
RMASTER_LOOP_EOF

    # bc-rslave1 and bc-rslave2 in loop
    for s in bc-rslave1 bc-rslave2; do
        cat << 'RSLAVE_LOOP_EOF' > "${SCRIPT_DIR}/configs/${s}/named.conf"
options {
    directory "/var/bind";
    listen-on { any; };
    listen-on-v6 { none; };
    server-id hostname;
    dnssec-validation no;
};

logging {
    channel default_log {
        file "/var/log/named.log" versions 3 size 5m;
        severity info;
        print-time yes;
        print-severity yes;
        print-category yes;
    };
    category default { default_log; };
    category queries { default_log; };
    category resolver { default_log; };
};

include "/etc/bind/rndc.key";
controls {
    inet 127.0.0.1 allow { localhost; } keys { "rndc-key"; };
};

view "recursive" {
    match-clients     { 172.22.22.0/24; 172.23.23.0/24; 172.25.25.0/24; };
    allow-query       { 172.22.22.0/24; 172.23.23.0/24; 172.25.25.0/24; };
    allow-query-cache { 172.22.22.0/24; 172.23.23.0/24; 172.25.25.0/24; };
    allow-recursion   { 172.22.22.0/24; 172.23.23.0/24; 172.25.25.0/24; };
    recursion yes;
    dnssec-validation no;

    forwarders { 172.25.25.127; 172.23.23.97; 172.23.23.129; };
    forward only;

    zone "." {
        type hint;
        file "/etc/bind/db.root";
    };
};

view "authoritative" {
    match-clients { any; };
    recursion no;

    zone "lab.test" {
        type slave;
        file "/var/bind/sec/db.lab.test";
        masters { 172.23.23.97; };
    };
};
RSLAVE_LOOP_EOF
    done

    # ex-dns in loop
    cat << 'EXDNS_LOOP_EOF' > "${SCRIPT_DIR}/configs/ex-dns/named.conf"
options {
    directory "/var/bind";
    listen-on { any; };
    listen-on-v6 { none; };
    allow-query { any; };
    allow-recursion { any; };
    recursion yes;
    dnssec-validation no;

    forwarders { 172.23.23.97; 172.23.23.129; 172.26.26.53; };
    forward only;
};

logging {
    channel default_log {
        file "/var/log/named.log" versions 3 size 5m;
        severity info;
        print-time yes;
        print-severity yes;
        print-category yes;
    };
    category default { default_log; };
    category queries { default_log; };
    category resolver { default_log; };
};

include "/etc/bind/rndc.key";
controls {
    inet 127.0.0.1 allow { localhost; } keys { "rndc-key"; };
};

zone "." {
    type hint;
    file "/etc/bind/db.root";
};
EXDNS_LOOP_EOF

elif [[ "$VARIANT" == "normal" ]]; then
    # bc-cache1 & bc-cache2 in normal
    for c in bc-cache1 bc-cache2; do
        cat << 'CACHE_NORM_EOF' > "${SCRIPT_DIR}/configs/${c}/named.conf"
options {
    directory "/var/bind";
    listen-on { any; };
    listen-on-v6 { none; };
    server-id hostname;
    dnssec-validation no;
};

logging {
    channel default_log {
        file "/var/log/named.log" versions 3 size 5m;
        severity info;
        print-time yes;
        print-severity yes;
        print-category yes;
    };
    category default { default_log; };
    category queries { default_log; };
    category resolver { default_log; };
};

include "/etc/bind/rndc.key";
controls {
    inet 127.0.0.1 allow { localhost; } keys { "rndc-key"; };
};

view "cache" {
    match-clients     { 172.21.21.1; };
    allow-query       { 172.21.21.1; };
    allow-query-cache { 172.21.21.1; };
    allow-recursion   { 172.21.21.1; };

    recursion yes;
    dnssec-validation no;

    forwarders { 172.23.23.97; 172.23.23.129; 172.23.23.100; };
    forward only;

    zone "." {
        type hint;
        file "/etc/bind/db.root";
    };
};
CACHE_NORM_EOF
    done

    # bc-rmaster in normal
    cat << 'RMASTER_NORM_EOF' > "${SCRIPT_DIR}/configs/bc-rmaster/named.conf"
options {
    directory "/var/bind";
    listen-on { any; };
    listen-on-v6 { none; };
    dnssec-validation no;
};

logging {
    channel default_log {
        file "/var/log/named.log" versions 3 size 5m;
        severity info;
        print-time yes;
        print-severity yes;
        print-category yes;
    };
    category default { default_log; };
    category queries { default_log; };
    category resolver { default_log; };
};

include "/etc/bind/rndc.key";
controls {
    inet 127.0.0.1 allow { localhost; } keys { "rndc-key"; };
};

view "recursive" {
    match-clients     { 172.22.22.100; 172.22.22.200; };
    allow-query       { 172.22.22.100; 172.22.22.200; };
    allow-query-cache { 172.22.22.100; 172.22.22.200; };
    allow-recursion   { 172.22.22.100; 172.22.22.200; };
    recursion yes;
    dnssec-validation no;

    zone "." {
        type hint;
        file "/etc/bind/db.root";
    };
};

view "authoritative" {
    match-clients { any; };
    recursion no;

    zone "lab.test" {
        type master;
        file "/etc/bind/zones/db.lab.test";
        allow-transfer { 172.23.23.129; 172.23.23.100; };
        also-notify { 172.23.23.129; 172.23.23.100; };
    };
};
RMASTER_NORM_EOF

    # bc-rslave1 and bc-rslave2 in normal
    for s in bc-rslave1 bc-rslave2; do
        cat << 'RSLAVE_NORM_EOF' > "${SCRIPT_DIR}/configs/${s}/named.conf"
options {
    directory "/var/bind";
    listen-on { any; };
    listen-on-v6 { none; };
    server-id hostname;
    dnssec-validation no;
};

logging {
    channel default_log {
        file "/var/log/named.log" versions 3 size 5m;
        severity info;
        print-time yes;
        print-severity yes;
        print-category yes;
    };
    category default { default_log; };
    category queries { default_log; };
    category resolver { default_log; };
};

include "/etc/bind/rndc.key";
controls {
    inet 127.0.0.1 allow { localhost; } keys { "rndc-key"; };
};

view "recursive" {
    match-clients     { 172.22.22.100; 172.22.22.200; };
    allow-query       { 172.22.22.100; 172.22.22.200; };
    allow-query-cache { 172.22.22.100; 172.22.22.200; };
    allow-recursion   { 172.22.22.100; 172.22.22.200; };
    recursion yes;
    dnssec-validation no;

    zone "." {
        type hint;
        file "/etc/bind/db.root";
    };
};

view "authoritative" {
    match-clients { any; };
    recursion no;

    zone "lab.test" {
        type slave;
        file "/var/bind/sec/db.lab.test";
        masters { 172.23.23.97; };
    };
};
RSLAVE_NORM_EOF
    done

    # ex-dns in normal
    cat << 'EXDNS_NORM_EOF' > "${SCRIPT_DIR}/configs/ex-dns/named.conf"
options {
    directory "/var/bind";
    listen-on { any; };
    listen-on-v6 { none; };
    allow-query { any; };
    allow-recursion { any; };
    recursion yes;
    dnssec-validation no;

    forwarders { 172.23.23.97; 172.23.23.129; 172.23.23.100; };
    forward only;
};

logging {
    channel default_log {
        file "/var/log/named.log" versions 3 size 5m;
        severity info;
        print-time yes;
        print-severity yes;
        print-category yes;
    };
    category default { default_log; };
    category queries { default_log; };
    category resolver { default_log; };
};

include "/etc/bind/rndc.key";
controls {
    inet 127.0.0.1 allow { localhost; } keys { "rndc-key"; };
};

zone "." {
    type hint;
    file "/etc/bind/db.root";
};
EXDNS_NORM_EOF
fi

echo "==> Pushing rendered configurations to containers..."

BIND_NODES=("bc-cache1" "bc-cache2" "bc-rmaster" "bc-rslave1" "bc-rslave2" "ex-dns" "root" "cmp-auth")

for node in "${BIND_NODES[@]}"; do
    c="clab-dns-${node}"
    docker exec "${c}" mkdir -p /etc/bind/zones /var/bind/sec /var/bind/pri /var/bind/dyn /run/named /var/log
    docker cp "${SCRIPT_DIR}/configs/${node}/named.conf" "${c}:/etc/bind/named.conf"

    if [[ -f "${SCRIPT_DIR}/configs/${node}/db.root" ]]; then
        docker cp "${SCRIPT_DIR}/configs/${node}/db.root" "${c}:/etc/bind/db.root"
    fi

    if [[ -d "${SCRIPT_DIR}/configs/${node}/zones" ]]; then
        for zf in "${SCRIPT_DIR}/configs/${node}/zones/"*; do
            if [[ -f "$zf" ]]; then
                docker cp "$zf" "${c}:/etc/bind/zones/$(basename "$zf")"
            fi
        done
    fi

    docker exec "${c}" touch /var/log/named.log
    docker exec "${c}" chown -R named:named /run/named /var/bind /etc/bind /var/log/named.log 2>/dev/null || true
    docker exec "${c}" chmod 770 /run/named /var/bind /var/bind/sec 2>/dev/null || true
    docker exec "${c}" chmod 775 /etc/bind 2>/dev/null || true
done

echo "==> Running named-checkconf on all BIND nodes..."
for node in "${BIND_NODES[@]}"; do
    c="clab-dns-${node}"
    docker exec "${c}" named-checkconf /etc/bind/named.conf
done
echo "    All named-checkconf checks passed."

echo "==> Running named-checkzone on authoritative nodes..."
docker exec clab-dns-root named-checkzone . /etc/bind/zones/db.root
docker exec clab-dns-root named-checkzone test /etc/bind/zones/db.test
docker exec clab-dns-bc-rmaster named-checkzone lab.test /etc/bind/zones/db.lab.test
docker exec clab-dns-cmp-auth named-checkzone lab.test /etc/bind/zones/db.lab.test
echo "    All named-checkzone checks passed."

echo "==> Starting or reloading named on all BIND nodes..."
for node in "${BIND_NODES[@]}"; do
    c="clab-dns-${node}"
    if docker exec "${c}" pidof named >/dev/null 2>&1; then
        docker exec "${c}" rndc reload >/dev/null 2>&1 || docker exec "${c}" pkill -HUP named || true
        docker exec "${c}" rndc flush >/dev/null 2>&1 || true
    else
        docker exec "${c}" /usr/sbin/named -u named -c /etc/bind/named.conf
    fi
done

# Subscriber resolver
echo "==> Configuring pc resolver (/etc/resolv.conf)..."
docker exec clab-dns-pc sh -c "echo 'nameserver 172.31.31.81' > /etc/resolv.conf"

# ECMP Hash Policy on Router
docker exec clab-dns-isp-r1 sysctl -w net.ipv4.fib_multipath_hash_policy=1 >/dev/null 2>&1 || true

echo "==> BIND9 deployment complete! Active variant: ${VARIANT}"
