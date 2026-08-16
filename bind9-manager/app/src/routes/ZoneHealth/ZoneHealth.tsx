import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import type { HealthFinding } from '../../types/entities';
import { useApi } from '../../data/store';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { StatusPill } from '../../components/StatusPill/StatusPill';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';

const SEVERITY_STATE: Record<HealthFinding['severity'], 'error' | 'drift' | 'disabled'> = {
  ERROR: 'error',
  WARNING: 'drift',
  INFO: 'disabled',
};

export function ZoneHealth() {
  const { configId = 'dns-lab' } = useParams();
  const api = useApi();

  const [findings, setFindings] = useState<HealthFinding[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getConfigHealth(configId);
      setFindings(res.findings ?? []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load health findings');
    } finally {
      setLoading(false);
    }
  }, [api, configId]);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  const columns: DataTableColumn<HealthFinding>[] = useMemo(
    () => [
      {
        key: 'severity',
        header: 'Severity',
        width: '120px',
        render: (f) => (
          <StatusPill state={SEVERITY_STATE[f.severity]} label={f.severity} />
        ),
      },
      {
        key: 'code',
        header: 'Code',
        width: '220px',
        render: (f) => (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{f.code}</span>
        ),
      },
      {
        key: 'message',
        header: 'Message',
        render: (f) => f.message,
      },
      {
        key: 'subject',
        header: 'Subject',
        width: '220px',
        render: (f) => f.subject ?? '—',
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
          Zone Health
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: '13px',
            color: 'var(--color-text-secondary)',
          }}
        >
          Linting and health checks across zones and records.
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
          rows={findings}
          loading={loading}
          emptyMessage="No issues found."
        />
      </div>
    </div>
  );
}

export default ZoneHealth;
