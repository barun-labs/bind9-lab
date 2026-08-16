import type { ConfigModel } from '../config-engine/model';

export type HealthSeverity = 'ERROR' | 'WARNING' | 'INFO';

export interface HealthFinding {
  severity: HealthSeverity;
  code: string;
  message: string;
  subject?: string;
}

const SEVERITY_ORDER: Record<HealthSeverity, number> = { ERROR: 0, WARNING: 1, INFO: 2 };

/**
 * Pure static analysis of an assembled ConfigModel. No exec — reads only the
 * data the model actually carries (views/zones/records/servers; roles and
 * options are currently empty). Returns [] for a clean model.
 */
export function analyzeHealth(model: ConfigModel): HealthFinding[] {
  const findings: HealthFinding[] = [];

  const zoneNamesByView = new Map<string, Set<string>>();
  for (const zone of model.zones) {
    if (!zone.soa || zone.soa.primaryNs === '' || zone.soa.adminEmail === '') {
      findings.push({
        severity: 'ERROR',
        code: 'ZONE_NO_SOA',
        message: `Zone '${zone.name}' has no SOA (primaryNs or adminEmail is empty).`,
        subject: zone.name,
      });
    }

    if (zone.recordCount === 0) {
      findings.push({
        severity: 'WARNING',
        code: 'ZONE_NO_RECORDS',
        message: `Zone '${zone.name}' has no records.`,
        subject: zone.name,
      });
    }

    let names = zoneNamesByView.get(zone.viewId);
    if (!names) {
      names = new Set<string>();
      zoneNamesByView.set(zone.viewId, names);
    }
    if (names.has(zone.name)) {
      findings.push({
        severity: 'ERROR',
        code: 'DUPLICATE_ZONE_NAME',
        message: `Zone '${zone.name}' is duplicated in view '${zone.viewId}'.`,
        subject: zone.name,
      });
    } else {
      names.add(zone.name);
    }
  }

  for (const view of model.views) {
    if (!Array.isArray(view.matchClients) || view.matchClients.length === 0) {
      findings.push({
        severity: 'WARNING',
        code: 'VIEW_NO_MATCH_CLIENTS',
        message: `View '${view.name}' has no match-clients (matches everything).`,
        subject: view.name,
      });
    }
  }

  for (const server of model.servers) {
    if (!Array.isArray(server.serviceInterfaces) || server.serviceInterfaces.length === 0) {
      findings.push({
        severity: 'INFO',
        code: 'SERVER_NO_INTERFACES',
        message: `Server '${server.name ?? server.id}' has no service interfaces.`,
        subject: server.name ?? server.id,
      });
    }
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return findings;
}
