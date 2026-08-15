import type { RecordType } from '../types/entities';

export function rdataDisplay(type: RecordType, rdata: any): string {
  if (!rdata) return '';
  switch (type) {
    case 'A':
    case 'AAAA':
      return String(rdata.address ?? '');
    case 'CNAME':
    case 'NS':
    case 'PTR':
    case 'ALIAS':
      return String(rdata.target ?? '');
    case 'MX':
      return `${rdata.priority ?? 0} ${rdata.target ?? ''}`;
    case 'SRV':
      return `${rdata.priority ?? 0} ${rdata.weight ?? 0} ${rdata.port ?? 0} ${rdata.target ?? ''}`;
    case 'TXT':
      return `"${rdata.text ?? ''}"`;
    case 'CAA':
      return `${rdata.flags ?? 0} ${rdata.tag ?? ''} "${rdata.value ?? ''}"`;
    default:
      return '';
  }
}

export function zoneFileLine(
  name: string,
  ttl: number,
  type: RecordType,
  rdata: any
): string {
  return `${name}\t${ttl}\tIN\t${type}\t${rdataDisplay(type, rdata)}`;
}
