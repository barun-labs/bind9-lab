import { describe, it, expect } from 'vitest';
import { openDb } from '../src/server/db';
import { createLab } from '../src/server/labStore';
import { buildConfigModel } from '../src/server/entityStore';
import { deploy, type Runner } from '../src/server/deployEngine';
import type { ConfigModel, Configuration } from '../src/config-engine/model';
import type { TopologyModel } from '../src/config-engine/topology';

// Mirrors test/deployJobs.test.ts's mock runner: echoes a NODE_BEGIN/NODE_END
// pair for every `NODE_ID='...'` the deploy script sets, so a real deploy()
// call parses back a non-empty `deployed` list without touching Docker.
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

describe('deployEngine lab-created config path', () => {
  it('a lab-created server (id=srv-<lab>-<node>, nodeName set) deploys via its topology node name', async () => {
    const db = openDb(':memory:');

    const topology: TopologyModel = {
      name: 'labconfig-test',
      mgmtSubnet: '10.70.0.0/24',
      nodes: [
        {
          name: 'ns1',
          kind: 'linux',
          intent: 'bind',
          image: 'dnsnode:1.0',
          mgmtIpv4: '10.70.0.11',
          interfaces: [{ name: 'eth1', address: '10.70.0.11/24' }],
        },
      ],
      links: [],
    };

    const lab = createLab(db, {
      name: 'labconfig-test',
      configurationId: 'dns-lab',
      topology,
    });

    // createLab -> reconcileServers has already written a Server row with
    // id `srv-<lab.id>-ns1` and nodeName `ns1` into configurationId dns-lab.
    const model = buildConfigModel(db, 'dns-lab');
    const labServer = model.servers.find((s) => s.nodeName === 'ns1');
    expect(labServer).toBeDefined();
    expect(labServer?.id).toBe('srv-' + lab.id + '-ns1');

    const { run, scripts } = makeMarkerRunner();
    const result = await deploy(model, lab.topology, { run, labDir: '/tmp/labconfig-test' });

    expect(result.aborted).toBeUndefined();
    expect(result.deployed).toBeDefined();
    expect(result.deployed?.length).toBeGreaterThan(0);

    const ns1Entry = result.deployed?.find((d) => d.serverId === 'ns1');
    expect(ns1Entry).toBeDefined();
    expect(ns1Entry?.ok).toBe(true);

    const deployScript = scripts.find((s) => s.includes('containerlab deploy'));
    expect(deployScript).toBeDefined();
    // Config written to the NODE-named dir (topology bind-mount target), not
    // the model server id's `configs/srv-.../` dir.
    expect(deployScript).toContain('configs/ns1/');
    expect(deployScript).not.toContain('configs/srv-' + lab.id + '-ns1/');
    // Container keyed on the node name, not the model server id.
    expect(deployScript).toContain('clab-labconfig-test-ns1');
  });
});

describe('deployEngine legacy id===nodeName path', () => {
  const dummyConfig: Configuration = {
    id: 'cfg-legacy',
    name: 'cfg-legacy',
    isActive: true,
    createdFromTemplateId: null,
    createdAt: '2026-08-15T00:00:00Z',
    updatedAt: '2026-08-15T00:00:00Z',
    counts: { views: 0, zones: 0, records: 0, servers: 1 },
  };

  function legacyModel(): ConfigModel {
    return {
      configuration: dummyConfig,
      views: [],
      zones: [],
      records: [],
      servers: [{ id: 'auth', name: 'auth' }],
      roles: [],
      options: [],
    };
  }

  const legacyTopology: TopologyModel = {
    name: 'legacy-test',
    nodes: [{ name: 'auth', kind: 'linux', image: 'dnsnode:1.0' }],
    links: [],
  };

  it('a legacy server whose id IS the node name still deploys under configs/<id>/', async () => {
    const { run, scripts } = makeMarkerRunner();

    const result = await deploy(legacyModel(), legacyTopology, {
      run,
      labDir: '/tmp/legacy-test',
    });

    expect(result.aborted).toBeUndefined();
    const authEntry = result.deployed?.find((d) => d.serverId === 'auth');
    expect(authEntry).toBeDefined();
    expect(authEntry?.ok).toBe(true);

    const deployScript = scripts.find((s) => s.includes('containerlab deploy'));
    expect(deployScript).toBeDefined();
    expect(deployScript).toContain('configs/auth/');
    expect(deployScript).toContain('clab-legacy-test-auth');
  });
});
