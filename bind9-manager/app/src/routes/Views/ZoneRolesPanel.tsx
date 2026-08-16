import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import type { EffectiveRole, DeploymentRoleRow } from '../../data/apiAdapter';
import { useApi, useStore } from '../../data/store';
import { InheritanceControl, type InheritanceMode } from '../../components/InheritanceControl/InheritanceControl';
import { Select } from '../../components/Select/Select';
import { SERVER_ROLES } from '../../lib/optionKinds';

interface RoleEntry {
  serverId: string;
  hostname: string;
  mode: InheritanceMode;
  inheritedRole?: string;
  rowId?: string;
  rowRole?: string;
  effectiveRole?: string;
}

export function ZoneRolesPanel() {
  const { configId = 'dns-lab', zoneId = '' } = useParams();
  const api = useApi();
  const store = useStore();

  const zone = useMemo(() => store.zones.find((z) => z.id === zoneId), [store.zones, zoneId]);
  const viewId = zone?.viewId ?? '';

  const [effective, setEffective] = useState<EffectiveRole[]>([]);
  const [zoneRows, setZoneRows] = useState<DeploymentRoleRow[]>([]);
  const [viewRows, setViewRows] = useState<DeploymentRoleRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [eff, zRows, vRows] = await Promise.all([
      api.getEffectiveZoneRoles(configId, zoneId),
      api.listDeploymentRoles(configId, 'ZONE', zoneId),
      api.listDeploymentRoles(configId, 'VIEW', viewId),
    ]);
    setEffective(eff);
    setZoneRows(zRows);
    setViewRows(vRows);
    setLoading(false);
  }, [api, configId, zoneId, viewId]);

  useEffect(() => {
    load();
  }, [load]);

  const servers = useMemo(
    () => (store.servers as any[]).filter((s) => s.configurationId === configId),
    [store.servers, configId]
  );

  const entries: RoleEntry[] = useMemo(
    () =>
      servers.map((server) => {
        const eff = effective.find((e) => e.serverId === server.id);
        const row = zoneRows.find((r) => r.serverId === server.id);
        const viewRow = viewRows.find((r) => r.serverId === server.id && !r.disabled);
        return {
          serverId: server.id,
          hostname: server.hostname,
          mode: eff?.mode ?? 'INHERIT',
          inheritedRole: viewRow?.role,
          rowId: row?.id,
          rowRole: row?.role,
          effectiveRole: eff?.role,
        };
      }),
    [servers, effective, zoneRows, viewRows]
  );

  const handleOverride = async (entry: RoleEntry) => {
    const role = entry.rowRole ?? entry.inheritedRole ?? SERVER_ROLES[0];
    if (entry.rowId) {
      await api.updateDeploymentRole(configId, entry.rowId, { disabled: false, role });
    } else {
      await api.createDeploymentRole(configId, { scope: 'ZONE', scopeId: zoneId, serverId: entry.serverId, role });
    }
    await load();
  };

  const handleInherit = async (entry: RoleEntry) => {
    if (entry.rowId) {
      await api.deleteDeploymentRole(configId, entry.rowId);
    }
    await load();
  };

  const handleDisable = async (entry: RoleEntry) => {
    if (entry.rowId) {
      await api.updateDeploymentRole(configId, entry.rowId, { disabled: true });
    } else {
      const role = entry.inheritedRole ?? SERVER_ROLES[0];
      await api.createDeploymentRole(configId, {
        scope: 'ZONE',
        scopeId: zoneId,
        serverId: entry.serverId,
        role,
        disabled: true,
      });
    }
    await load();
  };

  const handleRoleChange = async (entry: RoleEntry, role: string) => {
    if (!entry.rowId) return;
    await api.updateDeploymentRole(configId, entry.rowId, { role });
    await load();
  };

  if (loading) {
    return <div style={{ padding: '20px 32px' }}>Loading…</div>;
  }

  return (
    <div style={{ padding: '20px 32px', maxWidth: 'var(--chrome-max-content-w, 1040px)', width: '100%', boxSizing: 'border-box' }}>
      <p
        style={{
          margin: '0 0 14px',
          fontSize: '12px',
          color: 'color-mix(in srgb, var(--color-text) 60%, transparent)',
          maxWidth: '68ch',
        }}
      >
        Inherit takes the role assigned on this zone's view. Override assigns a zone-specific
        role. Disable means this server does not serve this zone.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {entries.map((entry) => (
          <div
            key={entry.serverId}
            style={{ border: '1px solid var(--color-divider)', background: 'var(--color-surface)', padding: '12px 16px' }}
          >
            <InheritanceControl
              label={entry.hostname}
              mode={entry.mode}
              inheritedDisplay={entry.inheritedRole ?? '(no role)'}
              onInherit={() => handleInherit(entry)}
              onOverride={() => handleOverride(entry)}
              onDisable={() => handleDisable(entry)}
            >
              <Select
                aria-label={`Role for ${entry.hostname}`}
                value={entry.rowRole ?? entry.effectiveRole ?? SERVER_ROLES[0]}
                onChange={(e) => handleRoleChange(entry, e.target.value)}
                options={SERVER_ROLES.map((role) => ({ label: role, value: role }))}
              />
            </InheritanceControl>
          </div>
        ))}
        {entries.length === 0 && (
          <p style={{ fontSize: '13px', color: 'color-mix(in srgb, var(--color-text) 55%, transparent)' }}>
            No servers in this configuration
          </p>
        )}
      </div>
    </div>
  );
}

export default ZoneRolesPanel;
