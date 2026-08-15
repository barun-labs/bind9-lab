import { describe, it, expect } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import {
  createLab,
  getLab,
  listLabs,
  updateLab,
  deleteLab,
} from '../src/server/labStore';
import * as es from '../src/server/entityStore';
import type { TopologyModel } from '../src/config-engine/topology';

const topo = (nodes: any[]): TopologyModel => ({
  name: 'mylab',
  mgmtSubnet: '10.70.0.0/24',
  nodes,
  links: [],
});

const bind = (name: string, extra: Record<string, any> = {}) => ({
  name,
  kind: 'linux',
  intent: 'bind',
  image: 'dnsnode:1.0',
  ...extra,
});

const serversFor = (db: Database.Database, configId: string, nodeName: string) =>
  es.listServers(db, configId).filter((s) => s.nodeName === nodeName);

describe('labStore reconcile — adversarial', () => {
  it('bind node creates exactly one Server; router/bridge create none', () => {
    const db = openDb(':memory:');
    const nodes = [
      bind('ns1', { mgmtIpv4: '10.70.0.11', interfaces: [{ name: 'eth1', address: '10.70.0.11/24' }] }),
      { name: 'r1', kind: 'linux', intent: 'router', image: 'dnsnode:1.0', mgmtIpv4: '10.70.0.1' },
      { name: 'br0', kind: 'bridge', intent: 'bridge' },
    ];
    createLab(db, { name: 'lab', configurationId: 'dns-lab', topology: topo(nodes) });

    expect(serversFor(db, 'dns-lab', 'ns1')).toHaveLength(1);
    expect(serversFor(db, 'dns-lab', 'r1')).toHaveLength(0);
    expect(serversFor(db, 'dns-lab', 'br0')).toHaveLength(0);
  });

  it('renaming a bind node leaves exactly the new Server, not both', () => {
    const db = openDb(':memory:');
    const lab = createLab(db, {
      name: 'lab',
      configurationId: 'dns-lab',
      topology: topo([bind('ns1', { mgmtIpv4: '10.70.0.11' })]),
    });

    updateLab(db, lab.id, { topology: topo([bind('ns2', { mgmtIpv4: '10.70.0.11' })]) });

    expect(serversFor(db, 'dns-lab', 'ns1')).toHaveLength(0);
    expect(serversFor(db, 'dns-lab', 'ns2')).toHaveLength(1);
    // Exactly one server overall in the config for this lab, never two.
    expect(es.listServers(db, 'dns-lab').filter((s) => s.labName === 'lab')).toHaveLength(1);
  });

  it('two labs in the SAME config with DIFFERENT bind nodes keep independent servers', () => {
    const db = openDb(':memory:');
    const labA = createLab(db, {
      name: 'labA',
      configurationId: 'dns-lab',
      topology: topo([bind('ns1', { mgmtIpv4: '10.70.0.11' })]),
    });
    createLab(db, {
      name: 'labB',
      configurationId: 'dns-lab',
      topology: topo([bind('ns2', { mgmtIpv4: '10.70.0.12' })]),
    });

    // Update lab A (remove its bind node) — must NOT touch lab B's server.
    updateLab(db, labA.id, { topology: topo([]) });

    expect(serversFor(db, 'dns-lab', 'ns1')).toHaveLength(0);
    const labBServers = serversFor(db, 'dns-lab', 'ns2');
    expect(labBServers).toHaveLength(1);
    expect(labBServers[0].labName).toBe('labB');
    expect(labBServers[0].mgmtAddress).toBe('10.70.0.12');
  });

  it('updating a lab to remove ALL bind nodes unlinks all its Servers', () => {
    const db = openDb(':memory:');
    const lab = createLab(db, {
      name: 'lab',
      configurationId: 'dns-lab',
      topology: topo([
        bind('ns1', { mgmtIpv4: '10.70.0.11' }),
        bind('ns2', { mgmtIpv4: '10.70.0.12' }),
      ]),
    });
    expect(serversFor(db, 'dns-lab', 'ns1')).toHaveLength(1);
    expect(serversFor(db, 'dns-lab', 'ns2')).toHaveLength(1);

    updateLab(db, lab.id, { topology: topo([]) });

    expect(serversFor(db, 'dns-lab', 'ns1')).toHaveLength(0);
    expect(serversFor(db, 'dns-lab', 'ns2')).toHaveLength(0);
    expect(es.listServers(db, 'dns-lab').filter((s) => s.labName === 'lab')).toHaveLength(0);
  });

  it('bind node with no interfaces still creates a Server (empty serviceInterfaces), no throw', () => {
    const db = openDb(':memory:');
    createLab(db, {
      name: 'lab',
      configurationId: 'dns-lab',
      topology: topo([bind('ns1', { mgmtIpv4: '10.70.0.11' })]),
    });

    const servers = serversFor(db, 'dns-lab', 'ns1');
    expect(servers).toHaveLength(1);
    expect(servers[0].serviceInterfaces).toEqual([]);
  });

  it('serviceInterfaces: 10.70.0.11/24 yields address 10.70.0.11, port 53', () => {
    const db = openDb(':memory:');
    createLab(db, {
      name: 'lab',
      configurationId: 'dns-lab',
      topology: topo([
        bind('ns1', {
          mgmtIpv4: '10.70.0.11',
          interfaces: [{ name: 'eth1', address: '10.70.0.11/24' }],
        }),
      ]),
    });

    const [srv] = serversFor(db, 'dns-lab', 'ns1');
    expect(srv.serviceInterfaces).toEqual([{ address: '10.70.0.11', port: 53 }]);
  });
});

