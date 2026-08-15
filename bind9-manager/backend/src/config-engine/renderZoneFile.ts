import type { Zone, ResourceRecord } from '../../../shared/entities';
import { zoneFileLine } from '../../../shared/zonefile';

export function renderZoneFile(zone: Zone, records: ResourceRecord[]): string {
  const origin = zone.name.endsWith('.') ? zone.name : `${zone.name}.`;
  const lines: string[] = [
    `$TTL ${zone.soa.minimum}`,
    `$ORIGIN ${origin}`,
    `@ IN SOA ${zone.soa.primaryNs} ${zone.soa.adminEmail} ( ${zone.soa.serial} ${zone.soa.refresh} ${zone.soa.retry} ${zone.soa.expire} ${zone.soa.minimum} )`,
  ];

  for (const record of records) {
    if (!record.disabled) {
      lines.push(zoneFileLine(record.name, record.ttl, record.type, record.rdata));
    }
  }

  return lines.join('\n') + '\n';
}
