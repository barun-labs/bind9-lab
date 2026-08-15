import type { TopologyModel } from '../config-engine/topology';

export const anycastTopology: TopologyModel = {
  name: 'dns',
  mgmtNetwork: 'dns-mgmt',
  mgmtSubnet: '10.233.4.0/24',
  nodes: [
    {
      name: 'isp-r1',
      kind: 'linux',
      image: 'dnsnode:1.0',
      mgmtIpv4: '10.233.4.11',
      binds: [
        'configs/isp-r1/frr.conf:/etc/frr/frr.conf',
        'configs/isp-r1/daemons:/etc/frr/daemons',
      ],
    },
    {
      name: 'bc-cache1',
      kind: 'linux',
      image: 'dnsnode:1.0',
      mgmtIpv4: '10.233.4.21',
      binds: [
        'configs/bc-cache1/frr.conf:/etc/frr/frr.conf',
        'configs/bc-cache1/daemons:/etc/frr/daemons',
        'configs/bc-cache1/named.conf:/etc/bind/named.conf',
        'configs/bc-cache1/db.root:/etc/bind/db.root',
      ],
    },
    {
      name: 'bc-cache2',
      kind: 'linux',
      image: 'dnsnode:1.0',
      mgmtIpv4: '10.233.4.22',
      binds: [
        'configs/bc-cache2/frr.conf:/etc/frr/frr.conf',
        'configs/bc-cache2/daemons:/etc/frr/daemons',
        'configs/bc-cache2/named.conf:/etc/bind/named.conf',
        'configs/bc-cache2/db.root:/etc/bind/db.root',
      ],
    },
    {
      name: 'bc-rmaster',
      kind: 'linux',
      image: 'dnsnode:1.0',
      mgmtIpv4: '10.233.4.30',
      binds: [
        'configs/bc-rmaster/named.conf:/etc/bind/named.conf',
        'configs/bc-rmaster/db.root:/etc/bind/db.root',
        'configs/bc-rmaster/zones/db.lab.test:/etc/bind/zones/db.lab.test',
      ],
    },
    {
      name: 'bc-rslave1',
      kind: 'linux',
      image: 'dnsnode:1.0',
      mgmtIpv4: '10.233.4.31',
      binds: [
        'configs/bc-rslave1/frr.conf:/etc/frr/frr.conf',
        'configs/bc-rslave1/daemons:/etc/frr/daemons',
        'configs/bc-rslave1/named.conf:/etc/bind/named.conf',
        'configs/bc-rslave1/db.root:/etc/bind/db.root',
      ],
    },
    {
      name: 'bc-rslave2',
      kind: 'linux',
      image: 'dnsnode:1.0',
      mgmtIpv4: '10.233.4.32',
      binds: [
        'configs/bc-rslave2/frr.conf:/etc/frr/frr.conf',
        'configs/bc-rslave2/daemons:/etc/frr/daemons',
        'configs/bc-rslave2/named.conf:/etc/bind/named.conf',
        'configs/bc-rslave2/db.root:/etc/bind/db.root',
      ],
    },
    {
      name: 'ex-dns',
      kind: 'linux',
      image: 'dnsnode:1.0',
      mgmtIpv4: '10.233.4.41',
      binds: [
        'configs/ex-dns/named.conf:/etc/bind/named.conf',
        'configs/ex-dns/db.root:/etc/bind/db.root',
      ],
    },
    {
      name: 'root',
      kind: 'linux',
      image: 'dnsnode:1.0',
      mgmtIpv4: '10.233.4.51',
      binds: [
        'configs/root/named.conf:/etc/bind/named.conf',
        'configs/root/zones/db.root:/etc/bind/zones/db.root',
        'configs/root/zones/db.test:/etc/bind/zones/db.test',
      ],
    },
    {
      name: 'cmp-auth',
      kind: 'linux',
      image: 'dnsnode:1.0',
      mgmtIpv4: '10.233.4.52',
      binds: [
        'configs/cmp-auth/named.conf:/etc/bind/named.conf',
        'configs/cmp-auth/zones/db.lab.test:/etc/bind/zones/db.lab.test',
      ],
    },
    {
      name: 'pc',
      kind: 'linux',
      image: 'host:max',
      mgmtIpv4: '10.233.4.101',
    },
    {
      name: 'br-dnscache',
      kind: 'bridge',
    },
    {
      name: 'br-dnsrec',
      kind: 'bridge',
    },
    {
      name: 'br-dnsext',
      kind: 'bridge',
    },
  ],
  links: [
    { endpoints: ['pc:eth1', 'isp-r1:eth1'] },
    { endpoints: ['isp-r1:eth2', 'br-dnscache:r1-eth2'] },
    { endpoints: ['bc-cache1:eth1', 'br-dnscache:c1-eth1'] },
    { endpoints: ['bc-cache2:eth1', 'br-dnscache:c2-eth1'] },
    { endpoints: ['isp-r1:eth3', 'br-dnsrec:r1-eth3'] },
    { endpoints: ['bc-rmaster:eth1', 'br-dnsrec:rm-eth1'] },
    { endpoints: ['bc-rslave1:eth1', 'br-dnsrec:rs1-eth1'] },
    { endpoints: ['bc-rslave2:eth1', 'br-dnsrec:rs2-eth1'] },
    { endpoints: ['ex-dns:eth1', 'isp-r1:eth4'] },
    { endpoints: ['isp-r1:eth5', 'br-dnsext:r1-eth5'] },
    { endpoints: ['root:eth1', 'br-dnsext:rt-eth1'] },
    { endpoints: ['cmp-auth:eth1', 'br-dnsext:ca-eth1'] },
  ],
};
