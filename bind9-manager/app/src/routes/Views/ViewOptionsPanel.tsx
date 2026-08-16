import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import type { DeploymentOptionRow } from '../../data/apiAdapter';
import { useApi } from '../../data/store';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';

export function ViewOptionsPanel() {
  const { configId = 'dns-lab', viewId = '' } = useParams();
  const api = useApi();

  const [rows, setRows] = useState<DeploymentOptionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const list = await api.listDeploymentOptions(configId, 'VIEW', viewId);
    setRows(list);
    setLoading(false);
  }, [api, configId, viewId]);

  useEffect(() => {
    load();
  }, [load]);

  const columns: DataTableColumn<DeploymentOptionRow>[] = useMemo(
    () => [
      {
        key: 'key',
        header: 'Key',
        render: (r) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{r.key}</span>,
      },
      {
        key: 'value',
        header: 'Value',
        render: (r) => (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
            {typeof r.value === 'object' ? JSON.stringify(r.value) : String(r.value)}
          </span>
        ),
      },
    ],
    []
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
          emptyMessage="No view-scope options set"
        />
      </div>
    </div>
  );
}

export default ViewOptionsPanel;
