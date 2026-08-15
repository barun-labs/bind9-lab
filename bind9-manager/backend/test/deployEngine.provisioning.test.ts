import { describe, it, expect } from 'vitest';
import type { ConfigModel, Configuration, View, Zone } from '../src/config-engine/model';
import type { TopologyModel } from '../src/config-engine/topology';
import { deploy, type Runner } from '../src/server/deployEngine';
import { shellQuote } from '../src/config-engine/shellQuote';

function makeRunner(
  reply: (script: string) => { code: number; stdout: string; stderr: string },
): { run: Runner; scripts: string[] } {
  const scripts: string[] = [];
  const run: Runner = async (script) => {
    scripts.push(script);
    return reply(script);
  };
  return { run, scripts };
}

const ok = { code: 0, stdout: 'OK', stderr: '' };

const dummyConfig: Configuration = {
  id: 'cfg-prov',
  name: 'cfg-prov',
  isActive: true,
  createdFromTemplateId: null,
  createdAt: '2026-08-15T00:00:00Z',
  updatedAt: '2026-08-15T00:00:00Z',
  counts: { views: 1, zones: 1, records: 0, servers: 1 },
};

const view: View = {
  id: 'view-1',
  configurationId: 'cfg-prov',
  name: 'default',
  order: 1,
  matchClients: ['any'],
  zoneCount: 1,
};

const zone: Zone = {
  id: 'zone-1',
  configurationId: 'cfg-prov',
  viewId: 'view-1',
  name: 'test',
  type: 'PRIMARY',
  soa: {
    primaryNs: 'ns.test.',
    adminEmail: 'hostmaster.test.',
    serial: 1,
    refresh: 3600,
    retry: 1800,
    expire: 604800,
    minimum: 86400,
  },
  recordCount: 0,
  syncState: 'SYNCED',
};

function provModel(): ConfigModel {
  return {
    configuration: dummyConfig,
    views: [view],
    zones: [zone],
    records: [],
    servers: [{ id: 'auth' }],
    roles: [{ serverId: 'auth', zoneId: 'zone-1', role: 'PRIMARY' }],
    options: [],
  };
}

function provTopology(name: string): TopologyModel {
  return {
    name,
    nodes: [
      {
        name: 'router',
        kind: 'linux',
        image: 'dnsnode:1.0',
        interfaces: [
          { name: 'eth1', address: '10.60.1.1/24' },
          { name: 'eth2', address: '10.60.2.1/24' },
        ],
        ipForward: true,
      },
      {
        name: 'auth',
        kind: 'linux',
        image: 'dnsnode:1.0',
        interfaces: [{ name: 'eth1', address: '10.60.2.30/24' }],
        defaultVia: '10.60.2.1',
      },
      { name: 'seg-b', kind: 'bridge' },
    ],
    links: [
      { endpoints: ['router:eth2', 'seg-b:rt-eth2'] },
      { endpoints: ['auth:eth1', 'seg-b:auth-eth1'] },
    ],
  };
}

describe('deployEngine host bridge setup', () => {
  it('creates and brings up each bridge node before containerlab deploy runs', async () => {
    const { run, scripts } = makeRunner(() => ok);

    await deploy(provModel(), provTopology('bind9mgr-prov'), { run, labDir: '/tmp/prov' });

    const deployScript = scripts.find((s) => s.includes('containerlab deploy')) as string;
    const lines = deployScript.split('\n');

    const bridgeIdx = lines.findIndex((l) => l.includes("sudo ip link add 'seg-b' type bridge"));
    const upIdx = lines.findIndex((l) => l === `sudo ip link set 'seg-b' up`);
    const clabIdx = lines.findIndex((l) => l.includes('containerlab deploy'));

    expect(bridgeIdx).toBeGreaterThanOrEqual(0);
    expect(upIdx).toBeGreaterThan(bridgeIdx);
    expect(clabIdx).toBeGreaterThan(upIdx);
  });

  it('does not attempt bridge setup for linux nodes', async () => {
    const { run, scripts } = makeRunner(() => ok);

    await deploy(provModel(), provTopology('bind9mgr-prov'), { run, labDir: '/tmp/prov' });

    const deployScript = scripts.find((s) => s.includes('containerlab deploy')) as string;
    expect(deployScript).not.toContain(`sudo ip link add 'router'`);
    expect(deployScript).not.toContain(`sudo ip link add 'auth'`);
  });
});

