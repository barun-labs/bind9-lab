import { describe, it, expect } from 'vitest';
import { evaluateAcl, ipv4ToInt, cidrContains } from '../src/server/aclEvaluator';
import type { Acl, AclEntry, AclEntryType } from '../../shared/entities';

// Red-team correctness suite. A wrong ALLOW here is a security bug.
// Each `it` asserts the CORRECT decision under BIND first-match-wins semantics.

let seq = 0;
function entry(type: AclEntryType, value: string | null, negated = false): AclEntry {
  return { id: `ae-${seq++}`, order: 0, type, value, negated };
}

function acl(id: string, name: string, entries: AclEntry[]): Acl {
  entries.forEach((e, i) => { e.order = i; });
  return { id, configurationId: 'cfg', name, entries, usedByCount: 0 };
}

describe('1. CIDR boundaries', () => {
  it('/8 contains 10.255.255.255 but not 11.0.0.0 nor 9.255.255.255', () => {
    expect(cidrContains('10.0.0.0/8', '10.0.0.0')).toBe(true);
    expect(cidrContains('10.0.0.0/8', '10.255.255.255')).toBe(true);
    expect(cidrContains('10.0.0.0/8', '11.0.0.0')).toBe(false);
    expect(cidrContains('10.0.0.0/8', '9.255.255.255')).toBe(false);
  });

  it('/31 contains exactly its two addresses', () => {
    expect(cidrContains('10.0.0.0/31', '10.0.0.0')).toBe(true);
    expect(cidrContains('10.0.0.0/31', '10.0.0.1')).toBe(true);
    expect(cidrContains('10.0.0.0/31', '10.0.0.2')).toBe(false);
    expect(cidrContains('10.0.0.0/31', '10.0.0.3')).toBe(false);
  });

  it('/32 contains only itself, /0 contains everything', () => {
    expect(cidrContains('192.168.1.7/32', '192.168.1.7')).toBe(true);
    expect(cidrContains('192.168.1.7/32', '192.168.1.8')).toBe(false);
    expect(cidrContains('0.0.0.0/0', '8.8.8.8')).toBe(true);
  });

  it('host bits set in prefix (10.1.2.3/8) still match by mask', () => {
    expect(cidrContains('10.1.2.3/8', '10.99.99.99')).toBe(true);
    expect(cidrContains('10.1.2.3/8', '11.0.0.1')).toBe(false);
  });

  it('ipv4ToInt rejects malformed input', () => {
    expect(ipv4ToInt('256.0.0.1')).toBeNull();
    expect(ipv4ToInt('1.2.3')).toBeNull();
    expect(ipv4ToInt('1.2.3.4.5')).toBeNull();
    expect(ipv4ToInt('')).toBeNull();
    expect(ipv4ToInt('-1.2.3.4')).toBeNull();
    expect(ipv4ToInt('1.2.3.4.')).toBeNull();
    expect(ipv4ToInt('1.2.3.a')).toBeNull();
  });

  it('ipv4ToInt rejects leading zeros and surrounding whitespace (strict dotted-quad)', () => {
    // BIND's inet_pton rejects both. A leading-zero octal-looking octet must not
    // silently parse as decimal and match an address the author did not intend.
    expect(ipv4ToInt('01.2.3.4')).toBeNull();
    expect(ipv4ToInt('010.010.010.010')).toBeNull();
    expect(ipv4ToInt(' 1.2.3.4 ')).toBeNull();
    expect(ipv4ToInt('1.2.3.4 ')).toBeNull();
  });
});

describe('2. first-match dominance', () => {
  it('negated CIDR first decides DENY; non-matching IP falls through to ANY', () => {
    const a = acl('a', 'a', [
      entry('CIDR', '10.0.0.0/8', true),
      entry('ANY', null),
    ]);
    const deny = evaluateAcl([a], 'a', '10.1.1.1');
    expect(deny.decision).toBe('DENY');
    expect(deny.trace).toHaveLength(1); // stopped at decider

    const allow = evaluateAcl([a], 'a', '8.8.8.8');
    expect(allow.decision).toBe('ALLOW');
    expect(allow.trace).toHaveLength(2);
  });

  it('reversing order (ANY first) means 10.1.1.1 is ALLOWed', () => {
    const a = acl('a', 'a', [
      entry('ANY', null),
      entry('CIDR', '10.0.0.0/8', true),
    ]);
    const res = evaluateAcl([a], 'a', '10.1.1.1');
    expect(res.decision).toBe('ALLOW');
    expect(res.trace).toHaveLength(1);
  });
});

describe('3. negation not inverted-wrongly', () => {
  it('lone negated CIDR: matching IP DENY, non-matching IP default DENY', () => {
    const a = acl('a', 'a', [entry('CIDR', '10.0.0.0/8', true)]);
    expect(evaluateAcl([a], 'a', '10.1.1.1').decision).toBe('DENY');
    // No element matches -> default DENY, NOT allow.
    expect(evaluateAcl([a], 'a', '8.8.8.8').decision).toBe('DENY');
  });

  it('lone positive CIDR: matching ALLOW, non-matching DENY', () => {
    const a = acl('a', 'a', [entry('CIDR', '10.0.0.0/8', false)]);
    expect(evaluateAcl([a], 'a', '10.1.1.1').decision).toBe('ALLOW');
    expect(evaluateAcl([a], 'a', '8.8.8.8').decision).toBe('DENY');
  });
});

