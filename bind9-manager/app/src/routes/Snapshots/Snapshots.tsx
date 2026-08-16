import { useState, useEffect, useCallback, useMemo, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Snapshot } from '../../types/entities';
import { useApi } from '../../data/store';
import { useAuth } from '../../auth/AuthProvider';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { Select } from '../../components/Select/Select';
import { Modal } from '../../components/Modal/Modal';

const RESTORE_CONSEQUENCE =
  "This replaces the current configuration's views/zones/records/... with this snapshot. A deploy is still required to push it.";

function SourceBadge({ source }: { source: Snapshot['source'] }) {
  const isBaseline = source === 'BASELINE';
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: '11px',
        fontWeight: 600,
        letterSpacing: '.04em',
        padding: '2px 6px',
        border: `1px solid ${isBaseline ? 'var(--color-accent)' : 'var(--color-divider)'}`,
        background: isBaseline ? 'var(--color-accent-100)' : 'var(--color-surface)',
        color: isBaseline ? 'var(--color-accent-800)' : 'var(--color-text-secondary)',
      }}
    >
      {source}
    </span>
  );
}

// Compact "N zones, M records" summary — the two counts users care about
// most when scanning the list. Full per-table breakdown lives on the detail
// screen.
function summarizeCounts(counts: Record<string, number>): string {
  const zones = counts.zones ?? 0;
  const records = counts.records ?? 0;
  return `${zones} zone${zones === 1 ? '' : 's'}, ${records} record${records === 1 ? '' : 's'}`;
}

