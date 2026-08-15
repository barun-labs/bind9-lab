import type { ConfigModel, DeploymentOption, ServerRole, View, Zone } from './model';

export function resolveOption(
  model: ConfigModel,
  scope: { serverId: string; viewId?: string; zoneId?: string },
  key: string,
): unknown {
  const server = model.servers?.find((s) => s.id === scope.serverId);
  const serverGroupId = server?.serverGroupId;
  const configId = model.configuration?.id;

  // Precedence order (nearest wins): ZONE -> VIEW -> SERVER -> SERVER_GROUP -> CONFIGURATION
  const scopesToCheck: { scopeType: DeploymentOption['scopeType']; scopeId?: string }[] = [];

  if (scope.zoneId) {
    scopesToCheck.push({ scopeType: 'ZONE', scopeId: scope.zoneId });
  }
  if (scope.viewId) {
    scopesToCheck.push({ scopeType: 'VIEW', scopeId: scope.viewId });
  }
  if (scope.serverId) {
    scopesToCheck.push({ scopeType: 'SERVER', scopeId: scope.serverId });
  }
  if (serverGroupId) {
    scopesToCheck.push({ scopeType: 'SERVER_GROUP', scopeId: serverGroupId });
  }
  if (configId) {
    scopesToCheck.push({ scopeType: 'CONFIGURATION', scopeId: configId });
  }
  scopesToCheck.push({ scopeType: 'CONFIGURATION', scopeId: undefined });

  for (const target of scopesToCheck) {
    const found = model.options?.find((opt) => {
      if (opt.key !== key) return false;
      if (opt.scopeType !== target.scopeType) return false;
      if (target.scopeId !== undefined) {
        return opt.scopeId === target.scopeId;
      }
      return !configId || opt.scopeId === configId || opt.scopeId === 'CONFIGURATION' || opt.scopeId === 'global' || !opt.scopeId;
    });
    if (found !== undefined) {
      return found.value;
    }
  }

  return undefined;
}

export function zonesForServer(
  model: ConfigModel,
  serverId: string,
): { zone: Zone; role: ServerRole; view: View }[] {
  const result: { zone: Zone; role: ServerRole; view: View }[] = [];
  for (const roleEntry of model.roles ?? []) {
    if (roleEntry.serverId !== serverId) continue;
    const zone = model.zones?.find((z) => z.id === roleEntry.zoneId);
    if (!zone) continue;
    const view = model.views?.find((v) => v.id === zone.viewId);
    if (!view) continue;
    result.push({ zone, role: roleEntry.role, view });
  }
  return result;
}
