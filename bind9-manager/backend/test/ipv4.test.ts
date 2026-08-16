import { describe, it, expect } from 'vitest';
import {
  parseCidr, cidrContainsCidr, cidrsOverlap, cidrContainsIp,
  reversePtrName, ptrZoneName, isValidIpv4,
} from '../src/server/ipv4';

describe('ipv4', () => {
  it('parses a valid CIDR and rejects malformed input', () => {
    // brief literal 169738496 decodes to 10.30.1.0 (digit transposition typo);
    // 169083136 is the correct network-byte-order integer for 10.20.1.0.
    expect(parseCidr('10.20.1.0/24')).toEqual({ network: 169083136, prefix: 24 });
    // must-fail control: a broken parser that returned an object here would fail these.
    expect(parseCidr('10.20.1.0/33')).toBeNull();
    expect(parseCidr('256.0.0.0/8')).toBeNull();
    expect(parseCidr('10.0.0.0')).toBeNull();
    expect(parseCidr('garbage')).toBeNull();
    expect(parseCidr('10.0.0.0/-1')).toBeNull();
  });

  it('normalizes the network address to the prefix', () => {
    // host bits are masked off: 10.20.1.55/24 -> network of 10.20.1.0/24
    expect(parseCidr('10.20.1.55/24')).toEqual(parseCidr('10.20.1.0/24'));
  });

  it('decides containment (parent contains child, not vice versa)', () => {
    expect(cidrContainsCidr('10.0.0.0/8', '10.20.1.0/24')).toBe(true);
    expect(cidrContainsCidr('10.0.0.0/8', '10.0.0.0/8')).toBe(true); // equal contains equal
    // must-fail control: child does NOT contain parent
    expect(cidrContainsCidr('10.20.1.0/24', '10.0.0.0/8')).toBe(false);
    expect(cidrContainsCidr('10.0.0.0/8', '192.168.0.0/16')).toBe(false);
  });

  it('detects overlap symmetrically and non-overlap', () => {
    expect(cidrsOverlap('10.0.0.0/8', '10.20.0.0/16')).toBe(true);
    expect(cidrsOverlap('10.20.0.0/16', '10.0.0.0/8')).toBe(true);
    // must-fail control: disjoint ranges do not overlap
    expect(cidrsOverlap('10.0.0.0/8', '11.0.0.0/8')).toBe(false);
  });

  it('tests ip membership', () => {
    expect(cidrContainsIp('192.0.2.0/24', '192.0.2.1')).toBe(true);
    expect(cidrContainsIp('192.0.2.0/24', '192.0.3.1')).toBe(false);
  });

  it('builds reverse PTR names and /24 zone names', () => {
    expect(reversePtrName('192.0.2.1')).toBe('1.2.0.192.in-addr.arpa');
    expect(ptrZoneName('192.0.2.1')).toBe('2.0.192.in-addr.arpa');
  });

  it('validates IPv4 literals', () => {
    expect(isValidIpv4('192.0.2.1')).toBe(true);
    expect(isValidIpv4('192.0.2.256')).toBe(false);
    expect(isValidIpv4('2001:db8::1')).toBe(false);
  });
});
