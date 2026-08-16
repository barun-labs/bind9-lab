import type { Acl, AclEntry } from '../../../shared/entities';

export interface AclTraceStep {
  entryId: string;
  type: string;
  value: string | null;
  negated: boolean;
  matched: boolean;
}

export interface AclEvalResult {
  matched: boolean;
  decision: 'ALLOW' | 'DENY';
  trace: AclTraceStep[];
  error?: string;
}

/**
 * Parse a dotted-quad IPv4 address into a 32-bit unsigned integer, or null.
 */
export function ipv4ToInt(ip: string): number | null {
  if (typeof ip !== 'string') return null;
  // No trim: BIND's inet_pton rejects surrounding whitespace, so we do too.
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    // Reject leading zeros ('010' etc.) — inet_pton treats them as invalid,
    // not octal; accepting them would match an ACL value like 010.010.010.010
    // against client 10.10.10.10, an ALLOW BIND would never make.
    if (part.length > 1 && part[0] === '0') return null;
    const octet = parseInt(part, 10);
    if (octet < 0 || octet > 255) return null;
    result = result * 256 + octet;
  }
  return result >>> 0;
}

/**
 * True when `ip` is contained in the CIDR prefix `cidr` (a.b.c.d/n, 0<=n<=32).
 * IPv4 only; anything else (IPv6, malformed) never matches and never throws.
 */
export function cidrContains(cidr: string, ip: string): boolean {
  if (typeof cidr !== 'string' || typeof ip !== 'string') return false;
  const slash = cidr.indexOf('/');
  if (slash === -1) return false;
  const prefixStr = cidr.slice(0, slash);
  const maskStr = cidr.slice(slash + 1);
  const n = parseInt(maskStr, 10);
  if (!Number.isInteger(n) || n < 0 || n > 32) return false;
  const prefixInt = ipv4ToInt(prefixStr);
  const ipInt = ipv4ToInt(ip);
  if (prefixInt === null || ipInt === null) return false;
  const mask = n === 0 ? 0 : (~0 << (32 - n)) >>> 0;
  return ((prefixInt & mask) >>> 0) === ((ipInt & mask) >>> 0);
}

function isLocalhost(ip: string): boolean {
  if (ip === '::1') return true;
  const int = ipv4ToInt(ip);
  if (int === null) return false;
  return (int >>> 24) === 127; // 127.0.0.0/8
}

// Approximation of BIND's `localnets`: RFC1918 private ranges plus loopback.
// BIND also matches link-local (169.254/16) and some ULA ranges; add those if needed.
function isLocalnets(ip: string): boolean {
  if (isLocalhost(ip)) return true;
  const int = ipv4ToInt(ip);
  if (int === null) return false;
  const b0 = int >>> 24;
  if (b0 === 10) return true; // 10.0.0.0/8
  if (b0 === 172) {
    const b1 = (int >>> 16) & 0xff;
    return b1 >= 16 && b1 <= 31; // 172.16.0.0/12
  }
  if (b0 === 192) {
    return ((int >>> 16) & 0xff) === 168; // 192.168.0.0/16
  }
  return false;
}

function matchAddress(value: string | null, clientIp: string): boolean {
  if (value === null) return false;
  const vInt = ipv4ToInt(value);
  const cInt = ipv4ToInt(clientIp);
  if (vInt !== null && cInt !== null) return vInt === cInt;
  // IPv6 (or malformed): exact string equality.
  return value === clientIp;
}

interface EvalState {
  error?: string;
}

function testEntry(
  entry: AclEntry,
  clientIp: string,
  byId: Map<string, Acl>,
  seen: Set<string>,
  state: EvalState
): boolean {
  const value = entry.value;
  switch (entry.type) {
    case 'ANY':
      return true;
    case 'NONE':
      return false;
    case 'ADDRESS':
      return matchAddress(value, clientIp);
    case 'CIDR':
      return value !== null && cidrContains(value, clientIp);
    case 'LOCALHOST':
      return isLocalhost(clientIp);
    case 'LOCALNETS':
      return isLocalnets(clientIp);
    case 'ACL_NAME': {
      if (value === null) return false;
      const refAcl = byId.get(value) ?? [...byId.values()].find((a) => a.name === value);
      if (!refAcl) {
        if (!state.error) state.error = `ACL not found: ${value}`;
        return false;
      }
      const nested = evalAclInternal(refAcl.id, clientIp, byId, seen, state);
      return nested.matched && nested.decision === 'ALLOW';
    }
    case 'KEY_NAME':
      // A key name cannot be decided from an IP alone; record a non-match.
      return false;
    default:
      return false;
  }
}

function evalAclInternal(
  aclId: string,
  clientIp: string,
  byId: Map<string, Acl>,
  seen: Set<string>,
  state: EvalState
): { matched: boolean; decision: 'ALLOW' | 'DENY'; trace: AclTraceStep[] } {
  const acl = byId.get(aclId);
  if (!acl) {
    if (!state.error) state.error = `ACL not found: ${aclId}`;
    return { matched: false, decision: 'DENY', trace: [] };
  }
  if (seen.has(aclId)) {
    if (!state.error) state.error = 'ACL reference cycle detected';
    return { matched: false, decision: 'DENY', trace: [] };
  }
  seen.add(aclId);
  try {
    const trace: AclTraceStep[] = [];
    const entries = [...acl.entries].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    for (const entry of entries) {
      const matched = testEntry(entry, clientIp, byId, seen, state);
      trace.push({
        entryId: entry.id,
        type: entry.type,
        value: entry.value,
        negated: entry.negated,
        matched,
      });
      if (matched) {
        return { matched: true, decision: entry.negated ? 'DENY' : 'ALLOW', trace };
      }
    }
    return { matched: false, decision: 'DENY', trace };
  } finally {
    seen.delete(aclId);
  }
}

/**
 * Evaluate an ACL (by id or name) against a client IP using BIND
 * first-match-wins semantics. Pure: never throws, never mutates input.
 */
export function evaluateAcl(acls: Acl[], target: string, clientIp: string): AclEvalResult {
  const byId = new Map<string, Acl>();
  for (const a of acls) byId.set(a.id, a);
  const targetAcl = byId.get(target) ?? acls.find((a) => a.name === target);
  const state: EvalState = {};
  if (!targetAcl) {
    return { matched: false, decision: 'DENY', trace: [], error: `ACL not found: ${target}` };
  }
  const result = evalAclInternal(targetAcl.id, clientIp, byId, new Set(), state);
  return { matched: result.matched, decision: result.decision, trace: result.trace, ...(state.error ? { error: state.error } : {}) };
}