describe('deployEngine data-plane provisioning', () => {
  it('provisions interface addresses, brings links up, and enables ip_forward on the router', async () => {
    const { run, scripts } = makeRunner(() => ok);

    const result = await deploy(provModel(), provTopology('bind9mgr-prov'), {
      run,
      labDir: '/tmp/prov',
    });

    expect(result.aborted).toBeUndefined();
    expect(result.deployed).toBeDefined();

    const deployScript = scripts.find((s) => s.includes('containerlab deploy'));
    expect(deployScript).toBeDefined();
    const script = deployScript as string;

    expect(script).toContain(
      `docker exec 'clab-bind9mgr-prov-router' ip addr replace '10.60.1.1/24' dev 'eth1'`,
    );
    expect(script).toContain(`docker exec 'clab-bind9mgr-prov-router' ip link set 'eth1' up`);
    expect(script).toContain(
      `docker exec 'clab-bind9mgr-prov-router' ip addr replace '10.60.2.1/24' dev 'eth2'`,
    );
    expect(script).toContain(
      `docker exec 'clab-bind9mgr-prov-router' sysctl -w net.ipv4.ip_forward=1`,
    );
  });

  it('provisions a DNS node interface and its default route via the router', async () => {
    const { run, scripts } = makeRunner(() => ok);

    await deploy(provModel(), provTopology('bind9mgr-prov'), { run, labDir: '/tmp/prov' });

    const deployScript = scripts.find((s) => s.includes('containerlab deploy')) as string;

    expect(deployScript).toContain(
      `docker exec 'clab-bind9mgr-prov-auth' ip addr replace '10.60.2.30/24' dev 'eth1'`,
    );
    expect(deployScript).toContain(
      `docker exec 'clab-bind9mgr-prov-auth' ip route replace default via '10.60.2.1'`,
    );
  });

  it('provisioning runs after containerlab deploy and before named bring-up', async () => {
    const { run, scripts } = makeRunner(() => ok);

    await deploy(provModel(), provTopology('bind9mgr-prov'), { run, labDir: '/tmp/prov' });

    const deployScript = scripts.find((s) => s.includes('containerlab deploy')) as string;
    const lines = deployScript.split('\n');

    const clabIdx = lines.findIndex((l) => l.includes('containerlab deploy'));
    const ipForwardIdx = lines.findIndex((l) => l.includes('net.ipv4.ip_forward=1'));
    const namedBringUpIdx = lines.findIndex((l) => l.includes('__BIND9MGR_NODE_BEGIN__'));

    expect(clabIdx).toBeGreaterThanOrEqual(0);
    expect(ipForwardIdx).toBeGreaterThan(clabIdx);
    expect(namedBringUpIdx).toBeGreaterThan(ipForwardIdx);
  });

  it('bridge-only nodes and nodes without addressing info get no provisioning commands', async () => {
    const { run, scripts } = makeRunner(() => ok);

    await deploy(provModel(), provTopology('bind9mgr-prov'), { run, labDir: '/tmp/prov' });

    const deployScript = scripts.find((s) => s.includes('containerlab deploy')) as string;
    expect(deployScript).not.toContain(`docker exec 'clab-bind9mgr-prov-seg-b'`);
  });

  it('pre-flight validate gate still runs before any provisioning or containerlab deploy', async () => {
    const { run, scripts } = makeRunner((script) =>
      script.includes('named-checkconf') ? { code: 1, stdout: '', stderr: 'broken' } : ok,
    );

    const result = await deploy(provModel(), provTopology('bind9mgr-prov'), {
      run,
      labDir: '/tmp/prov',
    });

    expect(result.aborted).toBe('pre-flight failed');
    expect(scripts.some((s) => s.includes('containerlab deploy'))).toBe(false);
    expect(scripts.some((s) => s.includes('ip addr replace'))).toBe(false);
  });

  it('reserved-name guard still blocks provisioning topology names', async () => {
    const { run, scripts } = makeRunner(() => ok);

    const result = await deploy(provModel(), provTopology('dns'), {
      run,
      labDir: '/tmp/prov',
    });

    expect(result.aborted).toBe('refusing to target a reserved/production lab name: dns');
    expect(scripts).toHaveLength(0);
  });

  it('all interpolations are shell-quoted even with a single quote in a node name', async () => {
    // A single quote is the one character shellQuote must escape: unescaped,
    // it would close the quoted container name early and let the rest of
    // the payload execute as a second shell command.
    const payload = `r'; rm -rf /tmp/pwned; echo '`;
    const topo: TopologyModel = {
      name: 'bind9mgr-inj',
      nodes: [
        {
          name: payload,
          kind: 'linux',
          image: 'dnsnode:1.0',
          interfaces: [{ name: 'eth1', address: '10.60.1.1/24' }],
          ipForward: true,
        },
      ],
      links: [],
    };
    const model: ConfigModel = {
      configuration: dummyConfig,
      views: [],
      zones: [],
      records: [],
      servers: [],
      roles: [],
      options: [],
    };

    const { run, scripts } = makeRunner(() => ok);
    await deploy(model, topo, { run, labDir: '/tmp/inj2' });

    const deployScript = scripts.find((s) => s.includes('containerlab deploy')) as string;

    // The raw unescaped payload must never appear verbatim (that would mean
    // shellQuote was bypassed and the quote closed early).
    expect(deployScript).not.toContain(`'${payload}'`);

    // The properly escaped, single-quoted form must be exactly what's used.
    const container = `clab-bind9mgr-inj-${payload}`;
    expect(deployScript).toContain(
      `docker exec ${shellQuote(container)} ip addr replace ${shellQuote('10.60.1.1/24')} dev ${shellQuote('eth1')}`,
    );
    expect(deployScript).toContain(
      `docker exec ${shellQuote(container)} sysctl -w net.ipv4.ip_forward=1`,
    );
  });
});
