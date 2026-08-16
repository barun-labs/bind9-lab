import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import type { ChangeSetDeployJob } from '../../types/entities';
import type { StatusPillState } from '../../components/StatusPill/StatusPill';
import { useApi } from '../../data/store';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';
import { StatusPill } from '../../components/StatusPill/StatusPill';

const STATUS_STATE: Record<ChangeSetDeployJob['status'], StatusPillState> = {
  SUCCEEDED: 'synced',
  FAILED: 'error',
  CANCELLED: 'error',
  PARTIAL: 'drift',
  QUEUED: 'pending',
  RUNNING: 'deploying',
};

function formatDate(isoString?: string | null): string {
  if (!isoString) return '—';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return date.toISOString().replace('T', ' ').substring(0, 16);
  } catch {
    return isoString;
  }
}

export function DeploymentHistory() {
  const { configId = 'dns-lab' } = useParams();
  const api = useApi();

  const [jobs, setJobs] = useState<ChangeSetDeployJob[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listChangeSetDeployJobs(configId);
      setJobs(list);
    } catch (err: any) {
      setError(err?.message || 'Failed to load deployment history');
    } finally {
      setLoading(false);
    }
  }, [api, configId]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const columns: DataTableColumn<ChangeSetDeployJob>[] = useMemo(
    () => [
      {
        key: 'createdAt',
        header: 'Created',
        render: (job) => (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
            {formatDate(job.createdAt)}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (job) => <StatusPill state={STATUS_STATE[job.status]} label={job.status} />,
      },
      {
        key: 'changes',
        header: 'Changes',
        render: (job) => job.changeSetItemIds.length,
      },
      {
        key: 'servers',
        header: 'Servers',
        render: (job) => job.targetServerIds.length,
      },
      {
        key: 'result',
        header: 'Result',
        render: (job) => {
          const ok = job.serverResults.filter((r) => r.outcome === 'SUCCEEDED').length;
          return (
            <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>
              {ok}/{job.serverResults.length} ok
            </span>
          );
        },
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
          Deployment History
        </h1>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)' }}>
          Audit log and results of previous deployments.
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
          rows={jobs}
          loading={loading}
          emptyMessage="No deployments yet."
        />
      </div>
    </div>
  );
}

export default DeploymentHistory;
