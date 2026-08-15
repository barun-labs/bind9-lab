import { describe, it, expect } from 'vitest';
import { openDb } from '../src/server/db';
import { createLab, getLab, listLabs, updateLab, deleteLab } from '../src/server/labStore';
import * as es from '../src/server/entityStore';
import type { TopologyModel } from '../src/config-engine/topology';

const topo = (nodes: any[]): TopologyModel => ({ name: 'mylab', mgmtSubnet: '10.70.0.0/24', nodes, links: [] });

describe('labStore', () => {
  it('create/list/get/update/delete a lab', () => {
    const db = openDb(':memory:');
    const lab = createLab(db, { name: 'mylab', configurationId: 'dns-lab', topology: topo([]) });
    expect(getLab(db, lab.id)!.name).toBe('mylab');
    expect(listLabs(db, 'dns-lab').some((l) => l.id === lab.id)).toBe(true);
    updateLab(db, lab.id, { name: 'renamed' });
    expect(getLab(db, lab.id)!.name).toBe('renamed');
    deleteLab(db, lab.id);
    expect(getLab(db, lab.id)).toBeNull();
  });

  it('a bind node reconciles to a Server; router/bridge do not', () => {
    const db = openDb(':memory:');
    const nodes = [
      { name: 'ns1', kind: 'linux', intent: 'bind', image: 'dnsnode:1.0', mgmtIpv4: '10.70.0.11', interfaces: [{ name: 'eth1', address: '10.70.0.11/24' }] },
      { name: 'r1', kind: 'linux', intent: 'router', image: 'dnsnode:1.0', mgmtIpv4: '10.70.0.1' },
      { name: 'br', kind: 'bridge', intent: 'bridge' },
    ];
    const lab = createLab(db, { name: 'mylab', configurationId: 'dns-lab', topology: topo(nodes) });
    const servers = es.listServers ? es.listServers(db, 'dns-lab') : [];
    expect(servers.find((s: any) => s.nodeName === 'ns1')).toBeTruthy();
    expect(servers.find((s: any) => s.nodeName === 'r1')).toBeUndefined();
    // removing the bind node unlinks its server
    updateLab(db, lab.id, { topology: topo(nodes.filter((n) => n.name !== 'ns1')) });
    const after = es.listServers ? es.listServers(db, 'dns-lab') : [];
    expect(after.find((s: any) => s.nodeName === 'ns1')).toBeUndefined();
  });

  it('handles server fields correctly (id, hostname, labName, serviceInterfaces, mgmtAddress)', () => {
    const db = openDb(':memory:');
    const nodes = [
      {
        name: 'ns-primary',
        kind: 'linux',
        intent: 'bind',
        image: 'dnsnode:1.0',
        mgmtIpv4: '10.70.0.10',
        interfaces: [
          { name: 'eth1', address: '10.70.0.10/24' },
          { name: 'eth2', address: '192.168.1.1/24' },
        ],
      },
    ];
    const lab = createLab(db, { name: 'primary-lab', configurationId: 'dns-lab', topology: topo(nodes) });
    const servers = es.listServers(db, 'dns-lab');
    const srv = servers.find((s) => s.nodeName === 'ns-primary');
    expect(srv).toBeDefined();
    expect(srv?.id).toBe(`srv-${lab.id}-ns-primary`);
    expect(srv?.hostname).toBe('ns-primary');
    expect(srv?.labName).toBe('primary-lab');
    expect(srv?.mgmtAddress).toBe('10.70.0.10');
    expect(srv?.adminState).toBe('ENABLED');
    expect(srv?.syncState).toBe('PENDING');
    expect(srv?.serviceInterfaces).toEqual([
      { address: '10.70.0.10', port: 53 },
      { address: '192.168.1.1', port: 53 },
    ]);
  });

  it('deleting a lab unlinks its servers', () => {
    const db = openDb(':memory:');
    const nodes = [
      { name: 'ns-temp', kind: 'linux', intent: 'bind', image: 'dnsnode:1.0', mgmtIpv4: '10.70.0.99', interfaces: [{ name: 'eth1', address: '10.70.0.99/24' }] },
    ];
    const lab = createLab(db, { name: 'temp-lab', configurationId: 'dns-lab', topology: topo(nodes) });
    expect(es.listServers(db, 'dns-lab').find((s) => s.nodeName === 'ns-temp')).toBeDefined();
    deleteLab(db, lab.id);
    expect(es.listServers(db, 'dns-lab').find((s) => s.nodeName === 'ns-temp')).toBeUndefined();
  });

  it('listLabs returns empty list for configuration with no labs', () => {
    const db = openDb(':memory:');
    expect(listLabs(db, 'non-existent-config')).toEqual([]);
  });

  it('updateLab throws error if lab does not exist', () => {
    const db = openDb(':memory:');
    expect(() => updateLab(db, 'non-existent', { name: 'foo' })).toThrow('Lab non-existent not found');
  });
});
