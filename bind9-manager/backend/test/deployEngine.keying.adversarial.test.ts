import { describe, it, expect } from 'vitest';
import { deploy, type Runner } from '../src/server/deployEngine';
import { generateServerConfig } from '../src/config-engine';
import type { ConfigModel, Configuration, Server } from '../src/config-engine/model';
import type { TopologyModel, NodeSpec } from '../src/config-engine/topology';

// Echoes a NODE_BEGIN/NODE_END pair for every `NODE_ID='...'` the deploy
// script sets, so deploy() parses back a `deployed` list without Docker.
function makeMarkerRunner(): { run: Runner; scripts: string[] } {
  const scripts: string[] = [];
  const run: Runner = async (script) => {
    scripts.push(script);
    if (script.includes('containerlab deploy')) {
      let out = '';
      for (const match of script.matchAll(/NODE_ID='([^']+)'/g)) {
        out += `__BIND9MGR_NODE_BEGIN__ ${match[1]}\nOK\n__BIND9MGR_NODE_END__ ${match[1]} 0\n`;
      }
      return { code: 0, stdout: out || 'OK', stderr: '' };
    }
    return { code: 0, stdout: 'OK', stderr: '' };
  };
  return { run, scripts };
}

const config: Configuration = {
  id: 'cfg-keying',
  name: 'cfg-keying',
  isActive: true,
  createdFromTemplateId: null,
  createdAt: '2026-08-16T00:00:00Z',
  updatedAt: '2026-08-16T00:00:00Z',
  counts: { views: 0, zones: 0, records: 0, servers: 0 },
};

function makeModel(servers: Server[], options: ConfigModel['options'] = []): ConfigModel {
  return {
    configuration: config,
    views: [],
    zones: [],
    records: [],
    servers,
    roles: [],
    options,
  };
}

function linux(name: string): NodeSpec {
  return { name, kind: 'linux', image: 'dnsnode:1.0' };
}

function makeTopo(name: string, nodes: NodeSpec[]): TopologyModel {
  return { name, nodes, links: [] };
}

function b64(content: string): string {
  return Buffer.from(content, 'utf-8').toString('base64');
}

function deployScriptFor(scripts: string[]): string {
  const script = scripts.find((s) => s.includes('containerlab deploy'));
  if (!script) throw new Error('no containerlab deploy script captured');
  return script;
}

