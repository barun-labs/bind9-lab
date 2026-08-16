import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import type { DeploymentRoleRow } from '../../data/apiAdapter';
import { useApi, useStore } from '../../data/store';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';

export function ViewRolesPanel() {
  const { configId = 'dns-lab', viewId = '' } = useParams();
  const api = useApi();
  const store = useStore();

  const [rows, setRows] = useState<DeploymentRoleRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const list = await api.listDeploymentRoles(configId, 'VIEW', viewId);
    setRows(list);
    setLoading(false);
  }, [api, configId, viewId]);

  useEffect(() => {
    load();
  }, [load]);

  const columns: DataTableColumn<DeploymentRoleRow>[] = useMemo(
    () => [
      {
        key: 'serverId',
        header: 'Server',
        render: (r) => {
          const server = (store.servers as any[]).find((s) => s.id === r.serverId);
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
        render: (r) => <span className="tag tag-neutral">{r.role}</span>,
      },
    ],
    [store.servers]
  );

  return (
    <div style={{ padding: '20px 32px', maxWidth: 'var(--chrome-max-content-w, 1040px)', width: '100%', boxSizing: 'border-box' }}>
      <p
        style={{
          margin: '0 0 14px',
          fontSize: '12px',
          color: 'color-mix(in srgb, var(--color-text) 60%, transparent)',
        }}
      >
        Editing controls (inherit / override / disable) arrive with the zone hub.
      </p>
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
