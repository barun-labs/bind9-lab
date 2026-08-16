import { describe, it, expect } from 'vitest';
import { evaluateAcl, ipv4ToInt, cidrContains } from '../src/server/aclEvaluator';
import type { Acl, AclEntry, AclEntryType } from '../../shared/entities';

let seq = 0;
function entry(type: AclEntryType, value: string | null, negated = false): AclEntry {
  return { id: `ae-${seq++}`, order: 0, type, value, negated };
}

function acl(id: string, name: string, entries: AclEntry[]): Acl {
  entries.forEach((e, i) => { e.order = i; });
  return { id, configurationId: 'cfg', name, entries, usedByCount: 0 };
}

describe('ipv4 helpers', () => {
  it('parses dotted quads and rejects garbage', () => {
    expect(ipv4ToInt('0.0.0.0')).toBe(0);
    expect(ipv4ToInt('255.255.255.255')).toBe(4294967295);
    expect(ipv4ToInt('10.1.2.3')).toBe(167838211);
    expect(ipv4ToInt('256.0.0.1')).toBeNull();
    expect(ipv4ToInt('10.1.2')).toBeNull();
    expect(ipv4ToInt('abc')).toBeNull();
  });

  it('cidrContains honors the prefix', () => {
    expect(cidrContains('10.0.0.0/8', '10.1.2.3')).toBe(true);
    expect(cidrContains('10.0.0.0/8', '11.0.0.1')).toBe(false);
    expect(cidrContains('192.168.1.1/32', '192.168.1.1')).toBe(true);
    expect(cidrContains('192.168.1.1/32', '192.168.1.2')).toBe(false);
    expect(cidrContains('0.0.0.0/0', '8.8.8.8')).toBe(true);
    expect(cidrContains('not-a-cidr', '10.0.0.1')).toBe(false);
    expect(cidrContains('10.0.0.0/33', '10.0.0.1')).toBe(false);
  });
});

describe('evaluateAcl', () => {
  it('exact ADDRESS matches, non-matches fall through to default DENY', () => {
    const a = acl('a', 'a', [entry('ADDRESS', '10.1.2.3')]);
    expect(evaluateAcl([a], 'a', '10.1.2.3')).toMatchObject({ matched: true, decision: 'ALLOW' });
    const no = evaluateAcl([a], 'a', '10.1.2.4');
    expect(no).toMatchObject({ matched: false, decision: 'DENY' });
    expect(no.trace).toHaveLength(1);
    expect(no.trace[0].matched).toBe(false);
  });

  it('first matching element decides (trace stops at the decider)', () => {
    const a = acl('a', 'a', [entry('CIDR', '10.0.0.0/8'), entry('ANY', null)]);
    const res = evaluateAcl([a], 'a', '10.1.1.1');
    expect(res).toMatchObject({ matched: true, decision: 'ALLOW' });
    expect(res.trace).toHaveLength(1);
  });

  it('negated matching element decides DENY; negated non-match continues', () => {
    const a = acl('a', 'a', [entry('CIDR', '10.0.0.0/8', true), entry('ANY', null)]);
    const deny = evaluateAcl([a], 'a', '10.1.1.1');
    expect(deny).toMatchObject({ matched: true, decision: 'DENY' });
    expect(deny.trace).toHaveLength(1);
    expect(deny.trace[0].negated).toBe(true);

    const allow = evaluateAcl([a], 'a', '192.168.1.1');
    expect(allow).toMatchObject({ matched: true, decision: 'ALLOW' });
    expect(allow.trace).toHaveLength(2);
  });

  it('resolves nested ACL_NAME and treats a nested DENY as non-matching', () => {
    const inner = acl('inner', 'inner', [entry('ADDRESS', '10.0.0.1')]);
    const outer = acl('outer', 'outer', [entry('ACL_NAME', 'inner'), entry('ANY', null)]);
    expect(evaluateAcl([inner, outer], 'outer', '10.0.0.1')).toMatchObject({ matched: true, decision: 'ALLOW' });
    // Nested ACL denies -> ACL_NAME does not match -> falls to ANY.
    expect(evaluateAcl([inner, outer], 'outer', '10.0.0.2')).toMatchObject({ matched: true, decision: 'ALLOW' });
  });

  it('reference cycle does not throw, sets error, and terminates', () => {
    const a = acl('a', 'a', [entry('ACL_NAME', 'b')]);
    const b = acl('b', 'b', [entry('ACL_NAME', 'a')]);
    const res = evaluateAcl([a, b], 'a', '10.0.0.1');
    expect(res.matched).toBe(false);
    expect(res.decision).toBe('DENY');
    expect(res.error).toContain('cycle');
  });

  it('ANY always matches, NONE never does, empty entries default to DENY', () => {
    const anyAcl = acl('any', 'any', [entry('ANY', null)]);
    expect(evaluateAcl([anyAcl], 'any', '8.8.8.8')).toMatchObject({ matched: true, decision: 'ALLOW' });

    const noneAcl = acl('none', 'none', [entry('NONE', null)]);
    expect(evaluateAcl([noneAcl], 'none', '8.8.8.8')).toMatchObject({ matched: false, decision: 'DENY' });

    const emptyAcl = acl('empty', 'empty', []);
    expect(evaluateAcl([emptyAcl], 'empty', '8.8.8.8')).toMatchObject({ matched: false, decision: 'DENY' });
  });

  it('LOCALHOST and LOCALNETS match expected addresses', () => {
    const lh = acl('lh', 'lh', [entry('LOCALHOST', null)]);
    expect(evaluateAcl([lh], 'lh', '127.0.0.1')).toMatchObject({ matched: true, decision: 'ALLOW' });
    expect(evaluateAcl([lh], 'lh', '::1')).toMatchObject({ matched: true, decision: 'ALLOW' });
    expect(evaluateAcl([lh], 'lh', '8.8.8.8')).toMatchObject({ matched: false, decision: 'DENY' });

    const ln = acl('ln', 'ln', [entry('LOCALNETS', null)]);
    expect(evaluateAcl([ln], 'ln', '192.168.1.5')).toMatchObject({ matched: true, decision: 'ALLOW' });
    expect(evaluateAcl([ln], 'ln', '8.8.8.8')).toMatchObject({ matched: false, decision: 'DENY' });
  });

  it('malformed clientIp or CIDR never throws, just no match', () => {
    const cidr = acl('c', 'c', [entry('CIDR', 'not-a-cidr')]);
    expect(evaluateAcl([cidr], 'c', '10.0.0.1')).toMatchObject({ matched: false, decision: 'DENY' });

    const addr = acl('a', 'a', [entry('ADDRESS', '10.0.0.1')]);
    expect(evaluateAcl([addr], 'a', '999.1.1.1')).toMatchObject({ matched: false, decision: 'DENY' });
  });

  it('target may be an id or a name; missing target reports an error', () => {
    const a = acl('acl-x', 'by-name', [entry('ANY', null)]);
    expect(evaluateAcl([a], 'acl-x', '1.2.3.4').matched).toBe(true);
    expect(evaluateAcl([a], 'by-name', '1.2.3.4').matched).toBe(true);
    expect(evaluateAcl([a], 'missing', '1.2.3.4').error).toContain('not found');
  });
});
