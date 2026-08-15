/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import {
  generateServerConfig,
  validateConfig,
  type Runner,
  type ConfigModel,
} from '../src/config-engine';

const sshRun: Runner = (script: string) =>
  new Promise((res) => {
    const p = spawn('ssh', ['clab-mini', 'bash', '-s']);
    let out = '';
    let err = '';
    p.stdout.on('data', (d: Buffer | string) => (out += d.toString()));
    p.stderr.on('data', (d: Buffer | string) => (err += d.toString()));
    p.on('error', (e: Error) => res({ code: 1, stdout: out, stderr: err || e.message }));
    p.on('close', (code: number | null) => res({ code: code ?? 1, stdout: out, stderr: err }));
    p.stdin.write(script);
    p.stdin.end();
  });

describe('validateConfig with clab-mini dnsnode runner', () => {
  const validModel: ConfigModel = {
    configuration: {
      id: 'cfg-1',
      name: 'lab-test-config',
      isActive: true,
      createdFromTemplateId: null,
      createdAt: '2026-08-15T00:00:00Z',
      updatedAt: '2026-08-15T00:00:00Z',
      counts: { views: 1, zones: 1, records: 3, servers: 1 },
    },
    servers: [
      {
        id: 'srv-1',
        name: 'ns1.lab.test',
      },
    ],
    views: [
      {
        id: 'view-1',
        configurationId: 'cfg-1',
        name: 'default',
        order: 1,
        matchClients: ['any'],
        zoneCount: 1,
      },
    ],
    zones: [
      {
        id: 'zone-1',
        configurationId: 'cfg-1',
        viewId: 'view-1',
        name: 'lab.test',
        type: 'PRIMARY',
        soa: {
          primaryNs: 'ns1.lab.test.',
          adminEmail: 'hostmaster.lab.test.',
          serial: 2026081401,
          refresh: 3600,
          retry: 900,
          expire: 604800,
          minimum: 300,
        },
        recordCount: 3,
        syncState: 'SYNCED',
      },
    ],
    records: [
      {
        id: 'rec-1',
        zoneId: 'zone-1',
        name: '@',
        type: 'NS',
        ttl: 3600,
        rdata: { target: 'ns1.lab.test.' },
        disabled: false,
        syncState: 'SYNCED',
        issue: null,
      },
      {
        id: 'rec-2',
        zoneId: 'zone-1',
        name: 'ns1',
        type: 'A',
        ttl: 300,
        rdata: { address: '10.10.10.1' },
        disabled: false,
        syncState: 'SYNCED',
        issue: null,
      },
      {
        id: 'rec-3',
        zoneId: 'zone-1',
        name: 'www',
        type: 'A',
        ttl: 300,
        rdata: { address: '10.10.10.10' },
        disabled: false,
        syncState: 'SYNCED',
        issue: null,
      },
    ],
    roles: [
      {
        serverId: 'srv-1',
        zoneId: 'zone-1',
        role: 'PRIMARY',
      },
    ],
    options: [],
  };

  it('generates server config files correctly', () => {
    const files = generateServerConfig(validModel, 'srv-1');
    expect(files['named.conf']).toBeDefined();
    expect(files['zones/db.lab.test']).toBeDefined();
    expect(files['named.conf']).toContain('zone "lab.test"');
    expect(files['zones/db.lab.test']).toContain('$ORIGIN lab.test.');
    expect(files['zones/db.lab.test']).toContain('www');
  });

  it('validates a valid server config via ssh on clab-mini', async () => {
    const files = generateServerConfig(validModel, 'srv-1');
    const result = await validateConfig(files, sshRun);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('detects invalid configuration syntax via checkconf', async () => {
    const badFiles: Record<string, string> = {
      'named.conf': 'options { bad_option_xyz 123; };\n',
    };
    const result = await validateConfig(badFiles, sshRun);

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes('unknown option') || e.includes('bad_option_xyz'))).toBe(true);
  });

  it('detects invalid zone content via checkzone', async () => {
    const badZoneFiles: Record<string, string> = {
      'named.conf': `
options {
    directory "/var/bind";
};
zone "bad.test" {
    type primary;
    file "/etc/bind/zones/db.bad.test";
};
`,
      'zones/db.bad.test': `
$TTL 300
$ORIGIN bad.test.
@ IN SOA ns1.bad.test. hostmaster.bad.test. ( 1 3600 900 604800 300 )
@ IN NS ns1.bad.test.
www IN A 10.0.0.1
www IN CNAME other.bad.test.
`,
    };
    const result = await validateConfig(badZoneFiles, sshRun);

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes('CNAME and other data'))).toBe(true);
  });
});