export function Snapshots() {
  const { configId = 'dns-lab' } = useParams();
  const navigate = useNavigate();
  const api = useApi();
  const { can } = useAuth();
  const canEdit = can('edit', configId);

  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [isCaptureModalOpen, setIsCaptureModalOpen] = useState<boolean>(false);
  const [label, setLabel] = useState<string>('');
  const [source, setSource] = useState<'CURRENT' | 'BASELINE'>('CURRENT');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [adopting, setAdopting] = useState<boolean>(false);
  const [restoreTarget, setRestoreTarget] = useState<Snapshot | null>(null);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listSnapshots(configId);
      setSnapshots(list);
    } catch (err: any) {
      setError(err?.message || 'Failed to load snapshots');
    } finally {
      setLoading(false);
    }
  }, [api, configId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleOpenCapture = () => {
    setLabel('');
    setSource('CURRENT');
    setModalError(null);
    setIsCaptureModalOpen(true);
  };

  const handleCloseCapture = () => {
    setIsCaptureModalOpen(false);
    setModalError(null);
  };

  const handleSubmitCapture = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setModalError(null);
    try {
      await api.captureSnapshot(configId, { label: label.trim(), source });
      setIsCaptureModalOpen(false);
      await load();
    } catch (err: any) {
      setModalError(err?.message || 'Failed to capture snapshot');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAdopt = useCallback(async () => {
    if (adopting) return;
    setAdopting(true);
    setError(null);
    try {
      await api.adoptSnapshot(configId);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Failed to adopt baseline snapshot');
    } finally {
      setAdopting(false);
    }
  }, [adopting, api, configId, load]);

  const handleView = useCallback(
    (snapshot: Snapshot) => {
      navigate(`/config/${configId}/backups/${snapshot.id}`);
    },
    [navigate, configId]
  );

  const handleOpenRestore = useCallback((snapshot: Snapshot) => {
    setRestoreTarget(snapshot);
  }, []);

  const handleCloseRestore = () => {
    if (isRestoring) return;
    setRestoreTarget(null);
  };

  const handleConfirmRestore = async () => {
    if (!restoreTarget || isRestoring) return;
    setIsRestoring(true);
    setError(null);
    try {
      await api.restoreSnapshot(configId, restoreTarget.id);
      setRestoreTarget(null);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Failed to restore snapshot');
    } finally {
      setIsRestoring(false);
    }
  };

  const handleDelete = useCallback(
    async (snapshot: Snapshot) => {
      if (!window.confirm(`Delete snapshot "${snapshot.label}"?`)) {
        return;
      }
      try {
        await api.deleteSnapshot(configId, snapshot.id);
        await load();
      } catch (err: any) {
        setError(err?.message || 'Failed to delete snapshot');
      }
    },
    [api, configId, load]
  );

  const columns: DataTableColumn<Snapshot>[] = useMemo(() => {
    const cols: DataTableColumn<Snapshot>[] = [
      {
        key: 'label',
        header: 'Label',
        render: (s) => (
          <button
            type="button"
            onClick={() => handleView(s)}
            className="btn btn-ghost"
            style={{ padding: 0, color: 'var(--color-accent-800)', cursor: 'pointer', fontSize: '13px' }}
          >
            {s.label || '(no label)'}
          </button>
        ),
      },
      {
        key: 'createdAt',
        header: 'Created',
        render: (s) => (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
            {s.createdAt}
          </span>
        ),
      },
      { key: 'source', header: 'Source', render: (s) => <SourceBadge source={s.source} /> },
      {
        key: 'counts',
        header: 'Contents',
        render: (s) => (
          <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>{summarizeCounts(s.counts)}</span>
        ),
      },
    ];

    if (canEdit) {
      cols.push({
        key: 'actions',
        header: '',
        width: '190px',
        align: 'right',
        render: (s) => (
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button variant="secondary" size="sm" onClick={() => handleOpenRestore(s)} aria-label={`Restore snapshot ${s.label}`}>
              Restore
            </Button>
            <Button variant="destructive" size="sm" onClick={() => handleDelete(s)} aria-label={`Delete snapshot ${s.label}`}>
              Delete
            </Button>
          </div>
        ),
      });
    }

    return cols;
  }, [canEdit, handleView, handleOpenRestore, handleDelete]);

  return (
    <div
      style={{
        padding: '24px 32px',
        maxWidth: 'var(--chrome-max-content-w, 1040px)',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: '24px',
          gap: '16px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 600, margin: '0 0 6px 0', fontFamily: 'var(--font-heading)' }}>
            Snapshots
          </h1>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)' }}>
            Configuration snapshots and point-in-time restore points.
          </p>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="secondary" onClick={handleAdopt} loading={adopting}>
              Adopt last-deployed baseline
            </Button>
            <Button variant="primary" onClick={handleOpenCapture}>
              Capture snapshot
            </Button>
          </div>
        )}
      </div>

      {error && (
        <InlineAlert tone="error" style={{ marginBottom: '16px' }}>
          {error}
        </InlineAlert>
      )}

      <div style={{ border: '1px solid var(--color-divider)', background: 'var(--color-surface)' }}>
        <DataTable columns={columns} rows={snapshots} loading={loading} emptyMessage="No snapshots" />
      </div>

      <Modal
        open={isCaptureModalOpen}
        onClose={handleCloseCapture}
        title="Capture snapshot"
        actions={
          <>
            <Button variant="secondary" onClick={handleCloseCapture}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => handleSubmitCapture()} disabled={isSubmitting} loading={isSubmitting}>
              Capture
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmitCapture} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {modalError && <InlineAlert tone="error">{modalError}</InlineAlert>}
          <div className="field">
            <label htmlFor="snapshot-label">Label</label>
            <Input
              id="snapshot-label"
              placeholder="e.g. before breaking split-horizon ACL"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="snapshot-source">Source</label>
            <Select
              id="snapshot-source"
              value={source}
              onChange={(e) => setSource(e.target.value as 'CURRENT' | 'BASELINE')}
              options={[
                { label: 'CURRENT (live definition, as edited)', value: 'CURRENT' },
                { label: 'BASELINE (last-deployed state)', value: 'BASELINE' },
              ]}
            />
          </div>
        </form>
      </Modal>

      <Modal
        open={restoreTarget !== null}
        onClose={handleCloseRestore}
        title="Restore snapshot?"
        actions={
          <>
            <Button variant="secondary" onClick={handleCloseRestore} disabled={isRestoring}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmRestore} loading={isRestoring}>
              Restore
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <p style={{ margin: 0, fontSize: '13px' }}>
            Restore <strong>{restoreTarget?.label || '(no label)'}</strong>?
          </p>
          <InlineAlert tone="warn">{RESTORE_CONSEQUENCE}</InlineAlert>
        </div>
      </Modal>
    </div>
  );
}

export default Snapshots;
