import type { RpzPolicy, RpzRule } from '../../../shared/entities';
import { parseCidr } from '../server/ipv4';

/**
 * RPZ owner-name and action-RR encoding (BIND Response Policy Zones).
 * CIDR trigger owner names are rebuilt from parsed integer octets, never raw
 * substrings, so a hostile value cannot inject records into the zone file.
 */

function octetsFromNetwork(network: number): [number, number, number, number] {
  return [
    (network >>> 24) & 0xff,
    (network >>> 16) & 0xff,
    (network >>> 8) & 0xff,
    network & 0xff,
  ];
}

export function rpzOwnerName(rule: RpzRule): string {
  if (rule.trigger === 'QNAME') {
    return rule.value;
  }
  const parsed = parseCidr(rule.value);
  if (!parsed) {
    // The write boundary rejects invalid CIDRs, so reaching here means the
    // stored value is corrupt. Refuse to echo it raw — that would be an
    // injection channel a raw-substring encoder silently opens.
    throw new Error(`Rpz rule ${rule.id}: invalid CIDR value for ${rule.trigger} trigger`);
  }
  const [o0, o1, o2, o3] = octetsFromNetwork(parsed.network);
  const suffix = rule.trigger === 'IP' ? 'rpz-ip' : 'rpz-client-ip';
  return `${parsed.prefix}.${o3}.${o2}.${o1}.${o0}.${suffix}`;
}

export function rpzActionRr(rule: RpzRule): string {
  switch (rule.action) {
    case 'NODATA':
      return 'CNAME *.';
    case 'PASSTHRU':
      return 'CNAME rpz-passthru.';
    case 'DROP':
      return 'CNAME rpz-drop.';
    case 'TCP_ONLY':
      return 'CNAME rpz-tcp-only.';
    case 'CNAME': {
      const target = rule.cname ?? '';
      return `CNAME ${target.endsWith('.') ? target : `${target}.`}`;
    }
    case 'NXDOMAIN':
    default:
      return 'CNAME .';
  }
}

export function renderRpzZoneFile(policy: RpzPolicy, rules: RpzRule[]): string {
  const origin = policy.name.endsWith('.') ? policy.name : `${policy.name}.`;
  const lines: string[] = [
    '$TTL 300',
    `$ORIGIN ${origin}`,
    `@ IN SOA localhost. hostmaster.${origin} ( 1 10800 3600 604800 300 )`,
    '@ IN NS localhost.',
  ];

  const sorted = [...rules].sort((a, b) => a.order - b.order);
  for (const rule of sorted) {
    lines.push(`${rpzOwnerName(rule)}\t300\tIN\t${rpzActionRr(rule)}`);
  }

  return lines.join('\n') + '\n';
}
