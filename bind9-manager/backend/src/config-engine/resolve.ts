import type { ConfigModel, DeploymentOption, ServerRole, View, Zone } from './model';
import type { EffectiveOption } from '../../../shared/entities';
import { ZONE_SCOPE_KEYS } from '../server/deploymentOptions';

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
      return found.disabled ? undefined : found.value;
    }
  }

  return undefined;
}

/**
 * Resolve the effective value of every ZONE-scope option for one zone.
 * VIEW/ZONE rows resolve independent of server, so serverId defaults to the
 * first server (or '') only to satisfy resolveOption's signature.
 *
 * A key appears in the result only when it has an explicit ZONE-scope row or
 * resolves to a non-undefined inherited value.
 */
export function effectiveZoneOptions(
  model: ConfigModel,
  viewId: string,
  zoneId: string,
): EffectiveOption[] {
  const serverId = model.servers?.[0]?.id ?? '';
  const result: EffectiveOption[] = [];

  for (const key of ZONE_SCOPE_KEYS) {
    const zoneRow = model.options?.find(
      (o) => o.scopeType === 'ZONE' && o.scopeId === zoneId && o.key === key,
    );

    if (zoneRow && zoneRow.disabled) {
      result.push({
        key,
        mode: 'DISABLE',
        effectiveValue: null,
        inheritedValue: resolveOption(model, { serverId, viewId }, key),
      });
      continue;
    }

    if (zoneRow) {
      result.push({
        key,
        mode: 'OVERRIDE',
        effectiveValue: zoneRow.value,
        inheritedValue: resolveOption(model, { serverId, viewId }, key),
      });
      continue;
    }

    const inheritedValue = resolveOption(model, { serverId, viewId }, key);
    if (inheritedValue !== undefined) {
      result.push({ key, mode: 'INHERIT', effectiveValue: inheritedValue, inheritedValue });
    }
  }

  return result;
}

/**
 * Resolve the effective role a server plays for one zone, with the source
 * mode. Mirror of effectiveZoneOptions for the role matrix:
 * - OVERRIDE: explicit ZONE row (role from that row)
 * - DISABLE:  zone row with disabled=true suppresses any role for that server
 * - INHERIT:  no zone row, role from the view's row
 */
export function effectiveZoneRoles(
  model: ConfigModel,
  viewId: string,
  zoneId: string,
): { serverId: string; role: ServerRole; mode: 'OVERRIDE' | 'DISABLE' | 'INHERIT' }[] {
  const zoneRows = (model.roleRows ?? []).filter(
    (r) => r.scope === 'ZONE' && r.scopeId === zoneId,
  );
  const viewRows = (model.roleRows ?? []).filter(
    (r) => r.scope === 'VIEW' && r.scopeId === viewId,
  );
  const serverIds = new Set<string>([
    ...zoneRows.map((r) => r.serverId),
    ...viewRows.map((r) => r.serverId),
  ]);
  const result: { serverId: string; role: ServerRole; mode: 'OVERRIDE' | 'DISABLE' | 'INHERIT' }[] = [];
  for (const serverId of serverIds) {
    const zoneRow = zoneRows.find((r) => r.serverId === serverId);
    if (zoneRow) {
      result.push({
        serverId,
        role: zoneRow.role as ServerRole,
        mode: zoneRow.disabled ? 'DISABLE' : 'OVERRIDE',
      });
      continue;
    }
    const viewRow = viewRows.find((r) => r.serverId === serverId);
    if (viewRow && !viewRow.disabled) {
      result.push({ serverId, role: viewRow.role as ServerRole, mode: 'INHERIT' });
    }
  }
  return result;
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
