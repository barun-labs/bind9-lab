import { describe, it, expect } from 'vitest';
import { anycastModel } from '../src/fixtures/anycastModel';
import { anycastTopology } from '../src/fixtures/anycastTopology';
import type { ConfigModel, Configuration } from '../src/config-engine/model';
import type { TopologyModel } from '../src/config-engine/topology';
import { deploy, type Runner } from '../src/server/deployEngine';

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

function minimalConfiguration(id: string, servers: number, zones = 1, views = 1): Configuration {
  return {
    id,
    name: id,
    isActive: true,
    createdFromTemplateId: null,
    createdAt: '2026-08-15T00:00:00Z',
    updatedAt: '2026-08-15T00:00:00Z',
    counts: { views, zones, records: 0, servers },
  };
}

// Two servers: srv-bad is PRIMARY for a zone whose checkzone fails, srv-good has no zones.
function twoServerModel(): ConfigModel {
  return {
    configuration: minimalConfiguration('cfg-two', 2),
    servers: [{ id: 'srv-bad' }, { id: 'srv-good' }],
    views: [
      {
        id: 'view-auth',
        configurationId: 'cfg-two',
        name: 'authoritative',
        order: 1,
        matchClients: ['any'],
        zoneCount: 1,
      },
    ],
    zones: [
      {
        id: 'zone-bad',
        configurationId: 'cfg-two',
        viewId: 'view-auth',
        name: 'badzone.test',
        type: 'PRIMARY',
        soa: {
          primaryNs: 'ns1.badzone.test.',
          adminEmail: 'hostmaster.badzone.test.',
          serial: 1,
          refresh: 3600,
          retry: 1800,
          expire: 604800,
          minimum: 86400,
        },
        recordCount: 0,
        syncState: 'SYNCED',
      },
    ],
    records: [],
    roles: [{ serverId: 'srv-bad', zoneId: 'zone-bad', role: 'PRIMARY' }],
    options: [],
  };
}

const twoTopology: TopologyModel = {
  name: 'lab-two',
  nodes: [
    { name: 'srv-bad', kind: 'linux', image: 'dnsnode:1.0' },
    { name: 'srv-good', kind: 'linux', image: 'dnsnode:1.0' },
  ],
  links: [],
};

function cnameAtApexModel(): ConfigModel {
  return {
    ...anycastModel,
    records: [
      ...anycastModel.records,
      {
        id: 'rec-apex-cname',
        zoneId: 'zone-lab-test',
        name: '@',
        type: 'CNAME',
        ttl: 86400,
        rdata: { target: 'www.lab.test.' },
        disabled: false,
        syncState: 'SYNCED',
        issue: null,
      },
    ],
  };
}

function forwarderNotIpModel(): ConfigModel {
  return {
    ...anycastModel,
    options: anycastModel.options.map((opt) =>
      opt.scopeType === 'VIEW' && opt.scopeId === 'view-cache' && opt.key === 'forwarders'
        ? { ...opt, value: ['not-an-ip'] }
        : opt,
    ),
  };
}

