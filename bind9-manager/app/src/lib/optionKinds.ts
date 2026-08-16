// Mirrors backend/src/server/deploymentOptions.ts OPTION_ALLOWLIST. That file
// is the source of truth (it also drives write-time validation); this copy
// only needs to pick the right editor widget and key list in the UI, so it
// is hand-kept in sync rather than shared across the frontend/backend build.

export type OptionValueKind = 'ACL_TOKENS' | 'IP_LIST' | 'BOOLEAN' | 'FORWARD' | 'DNSSEC_VALIDATION';

export interface OptionKindSpec {
  scopes: ('VIEW' | 'ZONE')[];
  kind: OptionValueKind;
}

export const OPTION_ALLOWLIST: Record<string, OptionKindSpec> = {
  'match-clients': { scopes: ['VIEW'], kind: 'ACL_TOKENS' },
  'allow-query': { scopes: ['VIEW', 'ZONE'], kind: 'ACL_TOKENS' },
  'allow-query-cache': { scopes: ['VIEW', 'ZONE'], kind: 'ACL_TOKENS' },
  'allow-recursion': { scopes: ['VIEW', 'ZONE'], kind: 'ACL_TOKENS' },
  'allow-transfer': { scopes: ['VIEW', 'ZONE'], kind: 'ACL_TOKENS' },
  'allow-update': { scopes: ['VIEW', 'ZONE'], kind: 'ACL_TOKENS' },
  forwarders: { scopes: ['VIEW', 'ZONE'], kind: 'IP_LIST' },
  'also-notify': { scopes: ['VIEW', 'ZONE'], kind: 'IP_LIST' },
  recursion: { scopes: ['VIEW', 'ZONE'], kind: 'BOOLEAN' },
  forward: { scopes: ['VIEW', 'ZONE'], kind: 'FORWARD' },
  'dnssec-validation': { scopes: ['VIEW', 'ZONE'], kind: 'DNSSEC_VALIDATION' },
};

// Keys settable at ZONE scope: every allowlisted key except match-clients.
export const ZONE_SCOPE_KEYS: string[] = Object.entries(OPTION_ALLOWLIST)
  .filter(([, spec]) => spec.scopes.includes('ZONE'))
  .map(([key]) => key);

// Keys settable at VIEW scope: every allowlisted key, including match-clients.
export const VIEW_SCOPE_KEYS: string[] = Object.entries(OPTION_ALLOWLIST)
  .filter(([, spec]) => spec.scopes.includes('VIEW'))
  .map(([key]) => key);

// Seed value used when a control is switched to Override/Disable and there is
// no inherited value to seed from (nothing set anywhere above this scope).
export function defaultValueForKind(kind: OptionValueKind): unknown {
  switch (kind) {
    case 'ACL_TOKENS':
    case 'IP_LIST':
      return [];
    case 'BOOLEAN':
      return false;
    case 'FORWARD':
      return 'first';
    case 'DNSSEC_VALIDATION':
      return 'auto';
    default:
      return null;
  }
}

// Mirrors backend/src/server/deploymentOptions.ts SERVER_ROLES.
export const SERVER_ROLES: readonly string[] = ['PRIMARY', 'SECONDARY', 'FORWARDER', 'STUB', 'RECURSIVE'];
