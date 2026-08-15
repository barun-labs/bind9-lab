import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import type { Server } from '../../types/entities';
import { useApi } from '../../data/store';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { StatusPill } from '../../components/StatusPill/StatusPill';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';

export function Servers() {
  const { configId = 'dns-lab' } = useParams();
  const api = useApi();

  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadServers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listServers(configId);
      setServers(list);
    } catch (err: any) {
      setError(err?.message || 'Failed to load servers');
    } finally {
      setLoading(false);
    }
  }, [api, configId]);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  const columns: DataTableColumn<Server>[] = useMemo(() => {
    return [
      {
        key: 'hostname',
        header: 'Hostname',
        render: (s) => (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{s.hostname}</span>
        ),
      },
      {
        key: 'node',
        header: 'Node',
        render: (s) => s.nodeName ?? '—',
      },
      {
        key: 'mgmt',
        header: 'Mgmt address',
        render: (s) => s.mgmtAddress ?? '—',
      },
      {
        key: 'runtime',
        header: 'Runtime address',
        render: (s) => s.runtimeAddress ?? '—',
      },
      {
        key: 'sync',
        header: 'Sync',
        width: '160px',
        render: (s) => <StatusPill state={s.syncState} label={s.syncState} />,
      },
    ];
  }, []);

  return (
    <div
      style={{
        padding: '24px 32px',
        maxWidth: 'var(--chrome-max-content-w, 1040px)',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ marginBottom: '24px' }}>
        <h1
          style={{
            fontSize: '24px',
            fontWeight: 600,
            margin: '0 0 6px 0',
            fontFamily: 'var(--font-heading)',
          }}
        >
          Servers
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: '13px',
            color: 'var(--color-text-secondary)',
          }}
        >
          Managed BIND instances, network interfaces, and containerlab nodes.
        </p>
      </div>

      {error && (
        <InlineAlert tone="error" style={{ marginBottom: '16px' }}>
          {error}
        </InlineAlert>
      )}

      <div
        style={{
          border: '1px solid var(--color-divider)',
          background: 'var(--color-surface)',
        }}
      >
        <DataTable
          columns={columns}
          rows={servers}
          loading={loading}
          emptyMessage="No servers"
        />
      </div>
    </div>
  );
}

export default Servers;
