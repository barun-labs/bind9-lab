import { describe, it, expect } from 'vitest';
import { anycastModel } from '../src/fixtures/anycastModel';
import { anycastTopology } from '../src/fixtures/anycastTopology';
import type { ConfigModel } from '../src/config-engine/model';
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

function brokenForwarderModel(): ConfigModel {
  return {
    ...anycastModel,
    options: anycastModel.options.map((opt) => {
      if (opt.scopeType === 'VIEW' && opt.scopeId === 'view-cache' && opt.key === 'forwarders') {
        return { ...opt, value: ['not-an-ip'] };
      }
      return opt;
    }),
  };
}

describe('deployEngine', () => {
  it('pre-flight gate aborts and never builds a deploy command on invalid config', async () => {
    const { run, scripts } = makeRunner((script) =>
      script.includes('named-checkconf')
        ? { code: 1, stdout: '', stderr: 'CNAME and other data' }
        : ok,
    );

    const result = await deploy(
      brokenForwarderModel(),
      { ...anycastTopology, name: 'lab-anycast' },
      { run, labDir: '/tmp/x' },
    );

    expect(result.aborted).toBe('pre-flight failed');
    expect(result.validated.some((entry) => !entry.ok)).toBe(true);
    expect(scripts.some((script) => script.includes('containerlab deploy'))).toBe(false);
  });

  it('dryRun returns a plan and does not execute a deploy', async () => {
    const { run, scripts } = makeRunner(() => ok);

    const result = await deploy(
      anycastModel,
      { ...anycastTopology, name: 'lab-anycast' },
      { run, labDir: '/tmp/x', dryRun: true },
    );

    expect(result.aborted).toBeUndefined();
    expect(result.validated.length).toBe(anycastModel.servers.length);
    expect(result.validated.every((entry) => entry.ok)).toBe(true);

    expect(result.plan).toBeDefined();
    const plan = result.plan as string[];
    expect(plan.some((step) => step.includes('containerlab deploy'))).toBe(true);

    const reloadSteps = plan.filter((step) => step.includes('rndc reload'));
    expect(reloadSteps.length).toBeGreaterThan(0);
    expect(reloadSteps.every((step) => step.startsWith('docker exec clab-lab-anycast-'))).toBe(
      true,
    );

    expect(scripts.some((script) => script.includes('containerlab deploy'))).toBe(false);
  });

  it('deploy script uses topology.name as the container prefix, never the production lab', async () => {
    const renamed: TopologyModel = { ...anycastTopology, name: 'bind9mgr-demo' };
    const { run, scripts } = makeRunner(() => ok);

    const result = await deploy(anycastModel, renamed, {
      run,
      labDir: '/tmp/x',
    });

    expect(result.deployed).toBeDefined();
    expect(result.deployed?.length).toBeGreaterThan(0);

    const deployScript = scripts.find((script) => script.includes('containerlab deploy'));
    expect(deployScript).toBeDefined();
    expect(deployScript).toContain('docker exec');
    expect(deployScript).toContain(`'clab-bind9mgr-demo-`);

    // Never reference the production `dns` lab as a container prefix.
    for (const script of scripts) {
      expect(script).not.toContain(`docker exec 'dns-`);
      expect(script).not.toContain('docker exec dns-');
    }
  });
});
