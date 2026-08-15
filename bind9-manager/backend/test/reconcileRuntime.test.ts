import { describe, it, expect } from 'vitest';
import { openDb } from '../src/server/db';
import { createLab, reconcileServersRuntime } from '../src/server/labStore';
import { getServer } from '../src/server/entityStore';

function bindNode(name: string, ip: string) {
  return { name, kind: 'linux' as const, intent: 'bind' as const, image: 'dnsnode:1.0', mgmtIpv4: ip,
           binds: [`configs/${name}/named.conf:/etc/bind/named.conf`], interfaces: [] };
}
function inspectEntry(lab: string, node: string, id: string, ip: string, state = 'running') {
  return { name: `clab-${lab}-${node}`, containerId: id, state, status: 'Up 1 minute', ipv4Address: `${ip}/24` };
}

describe('reconcileServersRuntime', () => {
  it('binds a running bind node to its real container and marks SYNCED', () => {
    const db = openDb(':memory:');
    const lab = createLab(db, { name: 'lab1', configurationId: 'dns-lab',
      topology: { name: 'lab1', nodes: [bindNode('auth', '10.0.0.30')], links: [] } });
    const result = { validated: [], deployed: [{ serverId: 'auth', ok: true, output: '' }],
      runtime: [inspectEntry('lab1', 'auth', 'abc123', '10.0.0.30')] };
    reconcileServersRuntime(db, lab, result as any);
    const srv = getServer(db, 'srv-' + lab.id + '-auth') as any;
    expect(srv.containerId).toBe('abc123');
    expect(srv.runtimeAddress).toBe('10.0.0.30');
    expect(srv.syncState).toBe('SYNCED');
    expect(srv.lastDeployedAt).toBeTruthy();
  });

  it('MUST-FAIL CONTROL: a bind node absent from inspect becomes NODE_ABSENT', () => {
    const db = openDb(':memory:');
    const lab = createLab(db, { name: 'lab2', configurationId: 'dns-lab',
      topology: { name: 'lab2', nodes: [bindNode('auth', '10.0.0.30'), bindNode('cache', '10.0.0.31')], links: [] } });
    const result = { validated: [], deployed: [{ serverId: 'auth', ok: true, output: '' }],
      runtime: [inspectEntry('lab2', 'auth', 'abc123', '10.0.0.30')] }; // cache absent
    reconcileServersRuntime(db, lab, result as any);
    expect((getServer(db, 'srv-' + lab.id + '-cache') as any).syncState).toBe('NODE_ABSENT');
    expect((getServer(db, 'srv-' + lab.id + '-auth') as any).syncState).toBe('SYNCED');
  });

  it('a container present but with a failed deploy entry becomes ERROR', () => {
    const db = openDb(':memory:');
    const lab = createLab(db, { name: 'lab3', configurationId: 'dns-lab',
      topology: { name: 'lab3', nodes: [bindNode('auth', '10.0.0.30')], links: [] } });
    const result = { validated: [], deployed: [{ serverId: 'auth', ok: false, output: 'rndc failed' }],
      runtime: [inspectEntry('lab3', 'auth', 'abc123', '10.0.0.30')] };
    reconcileServersRuntime(db, lab, result as any);
    expect((getServer(db, 'srv-' + lab.id + '-auth') as any).syncState).toBe('ERROR');
  });

  it('detects ERROR when the deployed entry is keyed by the full server id (production form)', () => {
    // deployEngine emits serverId = server.id (srv-<lab.id>-<node>), not the bare node name.
    const db = openDb(':memory:');
    const lab = createLab(db, { name: 'lab3b', configurationId: 'dns-lab',
      topology: { name: 'lab3b', nodes: [bindNode('auth', '10.0.0.30')], links: [] } });
    const result = { validated: [],
      deployed: [{ serverId: 'srv-' + lab.id + '-auth', ok: false, output: 'rndc failed' }],
      runtime: [inspectEntry('lab3b', 'auth', 'abc123', '10.0.0.30')] };
    reconcileServersRuntime(db, lab, result as any);
    expect((getServer(db, 'srv-' + lab.id + '-auth') as any).syncState).toBe('ERROR');
  });

  it('leaves syncState untouched when inspect itself failed', () => {
    const db = openDb(':memory:');
    const lab = createLab(db, { name: 'lab4', configurationId: 'dns-lab',
      topology: { name: 'lab4', nodes: [bindNode('auth', '10.0.0.30')], links: [] } });
    const before = (getServer(db, 'srv-' + lab.id + '-auth') as any).syncState; // 'PENDING'
    reconcileServersRuntime(db, lab, { validated: [], runtimeError: 'inspect exited 1' } as any);
    expect((getServer(db, 'srv-' + lab.id + '-auth') as any).syncState).toBe(before);
  });
});
