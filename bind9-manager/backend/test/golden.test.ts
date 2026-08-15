/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import { anycastModel } from '../src/fixtures/anycastModel';
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

describe('Golden tests for anycast DNS normal variant', () => {
  for (const server of anycastModel.servers) {
    it(`validates generated config for server: ${server.id}`, async () => {
      const files = generateServerConfig(anycastModel, server.id);
      const res = await validateConfig(files, sshRun);

      expect(res.ok).toBe(true);
      expect(res.errors).toEqual([]);
    }, 20000);
  }

  describe('Negative controls', () => {
    it('fails validation when a CNAME is placed at zone apex', async () => {
      const invalidApexModel: ConfigModel = {
        ...anycastModel,
        records: [
          ...anycastModel.records,
          {
            id: 'rec-invalid-apex-cname',
            zoneId: 'zone-lab-test',
            name: '@',
            type: 'CNAME',
            ttl: 86400,
            rdata: { target: 'other.lab.test.' },
            disabled: false,
            syncState: 'SYNCED',
            issue: null,
          },
        ],
      };

      const files = generateServerConfig(invalidApexModel, 'bc-rmaster');
      const res = await validateConfig(files, sshRun);

      expect(res.ok).toBe(false);
      expect(res.errors.length).toBeGreaterThan(0);
      expect(
        res.errors.some(
          (err) => err.includes('CNAME and other data') || err.includes('not loaded due to errors'),
        ),
      ).toBe(true);
    }, 20000);

    it('fails validation when forwarders contain a non-IP value', async () => {
      const invalidForwarderModel: ConfigModel = {
        ...anycastModel,
        options: anycastModel.options.map((opt) => {
          if (opt.scopeType === 'VIEW' && opt.scopeId === 'view-cache' && opt.key === 'forwarders') {
            return {
              ...opt,
              value: ['not-an-ip'],
            };
          }
          return opt;
        }),
      };

      const files = generateServerConfig(invalidForwarderModel, 'bc-cache1');
      const res = await validateConfig(files, sshRun);

      expect(res.ok).toBe(false);
      expect(res.errors.length).toBeGreaterThan(0);
      expect(
        res.errors.some(
          (err) =>
            err.includes('expected IP address') ||
            err.includes('not-an-ip') ||
            err.includes('unknown option'),
        ),
      ).toBe(true);
    }, 20000);
  });
});
