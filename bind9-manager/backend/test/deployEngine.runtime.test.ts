import { describe, it, expect } from 'vitest';
import { anycastModel } from '../src/fixtures/anycastModel';
import { anycastTopology } from '../src/fixtures/anycastTopology';
import { deploy, parseInspect, type Runner } from '../src/server/deployEngine';

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

const inspectJson = JSON.stringify({
  mylab: [
    {
      name: 'clab-mylab-ns1',
      container_id: 'a1b2c3d4e5f6',
      image: 'dnsnode:1.0',
      kind: 'linux',
      state: 'running',
      status: 'Up 2 hours',
      ipv4_address: '10.60.99.30/24',
      ipv6_address: '',
      owner: 'lun',
    },
  ],
});

describe('deployEngine runtime inspect', () => {
  it('populates runtime on a successful deploy', async () => {
    const { run } = makeRunner((script) =>
      script.includes('containerlab inspect')
        ? { code: 0, stdout: inspectJson, stderr: '' }
        : ok,
    );

    const result = await deploy(anycastModel, { ...anycastTopology, name: 'mylab' }, {
      run,
      labDir: '/tmp/x',
    });

    expect(result.runtime).toBeDefined();
    expect(result.runtime).toHaveLength(1);
    expect(result.runtime?.[0]).toMatchObject({
      name: 'clab-mylab-ns1',
      containerId: 'a1b2c3d4e5f6',
      ipv4Address: '10.60.99.30/24',
      state: 'running',
    });
    expect(result.runtimeError).toBeUndefined();
  });

  it('inspect failure never fails the deploy', async () => {
    const { run } = makeRunner((script) =>
      script.includes('containerlab inspect')
        ? { code: 1, stdout: '', stderr: 'no such lab' }
        : ok,
    );

    const result = await deploy(anycastModel, { ...anycastTopology, name: 'mylab' }, {
      run,
      labDir: '/tmp/x',
    });

    expect(result.deployed).toBeDefined();
    expect(result.deployed?.length).toBeGreaterThan(0);
    expect(result.runtime).toBeUndefined();
    expect(result.runtimeError).toContain('inspect exited 1');
  });

  it('parseInspect maps snake_case records', () => {
    const nodes = parseInspect(inspectJson);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toEqual({
      name: 'clab-mylab-ns1',
      containerId: 'a1b2c3d4e5f6',
      image: 'dnsnode:1.0',
      state: 'running',
      status: 'Up 2 hours',
      ipv4Address: '10.60.99.30/24',
    });
  });

  it('parseInspect tolerates a junk log line before the JSON', () => {
    const nodes = parseInspect(`WARN: some log line\n${inspectJson}`);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].name).toBe('clab-mylab-ns1');
  });

  it('parseInspect returns [] for non-JSON and empty objects', () => {
    expect(parseInspect('not json at all')).toEqual([]);
    expect(parseInspect('{}')).toEqual([]);
  });

  it('does not run inspect on dryRun', async () => {
    const { run, scripts } = makeRunner(() => ok);

    const result = await deploy(anycastModel, { ...anycastTopology, name: 'mylab' }, {
      run,
      labDir: '/tmp/x',
      dryRun: true,
    });

    expect(scripts.some((script) => script.includes('containerlab inspect'))).toBe(false);
    expect(result.runtime).toBeUndefined();
    expect(result.runtimeError).toBeUndefined();
  });
});
