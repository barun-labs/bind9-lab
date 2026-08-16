import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import type { ExternalHost } from '../../types/entities';
import { useApi } from '../../data/store';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';

export function ExternalHosts() {
  const { configId = 'dns-lab' } = useParams();
  const api = useApi();

  const [hosts, setHosts] = useState<ExternalHost[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadHosts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listExternalHosts(configId);
      setHosts(res.data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load external hosts');
    } finally {
      setLoading(false);
    }
  }, [api, configId]);

  useEffect(() => {
    loadHosts();
  }, [loadHosts]);

  const columns: DataTableColumn<ExternalHost>[] = useMemo(
    () => [
      {
        key: 'fqdn',
        header: 'FQDN',
        render: (h) => (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{h.fqdn}</span>
        ),
      },
      {
        key: 'references',
        header: 'References',
        render: (h) => h.referenceCount,
      },
    ],
    []
  );

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
          External Hosts
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: '13px',
            color: 'var(--color-text-secondary)',
          }}
        >
          Known target hosts outside the managed zones.
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
          rows={hosts}
          loading={loading}
          emptyMessage="No external hosts"
        />
      </div>
    </div>
  );
}

export default ExternalHosts;