describe('labStore CRUD — adversarial', () => {
  it('missing-id CRUD is sane: get→null, list→[], delete→no-throw, update→throws', () => {
    const db = openDb(':memory:');
    expect(getLab(db, 'lab-missing')).toBeNull();
    expect(listLabs(db, 'no-config')).toEqual([]);
    // delete is a no-op (returns deleted:true) — matches the {deleted:true} contract.
    expect(() => deleteLab(db, 'lab-missing')).not.toThrow();
    expect(deleteLab(db, 'lab-missing')).toEqual({ deleted: true });
    // update throws — established contract (see labStore.test.ts).
    expect(() => updateLab(db, 'lab-missing', { name: 'x' })).toThrow('Lab lab-missing not found');
  });

  it('listLabs filters by configurationId (lab in config A absent from config B list)', () => {
    const db = openDb(':memory:');
    const lab = createLab(db, {
      name: 'lab',
      configurationId: 'dns-lab',
      topology: topo([]),
    });

    expect(listLabs(db, 'dns-lab').some((l) => l.id === lab.id)).toBe(true);
    expect(listLabs(db, 'split-horizon').some((l) => l.id === lab.id)).toBe(false);
  });

  it('changing a lab\'s configurationId relocates its Server to the new config (no orphan)', () => {
    const db = openDb(':memory:');
    const lab = createLab(db, {
      name: 'lab',
      configurationId: 'dns-lab',
      topology: topo([bind('ns1', { mgmtIpv4: '10.70.0.11' })]),
    });

    updateLab(db, lab.id, { configurationId: 'split-horizon' });

    expect(serversFor(db, 'dns-lab', 'ns1')).toHaveLength(0);
    expect(serversFor(db, 'split-horizon', 'ns1')).toHaveLength(1);
  });

  it('name / node name with quotes + unicode round-trips through the JSON column intact', () => {
    const db = openDb(':memory:');
    const labName = 'lab "un é" 😀 <&> \\ ';
    const nodeName = 'ns-"ünïcode"😀';
    const lab = createLab(db, {
      name: labName,
      configurationId: 'dns-lab',
      topology: topo([bind(nodeName, { mgmtIpv4: '10.70.0.11' })]),
    });

    const fetched = getLab(db, lab.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe(labName);
    expect(fetched!.topology.nodes[0].name).toBe(nodeName);

    const [srv] = serversFor(db, 'dns-lab', nodeName);
    expect(srv).toBeDefined();
    expect(srv.nodeName).toBe(nodeName);
    expect(srv.hostname).toBe(nodeName);
  });
});

describe('labStore reconcile — defects (identity not lab-scoped)', () => {
  it('DEFECT: two labs in the SAME config with the SAME bind node name clobber each other', () => {
    const db = openDb(':memory:');
    const labA = createLab(db, {
      name: 'labA',
      configurationId: 'dns-lab',
      topology: topo([bind('ns-shared', { mgmtIpv4: '10.70.0.11' })]),
    });
    createLab(db, {
      name: 'labB',
      configurationId: 'dns-lab',
      topology: topo([bind('ns-shared', { mgmtIpv4: '10.70.0.12' })]),
    });

    // id is 'srv-<nodeName>' and delete/upsert match on nodeName alone, so lab A's
    // server is overwritten by lab B. Expect one server PER lab, not one total.
    const shared = es.listServers(db, 'dns-lab').filter((s) => s.nodeName === 'ns-shared');
    expect(shared).toHaveLength(2);
    expect(shared.some((s) => s.labName === 'labA')).toBe(true);
    expect(shared.some((s) => s.labName === 'labB')).toBe(true);

    // deleting lab A must not delete lab B's server.
    deleteLab(db, labA.id);
    const after = es.listServers(db, 'dns-lab').filter((s) => s.nodeName === 'ns-shared');
    expect(after).toHaveLength(1);
    expect(after[0].labName).toBe('labB');
  });
});