describe('deployEngine adversarial', () => {
  it('gate blocks several broken models (CNAME at apex, bad forwarder, checkzone failure)', async () => {
    const broken = [
      { name: 'CNAME at apex', model: cnameAtApexModel(), failCheckconf: true },
      { name: 'forwarder not-an-ip', model: forwarderNotIpModel(), failCheckconf: true },
      { name: 'zone fails checkzone', model: anycastModel, failCheckconf: false },
    ];

    for (const { name, model, failCheckconf } of broken) {
      const { run, scripts } = makeRunner((script) => {
        if (failCheckconf && script.includes('named-checkconf')) {
          return { code: 1, stdout: '', stderr: `${name}: rejected` };
        }
        if (!failCheckconf && script.includes('named-checkzone')) {
          return { code: 1, stdout: '', stderr: 'zone badzone.test/IN: has no NS records' };
        }
        return ok;
      });

      const result = await deploy(
        model,
        { ...anycastTopology, name: 'lab-anycast' },
        { run, labDir: '/tmp/gate', dryRun: false },
      );

      expect(result.aborted, name).toBe('pre-flight failed');
      expect(result.validated.some((v) => !v.ok), name).toBe(true);
      expect(scripts.some((s) => s.includes('containerlab deploy')), name).toBe(false);
    }
  });

  it('no partial deploy: one invalid server blocks the valid ones too', async () => {
    const { run, scripts } = makeRunner((script) =>
      script.includes(`named-checkzone 'badzone.test'`)
        ? { code: 1, stdout: '', stderr: 'zone badzone.test/IN: has no NS records' }
        : ok,
    );

    const result = await deploy(twoServerModel(), twoTopology, {
      run,
      labDir: '/tmp/two',
      dryRun: false,
    });

    expect(result.aborted).toBe('pre-flight failed');

    const bad = result.validated.find((v) => v.serverId === 'srv-bad');
    const good = result.validated.find((v) => v.serverId === 'srv-good');
    expect(bad?.ok).toBe(false);
    expect(good?.ok).toBe(true);

    // Even though srv-good validated clean, nothing may deploy.
    expect(scripts.some((s) => s.includes('containerlab deploy'))).toBe(false);
  });

  it('dryRun never deploys', async () => {
    const { run, scripts } = makeRunner(() => ok);

    const result = await deploy(
      anycastModel,
      { ...anycastTopology, name: 'lab-anycast' },
      { run, labDir: '/tmp/dry', dryRun: true },
    );

    expect(result.aborted).toBeUndefined();
    expect(result.plan).toBeDefined();
    expect((result.plan as string[]).some((s) => s.includes('containerlab deploy'))).toBe(true);
    expect(scripts.some((s) => s.includes('containerlab deploy'))).toBe(false);
  });

  it('deploy script derives names from topology.name, never the production dns lab', async () => {
    const renamed: TopologyModel = { ...anycastTopology, name: 'bind9mgr-demo' };
    const { run, scripts } = makeRunner(() => ok);

    const result = await deploy(anycastModel, renamed, {
      run,
      labDir: '/tmp/name',
    });

    expect(result.deployed).toBeDefined();

    const deployScript = scripts.find((s) => s.includes('containerlab deploy'));
    expect(deployScript).toBeDefined();
    expect(deployScript).toContain('bind9mgr-demo');

    for (const script of scripts) {
      expect(script).not.toContain('clab-dns-');
      expect(script).not.toContain(' dns ');
    }
  });

  it('refuses reserved/production lab names and never runs a deploy', async () => {
    for (const name of ['dns', 'clab-dns', 'clab-other']) {
      const { run, scripts } = makeRunner(() => ok);

      const result = await deploy(anycastModel, { ...anycastTopology, name }, {
        run,
        labDir: '/tmp/reserved',
      });

      expect(result.aborted).toBe(`refusing to target a reserved/production lab name: ${name}`);
      expect(result.validated).toEqual([]);
      expect(scripts).toHaveLength(0);
    }
  });

  it('labDir with shell metacharacters is single-quoted in the built script', async () => {
    const labDir = '/tmp/lab; rm -rf /tmp/pwned';
    const { run, scripts } = makeRunner(() => ok);

    await deploy(anycastModel, { ...anycastTopology, name: 'injsafe' }, {
      run,
      labDir,
    });

    const deployScript = scripts.find((s) => s.includes('containerlab deploy'));
    expect(deployScript).toBeDefined();

    // Quoted form must be present; unquoted form would execute `; rm -rf` as a second command.
    expect(deployScript).toContain(`mkdir -p '${labDir}'`);
    expect(deployScript).not.toContain(`mkdir -p ${labDir}`);
  });

  it('node name with shell metacharacters must be quoted in every interpolation', async () => {
    const payload = 'srv"; rm -rf /tmp/pwned; echo "';
    const model: ConfigModel = {
      configuration: minimalConfiguration('cfg-inj', 1, 0, 0),
      servers: [{ id: payload }],
      views: [],
      zones: [],
      records: [],
      roles: [],
      options: [],
    };
    const topology: TopologyModel = {
      name: 'injlab',
      nodes: [{ name: payload, kind: 'linux', image: 'dnsnode:1.0' }],
      links: [],
    };

    const { run, scripts } = makeRunner(() => ok);

    await deploy(model, topology, { run, labDir: '/tmp/inj' });

    const deployScript = scripts.find((s) => s.includes('containerlab deploy'));
    expect(deployScript).toBeDefined();

    // The docker exec lines quote the container, but the echo markers interpolate the
    // serverId into a double-quoted string with no shellQuote. A node name that closes
    // the double quote turns `; rm -rf ...` into a real command.
    const lines = (deployScript as string).split('\n');
    const markerLines = lines.filter(
      (line) =>
        line.includes('__BIND9MGR_NODE_BEGIN__') || line.includes('__BIND9MGR_NODE_END__'),
    );
    expect(markerLines.length).toBeGreaterThan(0);
    for (const line of markerLines) {
      expect(line).not.toContain('; rm -rf /tmp/pwned;');
    }
  });

  it('non-zero runner code for a deploy step surfaces as ok:false, not silent success', async () => {
    const servers = anycastModel.servers.map((s) => s.id);
    const failingServer = 'bc-rmaster';

    const { run } = makeRunner((script) => {
      if (!script.includes('containerlab deploy')) return ok;

      const lines: string[] = [];
      for (const id of servers) {
        lines.push(`__BIND9MGR_NODE_BEGIN__ ${id}`);
        lines.push('rndc: reload failed: connection refused');
        const rc = id === failingServer ? '1' : '0';
        lines.push(`__BIND9MGR_NODE_END__ ${id} ${rc}`);
      }
      return { code: 0, stdout: lines.join('\n') + '\n', stderr: '' };
    });

    const result = await deploy(
      anycastModel,
      { ...anycastTopology, name: 'lab-anycast' },
      { run, labDir: '/tmp/surface' },
    );

    const deployed = result.deployed as { serverId: string; ok: boolean }[];
    const failed = deployed.find((d) => d.serverId === failingServer);
    const passed = deployed.find((d) => d.serverId === 'bc-cache1');
    expect(failed?.ok).toBe(false);
    expect(passed?.ok).toBe(true);
  });

  it('top-level runner failure (empty stdout) never reports ok:true', async () => {
    const { run } = makeRunner((script) =>
      script.includes('containerlab deploy')
        ? { code: 1, stdout: '', stderr: 'containerlab: command not found' }
        : ok,
    );

    const result = await deploy(
      anycastModel,
      { ...anycastTopology, name: 'lab-anycast' },
      { run, labDir: '/tmp/crash' },
    );

    expect(result.deployed).toBeDefined();
    expect(result.deployed?.length).toBeGreaterThan(0);
    expect(result.deployed?.every((d) => d.ok === false)).toBe(true);
  });
});
