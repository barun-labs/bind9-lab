import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import type { DeploymentRoleRow } from '../../data/apiAdapter';
import { useApi, useStore } from '../../data/store';
import { useAuth } from '../../auth/AuthProvider';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { Button } from '../../components/Button/Button';
import { Select } from '../../components/Select/Select';
import { SERVER_ROLES } from '../../lib/optionKinds';

// View scope has no inherit/override/disable — a server is simply assigned a
// role (a VIEW row) or not. The three-state control lives on the zone panel.
export function ViewRolesPanel() {
  const { configId = 'dns-lab', viewId = '' } = useParams();
  const api = useApi();
  const store = useStore();
  const { can } = useAuth();
  const canEdit = can('edit', configId);

  const [rows, setRows] = useState<DeploymentRoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newServerId, setNewServerId] = useState('');
  const [newRole, setNewRole] = useState<string>(SERVER_ROLES[0]);

  const load = useCallback(async () => {
    setLoading(true);
    const list = await api.listDeploymentRoles(configId, 'VIEW', viewId);
    setRows(list);
    setLoading(false);
  }, [api, configId, viewId]);

  useEffect(() => {
    load();
  }, [load]);

  const servers = useMemo(
    () => (store.servers as any[]).filter((s) => s.configurationId === configId),
    [store.servers, configId]
  );

  const availableServers = useMemo(
    () => servers.filter((s) => !rows.some((r) => r.serverId === s.id)),
    [servers, rows]
  );

  useEffect(() => {
    if (newServerId && !availableServers.some((s) => s.id === newServerId)) setNewServerId('');
    if (!newServerId && availableServers.length > 0) setNewServerId(availableServers[0].id);
  }, [availableServers, newServerId]);

  const handleAdd = async () => {
    if (!newServerId) return;
    await api.createDeploymentRole(configId, { scope: 'VIEW', scopeId: viewId, serverId: newServerId, role: newRole });
    await load();
  };

  const handleRoleChange = async (row: DeploymentRoleRow, role: string) => {
    await api.updateDeploymentRole(configId, row.id, { role });
    await load();
  };

  const handleDelete = async (row: DeploymentRoleRow) => {
    await api.deleteDeploymentRole(configId, row.id);
    await load();
  };

  const columns: DataTableColumn<DeploymentRoleRow>[] = useMemo(() => {
    const cols: DataTableColumn<DeploymentRoleRow>[] = [
      {
        key: 'serverId',
        header: 'Server',
        render: (r) => {
          const server = servers.find((s) => s.id === r.serverId);
          return (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
              {server?.hostname ?? r.serverId}
            </span>
          );
        },
      },
      {
        key: 'role',
        header: 'Role',
        render: (r) =>
          canEdit ? (
            <Select
              aria-label={`Role for ${r.serverId}`}
              value={r.role}
              onChange={(e) => handleRoleChange(r, e.target.value)}
              options={SERVER_ROLES.map((role) => ({ label: role, value: role }))}
            />
          ) : (
            <span className="tag tag-neutral">{r.role}</span>
          ),
      },
    ];
    if (canEdit) {
      cols.push({
        key: 'actions',
        header: '',
        align: 'right',
        render: (r) => (
          <Button variant="destructive" size="sm" onClick={() => handleDelete(r)} aria-label={`Delete role for ${r.serverId}`}>
            Delete
          </Button>
        ),
      });
    }
    return cols;
  }, [servers, canEdit]);

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
        View-scope roles are simply assigned or unassigned. The inherit / override / disable
        control applies below this, on each zone.
      </p>

      {canEdit && availableServers.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '14px' }}>
          <Select
            aria-label="Server to add"
            value={newServerId}
            onChange={(e) => setNewServerId(e.target.value)}
            options={availableServers.map((s) => ({ label: s.hostname, value: s.id }))}
            style={{ width: '200px' }}
          />
          <Select
            aria-label="Role to assign"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            options={SERVER_ROLES.map((role) => ({ label: role, value: role }))}
            style={{ width: '160px' }}
          />
          <Button variant="secondary" size="md" onClick={handleAdd}>
            Add role
          </Button>
        </div>
      )}

      <div style={{ border: '1px solid var(--color-divider)', background: 'var(--color-surface)' }}>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          emptyMessage="No view-scope roles set"
        />
      </div>
    </div>
  );
}

export default ViewRolesPanel;
