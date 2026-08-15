import { describe, it, expect } from 'vitest';
import { openDb } from '../src/server/db';
import { createLab, reconcileServersRuntime } from '../src/server/labStore';
import { getServer } from '../src/server/entityStore';

function bindNode(name: string, ip: string) {
  return { name, kind: 'linux' as const, intent: 'bind' as const, image: 'dnsnode:1.0', mgmtIpv4: ip,
           binds: [`configs/${name}/named.conf:/etc/bind/named.conf`], interfaces: [] };
}
function routerNode(name: string, ip: string) {
  return { name, kind: 'linux' as const, intent: 'router' as const, image: 'router:1.0', mgmtIpv4: ip, interfaces: [] };
}
function inspectEntry(lab: string, node: string, id: string, ip: string, state = 'running') {
  return { name: `clab-${lab}-${node}`, containerId: id, state, status: 'Up 1 minute', ipv4Address: `${ip}/24` };
}

describe('reconcileServersRuntime — adversarial container-name join', () => {
  it('1. prefix collision: auth must NOT bind to authcache container', () => {
    const db = openDb(':memory:');
    const lab = createLab(db, { name: 'lab1', configurationId: 'dns-lab',
      topology: { name: 'lab1', nodes: [bindNode('auth', '10.0.0.30'), bindNode('authcache', '10.0.0.31')], links: [] } });
    const result = { validated: [], deployed: [{ serverId: 'auth', ok: true, output: '' }, { serverId: 'authcache', ok: true, output: '' }],
      runtime: [inspectEntry('lab1', 'authcache', 'cac1', '10.0.0.31')] };
    reconcileServersRuntime(db, lab, result as any);
    const auth = getServer(db, 'srv-' + lab.id + '-auth') as any;
    const authcache = getServer(db, 'srv-' + lab.id + '-authcache') as any;
    expect(auth.syncState).toBe('NODE_ABSENT');
    expect(auth.containerId).toBeUndefined();
    expect(authcache.syncState).toBe('SYNCED');
    expect(authcache.containerId).toBe('cac1');
  });

  it('2. cross-lab contamination: same node name in another lab must NOT match', () => {
    const db = openDb(':memory:');
    const lab = createLab(db, { name: 'lab1', configurationId: 'dns-lab',
      topology: { name: 'lab1', nodes: [bindNode('auth', '10.0.0.30')], links: [] } });
    const result = { validated: [], deployed: [{ serverId: 'auth', ok: true, output: '' }],
      runtime: [inspectEntry('otherlab', 'auth', 'other999', '10.9.9.9')] };
    reconcileServersRuntime(db, lab, result as any);
    const auth = getServer(db, 'srv-' + lab.id + '-auth') as any;
    expect(auth.syncState).toBe('NODE_ABSENT');
    expect(auth.containerId).not.toBe('other999');
    expect(auth.containerId).toBeUndefined();
  });

  it('3. non-bind (router) node never fabricated as a Server', () => {
    const db = openDb(':memory:');
    const lab = createLab(db, { name: 'lab1', configurationId: 'dns-lab',
      topology: { name: 'lab1', nodes: [bindNode('auth', '10.0.0.30'), routerNode('rtr1', '10.0.0.1')], links: [] } });
    const result = { validated: [], deployed: [{ serverId: 'auth', ok: true, output: '' }],
      runtime: [inspectEntry('lab1', 'auth', 'abc123', '10.0.0.30'), inspectEntry('lab1', 'rtr1', 'rtr999', '10.0.0.1')] };
    reconcileServersRuntime(db, lab, result as any);
    expect(getServer(db, 'srv-' + lab.id + '-rtr1')).toBeNull();
    expect((getServer(db, 'srv-' + lab.id + '-auth') as any).syncState).toBe('SYNCED');
  });

  it('4. hyphen boundary: ns must NOT match ns-1 container', () => {
    const db = openDb(':memory:');
    const lab = createLab(db, { name: 'lab1', configurationId: 'dns-lab',
      topology: { name: 'lab1', nodes: [bindNode('ns', '10.0.0.30'), bindNode('ns-1', '10.0.0.31')], links: [] } });
    const result = { validated: [], deployed: [{ serverId: 'ns', ok: true, output: '' }, { serverId: 'ns-1', ok: true, output: '' }],
      runtime: [inspectEntry('lab1', 'ns-1', 'ns1id', '10.0.0.31')] };
    reconcileServersRuntime(db, lab, result as any);
    const ns = getServer(db, 'srv-' + lab.id + '-ns') as any;
    const ns1 = getServer(db, 'srv-' + lab.id + '-ns-1') as any;
    expect(ns.syncState).toBe('NODE_ABSENT');
    expect(ns.containerId).toBeUndefined();
    expect(ns1.syncState).toBe('SYNCED');
    expect(ns1.containerId).toBe('ns1id');
  });

  it('5. ERROR wins over presence: running container + failed deploy step', () => {
    const db = openDb(':memory:');
    const lab = createLab(db, { name: 'lab1', configurationId: 'dns-lab',
      topology: { name: 'lab1', nodes: [bindNode('auth', '10.0.0.30')], links: [] } });
    const result = { validated: [], deployed: [{ serverId: 'auth', ok: false, output: 'rndc reload failed' }],
      runtime: [inspectEntry('lab1', 'auth', 'abc123', '10.0.0.30')] };
    reconcileServersRuntime(db, lab, result as any);
    const auth = getServer(db, 'srv-' + lab.id + '-auth') as any;
    expect(auth.syncState).toBe('ERROR');
    expect(auth.containerId).toBe('abc123');
  });
});