describe('deployEngine node<->server keying (adversarial)', () => {
  it('case 1: nodeName link wins over id collision, single deploy', async () => {
    const primary: Server = { id: 'srv-x-ns1', name: 'srv-x-ns1', nodeName: 'ns1' };
    const decoy: Server = { id: 'ns1', name: 'ns1' }; // id === node name, NO nodeName
    const model = makeModel([decoy, primary], [
      { scopeType: 'SERVER', scopeId: 'srv-x-ns1', key: 'server-id', value: '"primary-ns1"' },
      { scopeType: 'SERVER', scopeId: 'ns1', key: 'server-id', value: '"decoy"' },
    ]);
    const topology = makeTopo('keying-1', [linux('ns1')]);

    const { run, scripts } = makeMarkerRunner();
    const result = await deploy(model, topology, { run, labDir: '/tmp/keying-1' });

    expect(result.aborted).toBeUndefined();
    const ns1Entries = result.deployed?.filter((d) => d.serverId === 'ns1') ?? [];
    expect(ns1Entries.length).toBe(1);
    expect(result.deployed?.length).toBe(1);

    const script = deployScriptFor(scripts);
    expect(script).toContain('configs/ns1/');
    expect(script).toContain('clab-keying-1-ns1');
    // Config CONTENT must come from the nodeName-linked server, not the decoy.
    const primaryConf = generateServerConfig(model, 'srv-x-ns1')['named.conf'];
    const decoyConf = generateServerConfig(model, 'ns1')['named.conf'];
    expect(script).toContain(b64(primaryConf));
    expect(script).not.toContain(b64(decoyConf));
  });

  it('case 2: linux node with no matching server is skipped', async () => {
    const model = makeModel([{ id: 'ns1', name: 'ns1', nodeName: 'ns1' }]);
    const topology = makeTopo('keying-2', [linux('ns1'), linux('r1')]); // r1 = router, no server

    const { run, scripts } = makeMarkerRunner();
    const result = await deploy(model, topology, { run, labDir: '/tmp/keying-2' });

    expect(result.aborted).toBeUndefined();
    expect(result.deployed?.find((d) => d.serverId === 'ns1')).toBeDefined();
    expect(result.deployed?.find((d) => d.serverId === 'r1')).toBeUndefined();

    const script = deployScriptFor(scripts);
    expect(script).not.toContain('clab-keying-2-r1');
    expect(script).not.toContain('configs/r1/');
    expect(script).not.toContain(`NODE_ID='r1'`);
  });

  it('case 3: lab server config lands in node dir, keyed on node name', async () => {
    const model = makeModel([{ id: 'srv-lab-ns1', name: 'srv-lab-ns1', nodeName: 'ns1' }]);
    const topology = makeTopo('keying-3', [linux('ns1')]);

    const { run, scripts } = makeMarkerRunner();
    const result = await deploy(model, topology, { run, labDir: '/tmp/keying-3' });

    expect(result.aborted).toBeUndefined();
    const entry = result.deployed?.find((d) => d.serverId === 'ns1');
    expect(entry).toBeDefined();
    expect(entry?.ok).toBe(true);

    const script = deployScriptFor(scripts);
    expect(script).toContain('configs/ns1/');
    expect(script).not.toContain('configs/srv-lab-ns1/');
    expect(script).toContain('clab-keying-3-ns1');
  });

  it('case 4: two distinct bind nodes both deploy', async () => {
    const model = makeModel([
      { id: 'srv-lab-ns1', name: 'srv-lab-ns1', nodeName: 'ns1' },
      { id: 'srv-lab-ns2', name: 'srv-lab-ns2', nodeName: 'ns2' },
    ]);
    const topology = makeTopo('keying-4', [linux('ns1'), linux('ns2')]);

    const { run, scripts } = makeMarkerRunner();
    const result = await deploy(model, topology, { run, labDir: '/tmp/keying-4' });

    expect(result.aborted).toBeUndefined();
    const ns1 = result.deployed?.find((d) => d.serverId === 'ns1');
    const ns2 = result.deployed?.find((d) => d.serverId === 'ns2');
    expect(ns1?.ok).toBe(true);
    expect(ns2?.ok).toBe(true);

    const script = deployScriptFor(scripts);
    expect(script).toContain('configs/ns1/');
    expect(script).toContain('configs/ns2/');
    expect(script).toContain('clab-keying-4-ns1');
    expect(script).toContain('clab-keying-4-ns2');
  });

  it('case 5: mixed legacy (id===nodeName) + lab (nodeName) both deploy', async () => {
    const model = makeModel([
      { id: 'auth', name: 'auth' }, // legacy: id IS the node name
      { id: 'srv-lab-ns1', name: 'srv-lab-ns1', nodeName: 'ns1' }, // lab
    ]);
    const topology = makeTopo('keying-5', [linux('auth'), linux('ns1')]);

    const { run, scripts } = makeMarkerRunner();
    const result = await deploy(model, topology, { run, labDir: '/tmp/keying-5' });

    expect(result.aborted).toBeUndefined();
    expect(result.deployed?.find((d) => d.serverId === 'auth')?.ok).toBe(true);
    expect(result.deployed?.find((d) => d.serverId === 'ns1')?.ok).toBe(true);

    const script = deployScriptFor(scripts);
    expect(script).toContain('configs/auth/');
    expect(script).toContain('clab-keying-5-auth');
    expect(script).toContain('configs/ns1/');
    expect(script).toContain('clab-keying-5-ns1');
  });

  it('case 6: non-linux (bridge) node is never deployed', async () => {
    const model = makeModel([{ id: 'srv-br0', name: 'srv-br0', nodeName: 'br0' }]);
    const topology = makeTopo('keying-6', [{ name: 'br0', kind: 'bridge' }]);

    const { run, scripts } = makeMarkerRunner();
    const result = await deploy(model, topology, { run, labDir: '/tmp/keying-6' });

    expect(result.aborted).toBeUndefined();
    expect(result.deployed?.find((d) => d.serverId === 'br0')).toBeUndefined();

    const script = deployScriptFor(scripts);
    expect(script).not.toContain('clab-keying-6-br0');
    expect(script).not.toContain('configs/br0/');
    expect(script).not.toContain(`NODE_ID='br0'`);
  });
});
