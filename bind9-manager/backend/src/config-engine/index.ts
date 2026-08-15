import type { ConfigModel } from './model';
import { generateNamedConf } from './generateNamedConf';
import { renderZoneFile } from './renderZoneFile';
import { zonesForServer } from './resolve';

export * from './model';
export * from './generateNamedConf';
export * from './renderZoneFile';
export * from './resolve';
export * from './validate';

export function generateServerConfig(
  model: ConfigModel,
  serverId: string,
): Record<string, string> {
  const files: Record<string, string> = {
    'named.conf': generateNamedConf(model, serverId),
  };

  const primaryZones = zonesForServer(model, serverId).filter(
    (entry) => entry.role === 'PRIMARY',
  );

  for (const { zone } of primaryZones) {
    const zoneRecords = model.records?.filter((r) => r.zoneId === zone.id) ?? [];
    const zoneFileName = zone.name === '.' ? 'root' : zone.name;
    files[`zones/db.${zoneFileName}`] = renderZoneFile(zone, zoneRecords);
  }

  return files;
}
