import { isIP } from 'node:net';
import type { OptionScope } from '../../../shared/entities';

// Single source of truth for which deployment-option keys exist, at which
// scopes, and what their value shapes are. Both the API routes and the
// config-engine effectiveZoneOptions helper consume this map so the two can
// never drift apart.
export type OptionValueKind = 'ACL_TOKENS' | 'IP_LIST' | 'BOOLEAN' | 'FORWARD' | 'DNSSEC_VALIDATION';

export interface OptionKind {
  scopes: OptionScope[];
  kind: OptionValueKind;
}

export const OPTION_ALLOWLIST: Record<string, OptionKind> = {
  'match-clients': { scopes: ['VIEW'], kind: 'ACL_TOKENS' },
  'allow-query': { scopes: ['VIEW', 'ZONE'], kind: 'ACL_TOKENS' },
  'allow-query-cache': { scopes: ['VIEW', 'ZONE'], kind: 'ACL_TOKENS' },
  'allow-recursion': { scopes: ['VIEW', 'ZONE'], kind: 'ACL_TOKENS' },
  'allow-transfer': { scopes: ['VIEW', 'ZONE'], kind: 'ACL_TOKENS' },
  'allow-update': { scopes: ['VIEW', 'ZONE'], kind: 'ACL_TOKENS' },
  'forwarders': { scopes: ['VIEW', 'ZONE'], kind: 'IP_LIST' },
  'also-notify': { scopes: ['VIEW', 'ZONE'], kind: 'IP_LIST' },
  'recursion': { scopes: ['VIEW', 'ZONE'], kind: 'BOOLEAN' },
  'forward': { scopes: ['VIEW', 'ZONE'], kind: 'FORWARD' },
  'dnssec-validation': { scopes: ['VIEW', 'ZONE'], kind: 'DNSSEC_VALIDATION' },
};

// Keys settable at ZONE scope: every allowlisted key except match-clients.
export const ZONE_SCOPE_KEYS: string[] = Object.entries(OPTION_ALLOWLIST)
  .filter(([, spec]) => spec.scopes.includes('ZONE'))
  .map(([key]) => key);

// ACL tokens are emitted verbatim into named.conf; only allow characters that
// can never escape a quoted/braced BIND statement and never resolve to a path.
const ACL_TOKEN_RE = /^!?[A-Za-z0-9_.:\/-]+$/;

function validateAclTokens(value: unknown): { ok: true } | { ok: false; field: string } {
  if (!Array.isArray(value) || value.length === 0 || !value.every((t) => typeof t === 'string')) {
    return { ok: false, field: 'value' };
  }
  for (const token of value as string[]) {
    if (token.length > 128 || token.includes('..') || !ACL_TOKEN_RE.test(token)) {
      return { ok: false, field: token };
    }
  }
  return { ok: true };
}

function isPortRange(s: string): boolean {
  const port = Number(s);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

// Accepts a bare IPv4/IPv6 address or one with a :port suffix. The bracketed
// [addr]:port form is the unambiguous way to attach a port to IPv6.
function isValidIpOrIpPort(entry: string): boolean {
  if (isIP(entry) !== 0) return true;
  const bracketed = /^\[([^\]]+)\]:(\d+)$/.exec(entry);
  if (bracketed) {
    return isIP(bracketed[1]) !== 0 && isPortRange(bracketed[2]);
  }
  const withPort = /^(.*):(\d+)$/.exec(entry);
  if (withPort) {
    return isIP(withPort[1]) !== 0 && isPortRange(withPort[2]);
  }
  return false;
}

function validateIpList(value: unknown): { ok: true } | { ok: false; field: string } {
  if (!Array.isArray(value) || value.length === 0 || !value.every((e) => typeof e === 'string')) {
    return { ok: false, field: 'value' };
  }
  for (const entry of value as string[]) {
    if (!isValidIpOrIpPort(entry)) {
      return { ok: false, field: entry };
    }
  }
  return { ok: true };
}

export type OptionValidation = { ok: true } | { ok: false; field: string };

export function validateOptionValue(key: string, value: unknown): OptionValidation {
  const spec = OPTION_ALLOWLIST[key];
  if (!spec) {
    return { ok: false, field: key };
  }
  switch (spec.kind) {
    case 'ACL_TOKENS':
      return validateAclTokens(value);
    case 'IP_LIST':
      return validateIpList(value);
    case 'BOOLEAN':
      return typeof value === 'boolean' ? { ok: true } : { ok: false, field: 'value' };
    case 'FORWARD':
      return value === 'only' || value === 'first' ? { ok: true } : { ok: false, field: 'value' };
    case 'DNSSEC_VALIDATION':
      return value === 'yes' || value === 'no' || value === 'auto' ? { ok: true } : { ok: false, field: 'value' };
    default:
      return { ok: false, field: 'value' };
  }
}
