import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Snapshot } from '../../types/entities';
import { useApi } from '../../data/store';
import { useAuth } from '../../auth/AuthProvider';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';
import { Button } from '../../components/Button/Button';
import { Modal } from '../../components/Modal/Modal';

const RESTORE_CONSEQUENCE =
  "This replaces the current configuration's views/zones/records/... with this snapshot. A deploy is still required to push it.";

export function SnapshotDetail() {
  const { configId = 'dns-lab', snapshotId = '' } = useParams();
  const navigate = useNavigate();
  const api = useApi();
  const { can } = useAuth();
  const canEdit = can('edit', configId);

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState<boolean>(false);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [restoreSuccess, setRestoreSuccess] = useState<boolean>(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const found = await api.getSnapshot(configId, snapshotId);
      if (!found) {
        setError('Snapshot not found');
        return;
      }
      setSnapshot(found);
    } catch (err: any) {
      setError(err?.message || 'Failed to load snapshot');
    } finally {
      setLoading(false);
    }
  }, [api, configId, snapshotId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleConfirmRestore = async () => {
    if (isRestoring) return;
    setIsRestoring(true);
    setError(null);
    try {
      await api.restoreSnapshot(configId, snapshotId);
      setIsRestoreModalOpen(false);
      setRestoreSuccess(true);
    } catch (err: any) {
      setError(err?.message || 'Failed to restore snapshot');
    } finally {
      setIsRestoring(false);
    }
  };

  const handleDelete = useCallback(async () => {
    if (!snapshot || !window.confirm(`Delete snapshot "${snapshot.label}"?`)) {
      return;
    }
    try {
      await api.deleteSnapshot(configId, snapshot.id);
      navigate(`/config/${configId}/backups`);
    } catch (err: any) {
      setError(err?.message || 'Failed to delete snapshot');
    }
  }, [api, configId, navigate, snapshot]);

  if (loading) {
    return (
      <div style={{ padding: '24px 32px' }}>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>Loading snapshot…</p>
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div style={{ padding: '24px 32px' }}>
        <InlineAlert tone="error">{error}</InlineAlert>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div style={{ padding: '24px 32px' }}>
        <InlineAlert tone="error">Snapshot not found</InlineAlert>
      </div>
    );
  }

  const countEntries = Object.entries(snapshot.counts).sort(([a], [b]) => a.localeCompare(b));

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
            {snapshot.label || '(no label)'}
          </h1>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)' }}>
            {snapshot.source} · captured {snapshot.createdAt}
          </p>
        </div>
        <Button variant="secondary" onClick={() => navigate(`/config/${configId}/backups`)}>
          Back
        </Button>
      </div>

      {restoreSuccess && (
        <InlineAlert tone="info" style={{ marginBottom: '16px' }}>
          Snapshot restored. A deploy is still required to push it to servers.
        </InlineAlert>
      )}
      {error && (
        <InlineAlert tone="error" style={{ marginBottom: '16px' }}>
          {error}
        </InlineAlert>
      )}

      {canEdit && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
          <Button variant="destructive" onClick={() => setIsRestoreModalOpen(true)}>
            Restore
          </Button>
          <Button variant="destructive" onClick={handleDelete}>
            Delete
          </Button>
        </div>
      )}

      <h2 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 12px 0', fontFamily: 'var(--font-heading)' }}>
        Contents
      </h2>
      <div style={{ border: '1px solid var(--color-divider)', background: 'var(--color-surface)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <tbody>
            {countEntries.map(([table, count]) => (
              <tr key={table} style={{ borderBottom: '1px solid var(--color-divider)' }}>
                <td style={{ padding: '8px 16px', fontFamily: 'var(--font-mono)' }}>{table}</td>
                <td style={{ padding: '8px 16px', textAlign: 'right', color: 'var(--color-text-secondary)' }}>{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={isRestoreModalOpen}
        onClose={() => !isRestoring && setIsRestoreModalOpen(false)}
        title="Restore snapshot?"
        actions={
          <>
            <Button variant="secondary" onClick={() => setIsRestoreModalOpen(false)} disabled={isRestoring}>
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
            Restore <strong>{snapshot.label || '(no label)'}</strong>?
          </p>
          <InlineAlert tone="warn">{RESTORE_CONSEQUENCE}</InlineAlert>
        </div>
      </Modal>
    </div>
  );
}

export default SnapshotDetail;
