import { describe, it, expect } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import {
  createLab,
  getLab,
  isDnsLab,
  setLabLifecycle,
} from '../src/server/labStore';
import { startDeployJob, type DeployJob } from '../src/server/deployJobs';
import type { Runner } from '../src/server/deployEngine';
import type { TopologyModel } from '../src/config-engine/topology';

const dnsTopology: TopologyModel = {
  name: 'mylab',
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

const nonDnsTopology: TopologyModel = {
  name: 'routerlab',
  mgmtSubnet: '10.71.0.0/24',
  nodes: [
    {
      name: 'r1',
      kind: 'linux',
      intent: 'router',
      image: 'dnsnode:1.0',
      mgmtIpv4: '10.71.0.1',
    },
  ],
  links: [],
};

function openTestDb(): Database.Database {
  return openDb(':memory:');
}

describe('lab lifecycle', () => {
  it('a new lab starts NEVER_DEPLOYED', () => {
    const db = openTestDb();
    const lab = createLab(db, {
      name: 'mylab',
      configurationId: 'dns-lab',
      topology: dnsTopology,
    });
    expect(lab.lifecycleState).toBe('NEVER_DEPLOYED');
    expect(getLab(db, lab.id)!.lifecycleState).toBe('NEVER_DEPLOYED');
  });

  it('setLabLifecycle(DEPLOYED) sets lifecycleState + lastDeployedAt and persists', () => {
    const db = openTestDb();
    const lab = createLab(db, {
      name: 'mylab',
      configurationId: 'dns-lab',
      topology: dnsTopology,
    });

    const updated = setLabLifecycle(db, lab.id, 'DEPLOYED');
    expect(updated).not.toBeNull();
    expect(updated!.lifecycleState).toBe('DEPLOYED');
    expect(updated!.lastDeployedAt).toBeDefined();

    const reread = getLab(db, lab.id);
    expect(reread!.lifecycleState).toBe('DEPLOYED');
    expect(reread!.lastDeployedAt).toBeDefined();
  });

  it('setLabLifecycle(DESTROYED) sets lastDestroyedAt and persists', () => {
    const db = openTestDb();
    const lab = createLab(db, {
      name: 'mylab',
      configurationId: 'dns-lab',
      topology: dnsTopology,
    });

    setLabLifecycle(db, lab.id, 'DEPLOYED');
    const updated = setLabLifecycle(db, lab.id, 'DESTROYED');
    expect(updated).not.toBeNull();
    expect(updated!.lifecycleState).toBe('DESTROYED');
    expect(updated!.lastDestroyedAt).toBeDefined();

    const reread = getLab(db, lab.id);
    expect(reread!.lifecycleState).toBe('DESTROYED');
    expect(reread!.lastDestroyedAt).toBeDefined();
  });

  it('setLabLifecycle returns null for a lab that does not exist', () => {
    const db = openTestDb();
    expect(setLabLifecycle(db, 'no-such-lab', 'DEPLOYED')).toBeNull();
  });

  it('isDnsLab is true for a topology with a bind node', () => {
    const lab = {
      id: 'lab-1',
      name: 'mylab',
      configurationId: 'dns-lab',
      topology: dnsTopology,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(isDnsLab(lab)).toBe(true);
  });

  it('isDnsLab is false for a topology with only a router/non-bind node', () => {
    const lab = {
      id: 'lab-2',
      name: 'routerlab',
      configurationId: 'dns-lab',
      topology: nonDnsTopology,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(isDnsLab(lab)).toBe(false);
  });

  it('a deploy job that SUCCEEDED marks the lab DEPLOYED with lastDeployedAt', async () => {
    const db = openTestDb();
    const lab = createLab(db, {
      name: 'mylab',
      configurationId: 'dns-lab',
      topology: dnsTopology,
    });

    const mockRunner: Runner = async (script: string) => {
      if (script.includes('containerlab deploy')) {
        let out = '';
        const matches = script.matchAll(/NODE_ID='([^']+)'/g);
        for (const match of matches) {
          out += `__BIND9MGR_NODE_BEGIN__ ${match[1]}\nOK\n__BIND9MGR_NODE_END__ ${match[1]} 0\n`;
        }
        return { code: 0, stdout: out || 'OK', stderr: '' };
      }
      if (script.includes('containerlab inspect')) {
        return {
          code: 0,
          stdout: JSON.stringify({
            mylab: [
              {
                name: 'clab-mylab-ns1',
                container_id: 'runtime-abc123',
                state: 'running',
                status: 'Up 1 minute',
                ipv4_address: '10.70.0.11/24',
              },
            ],
          }),
          stderr: '',
        };
      }
      return { code: 0, stdout: 'OK', stderr: '' };
    };

    const job = startDeployJob(db, lab, { run: mockRunner, labDir: '/home/lun/mylab' });

    let finished: DeployJob | null = null;
    for (let i = 0; i < 50; i++) {
      const row = db
        .prepare('SELECT data FROM deploy_jobs WHERE id = ?')
        .get(job.id) as { data: string } | undefined;
      if (row) {
        const parsed = JSON.parse(row.data) as DeployJob;
        if (parsed.status === 'SUCCEEDED' || parsed.status === 'FAILED') {
          finished = parsed;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 10));
    }

    expect(finished).not.toBeNull();
    expect(finished!.status).toBe('SUCCEEDED');

    const reread = getLab(db, lab.id);
    expect(reread!.lifecycleState).toBe('DEPLOYED');
    expect(reread!.lastDeployedAt).toBeDefined();
  });
});
