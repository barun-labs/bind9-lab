import { describe, it, expect } from 'vitest';
import { snapshot, parseDockerStats } from '../src/server/telemetry';
import type { Runner } from '../src/server/deployEngine';
import type { Lab } from '../src/server/labStore';
import type { TopologyModel } from '../src/config-engine/topology';

const topology: TopologyModel = {
  name: 'mylab',
  mgmtSubnet: '10.70.0.0/24',
  nodes: [
    {
      name: 'ns1',
      kind: 'linux',
      intent: 'bind',
      image: 'dnsnode:1.0',
      mgmtIpv4: '10.70.0.11',
    },
    {
      name: 'cache',
      kind: 'linux',
      intent: 'bind',
      image: 'dnsnode:1.0',
      mgmtIpv4: '10.70.0.12',
    },
  ],
  links: [],
};

const lab: Lab = {
  id: 'lab-1',
  name: 'mylab',
  configurationId: 'dns-lab',
  topology,
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
};

// `cache` is deliberately absent — only ns1 has a matching inspect entry.
const INSPECT_JSON = JSON.stringify({
  mylab: [
    {
      name: 'clab-mylab-ns1',
      container_id: 'abc123',
      state: 'running',
      status: 'Up 2 hours',
      ipv4_address: '10.70.0.11/24',
    },
  ],
});

// One line for the lab's own ns1 container, one for a container that
// belongs to a completely different lab — the latter must never surface.
const STATS_NDJSON = [
  JSON.stringify({
    BlockIO: '0B / 0B',
    CPUPerc: '0.15%',
    Container: 'abc123',
    ID: 'abc123',
    MemPerc: '0.63%',
    MemUsage: '12.3MiB / 1.9GiB',
    Name: 'clab-mylab-ns1',
    NetIO: '1.2kB / 0B',
    PIDs: '12',
  }),
  JSON.stringify({
    BlockIO: '0B / 0B',
    CPUPerc: '5.00%',
    Container: 'foreign123',
    ID: 'foreign123',
    MemPerc: '1.00%',
    MemUsage: '50MiB / 1.9GiB',
    Name: 'clab-otherlab-web',
    NetIO: '0B / 0B',
    PIDs: '3',
  }),
].join('\n');

describe('telemetry.snapshot', () => {
  it('joins inspect + stats by exact container name; absent nodes present:false; foreign container dropped', async () => {
    const run: Runner = async (script: string) => {
      if (script.includes('containerlab inspect')) {
        return { code: 0, stdout: INSPECT_JSON, stderr: '' };
      }
      if (script.includes('docker stats')) {
        return { code: 0, stdout: STATS_NDJSON, stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };

    const snap = await snapshot(lab, run, '/home/lun/mylab');

    expect(snap.nodes).toHaveLength(2);

    const ns1 = snap.nodes.find((n) => n.nodeName === 'ns1');
    expect(ns1?.present).toBe(true);
    expect(ns1?.containerName).toBe('clab-mylab-ns1');
    expect(ns1?.containerId).toBe('abc123');
    expect(ns1?.state).toBe('running');
    expect(ns1?.address).toBe('10.70.0.11'); // /NN stripped
    expect(ns1?.cpuPerc).toBe('0.15%');
    expect(ns1?.memUsage).toBe('12.3MiB / 1.9GiB');

    const cache = snap.nodes.find((n) => n.nodeName === 'cache');
    expect(cache?.present).toBe(false);
    expect(cache?.containerName).toBe('clab-mylab-cache');
    expect(cache?.containerId).toBeUndefined();
    expect(cache?.cpuPerc).toBeUndefined();

    // The foreign container's stats row must never surface as a node.
    expect(snap.nodes.some((n) => n.containerName === 'clab-otherlab-web')).toBe(false);
    expect(snap.nodes.find((n) => n.nodeName === 'foreign123')).toBeUndefined();

    expect(snap.runtimeError).toBeUndefined();
    expect(typeof snap.at).toBe('string');
  });

  it('a failed inspect marks every node present:false, sets runtimeError, and never runs docker stats', async () => {
    const executedScripts: string[] = [];
    const run: Runner = async (script: string) => {
      executedScripts.push(script);
      if (script.includes('containerlab inspect')) {
        return { code: 1, stdout: '', stderr: 'connection refused' };
      }
      return { code: 0, stdout: STATS_NDJSON, stderr: '' };
    };

    const snap = await snapshot(lab, run, '/home/lun/mylab');

    expect(snap.nodes).toHaveLength(2);
    expect(snap.nodes.every((n) => n.present === false)).toBe(true);
    expect(snap.runtimeError).toContain('inspect exited 1');
    expect(snap.runtimeError).toContain('connection refused');

    expect(executedScripts.some((s) => s.includes('docker stats'))).toBe(false);
  });
});

describe('telemetry.parseDockerStats', () => {
  it('parses multi-line NDJSON keyed by .Name and skips an unparseable line', () => {
    const ndjson = [
      JSON.stringify({ Name: 'clab-mylab-ns1', CPUPerc: '0.15%' }),
      'not json at all {{{',
      JSON.stringify({ Name: 'clab-mylab-cache', CPUPerc: '1.20%' }),
      '', // blank lines are ignored too
    ].join('\n');

    const parsed = parseDockerStats(ndjson);

    expect(Object.keys(parsed).sort()).toEqual(['clab-mylab-cache', 'clab-mylab-ns1']);
    expect(parsed['clab-mylab-ns1'].CPUPerc).toBe('0.15%');
    expect(parsed['clab-mylab-cache'].CPUPerc).toBe('1.20%');
  });

  it('never throws on garbage input', () => {
    expect(() => parseDockerStats('{{{not json')).not.toThrow();
    expect(parseDockerStats('{{{not json')).toEqual({});
    expect(parseDockerStats('')).toEqual({});
  });
});
