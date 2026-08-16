import { describe, it, expect } from 'vitest';
import { rpzOwnerName, rpzActionRr, renderRpzZoneFile } from '../src/config-engine/rpz';
import { generateNamedConf } from '../src/config-engine/generateNamedConf';
import type { ConfigModel } from '../src/config-engine/model';
import type { Configuration, View, RpzPolicy, RpzRule } from '../../shared/entities';

const dummyConfig: Configuration = {
  id: 'cfg-1',
  name: 'test-config',
  isActive: true,
  createdFromTemplateId: null,
  createdAt: '2026-08-15T00:00:00Z',
  updatedAt: '2026-08-15T00:00:00Z',
  counts: { views: 1, zones: 0, records: 0, servers: 1 },
};

const view: View = {
  id: 'view-1',
  configurationId: 'cfg-1',
  name: 'internal',
  order: 1,
  matchClients: ['any'],
  zoneCount: 0,
};

function rule(partial: Partial<RpzRule> & { trigger: RpzRule['trigger']; value: string; action: RpzRule['action'] }): RpzRule {
  return { id: 'rpzr-1', policyId: 'rpz-1', order: 0, ...partial };
}

function policy(partial: Partial<RpzPolicy> & { name: string }): RpzPolicy {
  return { id: 'rpz-1', configurationId: 'cfg-1', viewId: 'view-1', order: 0, ...partial };
}

describe('rpz owner-name + action encoding', () => {
  it('QNAME NXDOMAIN rule encodes owner evil.example with CNAME .', () => {
    const r = rule({ trigger: 'QNAME', value: 'evil.example', action: 'NXDOMAIN' });
    expect(rpzOwnerName(r)).toBe('evil.example');
    expect(rpzActionRr(r)).toBe('CNAME .');
  });

  it('CLIENT_IP 10.0.0.0/24 encodes owner 24.0.0.0.10.rpz-client-ip', () => {
    const r = rule({ trigger: 'CLIENT_IP', value: '10.0.0.0/24', action: 'NXDOMAIN' });
    expect(rpzOwnerName(r)).toBe('24.0.0.0.10.rpz-client-ip');
  });

  it('IP 192.0.2.0/24 encodes owner 24.0.2.0.192.rpz-ip', () => {
    const r = rule({ trigger: 'IP', value: '192.0.2.0/24', action: 'NXDOMAIN' });
    expect(rpzOwnerName(r)).toBe('24.0.2.0.192.rpz-ip');
  });

  it('CNAME action renders CNAME target.', () => {
    const r = rule({ trigger: 'QNAME', value: 'bad.example', action: 'CNAME', cname: 'blocked.example' });
    expect(rpzActionRr(r)).toBe('CNAME blocked.example.');
  });

  it('maps every non-CNAME action to its CNAME rewrite', () => {
    const cases: [RpzRule['action'], string][] = [
      ['NODATA', 'CNAME *.'],
      ['PASSTHRU', 'CNAME rpz-passthru.'],
      ['DROP', 'CNAME rpz-drop.'],
      ['TCP_ONLY', 'CNAME rpz-tcp-only.'],
    ];
    for (const [action, rr] of cases) {
      expect(rpzActionRr(rule({ trigger: 'QNAME', value: 'x.example', action }))).toBe(rr);
    }
  });

  it('builds CIDR owner names from parsed integer octets (injection-safe)', () => {
    // A raw-substring impl would echo the embedded newline/record back into
    // the owner. parseCidr rejects the value, so rpzOwnerName must refuse to
    // encode it rather than fall back to the raw string.
    const hostile = '0.0.0.0/0\nx IN A 1.2.3.4';
    const r = rule({ trigger: 'CLIENT_IP', value: hostile, action: 'NXDOMAIN' });
    expect(() => rpzOwnerName(r)).toThrow();

    // Canonical octets: leading-zero octets are normalized by integer parsing.
    expect(rpzOwnerName(rule({ trigger: 'CLIENT_IP', value: '010.0.0.0/24', action: 'NXDOMAIN' }))).toBe('24.0.0.0.10.rpz-client-ip');
  });

  it('renders a policy zone file with SOA, NS localhost, and rules ordered by order', () => {
    const p = policy({ name: 'malware' });
    const rules = [
      rule({ id: 'r1', trigger: 'QNAME', value: 'evil.example', action: 'NXDOMAIN', order: 2 }),
      rule({ id: 'r2', trigger: 'CLIENT_IP', value: '10.0.0.0/24', action: 'DROP', order: 1 }),
    ];
    const out = renderRpzZoneFile(p, rules);
    expect(out).toContain('$ORIGIN malware.');
    expect(out).toContain('@ IN NS localhost.');
    expect(out.indexOf('rpz-client-ip')).toBeLessThan(out.indexOf('evil.example'));
  });
});

describe('view response-policy clause', () => {
  it('emits a response-policy clause + zone block when the view has >=1 policy', () => {
    const model: ConfigModel = {
      configuration: dummyConfig,
      views: [view],
      zones: [],
      records: [],
      servers: [{ id: 'srv-1' }],
      roles: [],
      options: [],
      rpzPolicies: [policy({ name: 'blocklist', defaultPolicy: 'NXDOMAIN' })],
      rpzRules: [],
    };
    const out = generateNamedConf(model, 'srv-1');
    expect(out).toContain('response-policy');
    expect(out).toContain('zone "blocklist" policy NXDOMAIN;');
    expect(out).toContain('zone "blocklist" {');
    expect(out).toContain('file "/etc/bind/zones/db.rpz.blocklist";');
  });

  it('emits NOTHING when the view has zero policies', () => {
    const model: ConfigModel = {
      configuration: dummyConfig,
      views: [view],
      zones: [],
      records: [],
      servers: [{ id: 'srv-1' }],
      roles: [],
      options: [],
    };
    const out = generateNamedConf(model, 'srv-1');
    expect(out).not.toContain('response-policy');
    expect(out).not.toContain('rpz-');
  });

  it('lists multiple policies in order', () => {
    const model: ConfigModel = {
      configuration: dummyConfig,
      views: [view],
      zones: [],
      records: [],
      servers: [{ id: 'srv-1' }],
      roles: [],
      options: [],
      rpzPolicies: [
        policy({ id: 'rpz-1', name: 'first', order: 1 }),
        policy({ id: 'rpz-2', name: 'second', order: 0 }),
      ],
      rpzRules: [],
    };
    const out = generateNamedConf(model, 'srv-1');
    expect(out.indexOf('zone "second"')).toBeLessThan(out.indexOf('zone "first"'));
  });
});