describe('4. nested ACL', () => {
  it('trusted CIDR match ALLOWs; fall-through to negated ANY DENYs', () => {
    const trusted = acl('trusted', 'trusted', [entry('CIDR', '192.168.0.0/16')]);
    const main = acl('main', 'main', [
      entry('ACL_NAME', 'trusted'),
      entry('ANY', null, true),
    ]);
    expect(evaluateAcl([trusted, main], 'main', '192.168.5.5').decision).toBe('ALLOW');
    // trusted non-matches -> ANY negated matches -> DENY.
    expect(evaluateAcl([trusted, main], 'main', '8.8.8.8').decision).toBe('DENY');
  });

  it('referencing a non-existent ACL name non-matches, no throw, error surfaced', () => {
    const a = acl('a', 'a', [entry('ACL_NAME', 'ghost'), entry('ANY', null)]);
    const res = evaluateAcl([a], 'a', '1.2.3.4');
    expect(res.decision).toBe('ALLOW'); // falls through to ANY
    expect(res.error).toContain('not found');
  });
});

describe('5. reference cycle', () => {
  it('A->B->A terminates with DENY and a cycle error (no stack overflow)', () => {
    const a = acl('a', 'a', [entry('ACL_NAME', 'b')]);
    const b = acl('b', 'b', [entry('ACL_NAME', 'a')]);
    const res = evaluateAcl([a, b], 'a', '10.0.0.1');
    expect(res.matched).toBe(false);
    expect(res.decision).toBe('DENY');
    expect(res.error).toContain('cycle');
  });

  it('self-reference terminates with DENY and a cycle error', () => {
    const a = acl('a', 'a', [entry('ACL_NAME', 'a')]);
    const res = evaluateAcl([a], 'a', '10.0.0.1');
    expect(res.matched).toBe(false);
    expect(res.decision).toBe('DENY');
    expect(res.error).toContain('cycle');
  });
});

describe('6. diamond (shared reference, NOT a cycle)', () => {
  it('D referenced twice from A still ALLOWs with no false cycle error', () => {
    const d = acl('d', 'd', [entry('CIDR', '10.0.0.0/8')]);
    const a = acl('a', 'a', [entry('ACL_NAME', 'd'), entry('ACL_NAME', 'd')]);
    const res = evaluateAcl([d, a], 'a', '10.1.1.1');
    expect(res.decision).toBe('ALLOW');
    expect(res.error).toBeUndefined();
  });
});

describe('7. LOCALHOST / LOCALNETS', () => {
  it('LOCALHOST matches 127/8 and ::1 only', () => {
    const lh = acl('lh', 'lh', [entry('LOCALHOST', null)]);
    expect(evaluateAcl([lh], 'lh', '127.0.0.1').decision).toBe('ALLOW');
    expect(evaluateAcl([lh], 'lh', '127.5.5.5').decision).toBe('ALLOW');
    expect(evaluateAcl([lh], 'lh', '::1').decision).toBe('ALLOW');
    expect(evaluateAcl([lh], 'lh', '128.0.0.1').decision).toBe('DENY');
    expect(evaluateAcl([lh], 'lh', '10.0.0.1').decision).toBe('DENY');
  });

  it('LOCALNETS matches RFC1918 + loopback, not outside', () => {
    const ln = acl('ln', 'ln', [entry('LOCALNETS', null)]);
    for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1']) {
      expect(evaluateAcl([ln], 'ln', ip).decision, ip).toBe('ALLOW');
    }
    for (const ip of ['172.15.0.1', '172.32.0.1', '8.8.8.8', '192.169.0.1']) {
      expect(evaluateAcl([ln], 'ln', ip).decision, ip).toBe('DENY');
    }
  });
});

describe('8. malformed / empty input', () => {
  it('empty entries DENY', () => {
    const a = acl('a', 'a', []);
    expect(evaluateAcl([a], 'a', '10.0.0.1').decision).toBe('DENY');
  });

  it('malformed clientIp DENYs without throwing', () => {
    const a = acl('a', 'a', [entry('ADDRESS', '10.0.0.1'), entry('ANY', null)]);
    expect(evaluateAcl([a], 'a', 'not.an.ip').decision).toBe('ALLOW'); // falls to ANY; still no throw
    const strict = acl('s', 's', [entry('ADDRESS', '10.0.0.1')]);
    expect(evaluateAcl([strict], 's', 'not.an.ip').decision).toBe('DENY');
    expect(evaluateAcl([strict], 's', '').decision).toBe('DENY');
    expect(evaluateAcl([strict], 's', '1.2.3').decision).toBe('DENY');
  });

  it('value:null with CIDR/ADDRESS/ACL_NAME non-matches without throwing', () => {
    const cidr = acl('c', 'c', [entry('CIDR', null), entry('ANY', null)]);
    expect(evaluateAcl([cidr], 'c', '10.0.0.1').decision).toBe('ALLOW'); // null CIDR non-matches -> ANY

    const addr = acl('a', 'a', [entry('ADDRESS', null)]);
    expect(evaluateAcl([addr], 'a', '10.0.0.1').decision).toBe('DENY');

    const ref = acl('r', 'r', [entry('ACL_NAME', null)]);
    expect(evaluateAcl([ref], 'r', '10.0.0.1').decision).toBe('DENY');
    expect(evaluateAcl([ref], 'r', '10.0.0.1').error).toBeUndefined();
  });
});
