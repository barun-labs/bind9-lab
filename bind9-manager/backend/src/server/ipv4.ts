// IPv4-only CIDR math on unsigned 32-bit integers. No dependencies.

function ipToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

export function isValidIpv4(ip: string): boolean {
  return ipToInt(ip) !== null;
}

function maskFor(prefix: number): number {
  if (prefix === 0) return 0;
  // prefix in 1..32; keep the top `prefix` bits.
  return (0xffffffff << (32 - prefix)) >>> 0;
}

export function parseCidr(cidr: string): { network: number; prefix: number } | null {
  const slash = cidr.indexOf('/');
  if (slash < 0) return null;
  const ip = cidr.slice(0, slash);
  const prefixStr = cidr.slice(slash + 1);
  if (!/^\d{1,2}$/.test(prefixStr)) return null;
  const prefix = Number(prefixStr);
  if (prefix < 0 || prefix > 32) return null;
  const ipInt = ipToInt(ip);
  if (ipInt === null) return null;
  const network = (ipInt & maskFor(prefix)) >>> 0;
  return { network, prefix };
}

export function cidrContainsCidr(parent: string, child: string): boolean {
  const p = parseCidr(parent);
  const c = parseCidr(child);
  if (!p || !c) return false;
  if (p.prefix > c.prefix) return false;
  return ((c.network & maskFor(p.prefix)) >>> 0) === p.network;
}

export function cidrContainsIp(cidr: string, ip: string): boolean {
  const c = parseCidr(cidr);
  const ipInt = ipToInt(ip);
  if (!c || ipInt === null) return false;
  return ((ipInt & maskFor(c.prefix)) >>> 0) === c.network;
}

export function cidrsOverlap(a: string, b: string): boolean {
  const pa = parseCidr(a);
  const pb = parseCidr(b);
  if (!pa || !pb) return false;
  // The block with the shorter prefix (larger range) contains the other's network
  // address iff the ranges overlap.
  const wider = pa.prefix <= pb.prefix ? pa : pb;
  const narrower = pa.prefix <= pb.prefix ? pb : pa;
  return ((narrower.network & maskFor(wider.prefix)) >>> 0) === wider.network;
}

function octets(ip: string): string[] {
  return ip.split('.').map((p) => String(Number(p)));
}

export function reversePtrName(ip: string): string {
  const o = octets(ip);
  return `${o[3]}.${o[2]}.${o[1]}.${o[0]}.in-addr.arpa`;
}

export function ptrZoneName(ip: string): string {
  const o = octets(ip);
  return `${o[2]}.${o[1]}.${o[0]}.in-addr.arpa`;
}
