import type { TopologyModel } from '../config-engine/topology';

// 5-node companion topology for testlabModel: a router bridging two
// segments, and the four BIND nodes from testlabModel wired onto them.
// Structured the same way as anycastTopology (bridge nodes as L2 segments,
// linux nodes carrying binds for their generated config files), but with a
// fresh 10.60.0.0/16 addressing scheme and static default routes + simple
// IP forwarding on the router instead of FRR/OSPF.
export const testlabTopology: TopologyModel = {
  name: 'bind9mgr-testlab',
  mgmtNetwork: 'bind9mgr-testlab-mgmt',
  mgmtSubnet: '10.60.99.0/24',
  nodes: [
    {
      name: 'router',
      kind: 'linux',
      image: 'dnsnode:1.0',
      mgmtIpv4: '10.60.99.11',
      interfaces: [
        { name: 'eth1', address: '10.60.1.1/24' },
        { name: 'eth2', address: '10.60.2.1/24' },
      ],
      ipForward: true,
    },
    {
      name: 'cache',
      kind: 'linux',
      image: 'dnsnode:1.0',
      mgmtIpv4: '10.60.99.21',
      binds: ['configs/cache/named.conf:/etc/bind/named.conf'],
      interfaces: [{ name: 'eth1', address: '10.60.1.10/24' }],
      defaultVia: '10.60.1.1',
    },
    {
      name: 'recursive',
      kind: 'linux',
      image: 'dnsnode:1.0',
      mgmtIpv4: '10.60.99.22',
      binds: [
        'configs/recursive/named.conf:/etc/bind/named.conf',
        'configs/recursive/db.root:/etc/bind/db.root',
      ],
      interfaces: [{ name: 'eth1', address: '10.60.1.20/24' }],
      defaultVia: '10.60.1.1',
    },
    {
      name: 'root',
      kind: 'linux',
      image: 'dnsnode:1.0',
      mgmtIpv4: '10.60.99.53',
      binds: [
        'configs/root/named.conf:/etc/bind/named.conf',
        'configs/root/zones/db.root:/etc/bind/zones/db.root',
      ],
      interfaces: [{ name: 'eth1', address: '10.60.2.53/24' }],
      defaultVia: '10.60.2.1',
    },
    {
      name: 'auth',
      kind: 'linux',
      image: 'dnsnode:1.0',
      mgmtIpv4: '10.60.99.30',
      binds: [
        'configs/auth/named.conf:/etc/bind/named.conf',
        'configs/auth/zones/db.test:/etc/bind/zones/db.test',
      ],
      interfaces: [{ name: 'eth1', address: '10.60.2.30/24' }],
      defaultVia: '10.60.2.1',
    },
    {
      name: 'seg-a',
      kind: 'bridge',
    },
    {
      name: 'seg-b',
      kind: 'bridge',
    },
  ],
  links: [
    // Bridge-side interface names are host-global (not namespaced per
    // bridge), so they must not collide with any other lab's link names —
    // in particular the production `dns` lab, which already uses `rt-eth1`
    // for its own root node. Namespace ours with a `tl-` prefix.
    { endpoints: ['router:eth1', 'seg-a:tl-rt-eth1'] },
    { endpoints: ['cache:eth1', 'seg-a:tl-cache-eth1'] },
    { endpoints: ['recursive:eth1', 'seg-a:tl-recursive-eth1'] },
    { endpoints: ['router:eth2', 'seg-b:tl-rt-eth2'] },
    { endpoints: ['root:eth1', 'seg-b:tl-root-eth1'] },
    { endpoints: ['auth:eth1', 'seg-b:tl-auth-eth1'] },
  ],
};
