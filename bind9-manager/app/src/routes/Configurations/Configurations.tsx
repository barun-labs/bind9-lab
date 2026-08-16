import { useState, useEffect, useCallback, useMemo, type FormEvent } from 'react';
import type { Configuration } from '../../types/entities';
import { useApi } from '../../data/store';
import { useAuth } from '../../auth/AuthProvider';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { Modal } from '../../components/Modal/Modal';

const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

type NameAction = 'create' | 'rename' | 'clone';

function summarizeCounts(counts: Configuration['counts']): string {
  return `${counts.views} views · ${counts.zones} zones · ${counts.records} records · ${counts.servers} servers`;
}

export function Configurations() {
  const api = useApi();
  const { currentUser, can } = useAuth();
  // Matches the backend: POST /configurations and POST /:configId/clone both
  // require admin on ANY configuration, not admin on a specific one.
  const canManage = currentUser?.roles?.some((r) => can('admin', r.configurationId)) ?? false;

  const [configs, setConfigs] = useState<Configuration[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [action, setAction] = useState<NameAction | null>(null);
  const [actionTarget, setActionTarget] = useState<Configuration | null>(null);
  const [nameValue, setNameValue] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Configuration | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.listConfigurations();
      setConfigs(response.data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load configurations');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const handleOpenCreate = () => {
    setAction('create');
    setActionTarget(null);
    setNameValue('');
    setModalError(null);
  };

  const handleOpenRename = useCallback((config: Configuration) => {
    setAction('rename');
    setActionTarget(config);
    setNameValue(config.name);
    setModalError(null);
  }, []);

  const handleOpenClone = useCallback((config: Configuration) => {
    setAction('clone');
    setActionTarget(config);
    setNameValue('');
    setModalError(null);
  }, []);

  const handleCloseActionModal = () => {
    if (isSubmitting) return;
    setAction(null);
    setActionTarget(null);
    setModalError(null);
  };

  const handleSubmitAction = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (isSubmitting || !action) return;

    const trimmedName = nameValue.trim();
    if (!trimmedName) return;
    if (!NAME_PATTERN.test(trimmedName)) {
      setModalError('Name may only contain letters, digits, dots, underscores, and hyphens.');
      return;
    }

    setIsSubmitting(true);
    setModalError(null);

    try {
      if (action === 'create') {
        await api.createConfiguration({ name: trimmedName });
        setNotice(`Created configuration "${trimmedName}".`);
      } else if (action === 'rename' && actionTarget) {
        await api.updateConfiguration(actionTarget.id, { name: trimmedName });
        setNotice(null);
      } else if (action === 'clone' && actionTarget) {
        const cloned = await api.cloneConfiguration(actionTarget.id, { name: trimmedName });
        setNotice(`Cloned "${actionTarget.name}" into "${cloned.name}".`);
      }
      setAction(null);
      setActionTarget(null);
      setNameValue('');
      await load();
    } catch (err: any) {
      setModalError(err?.message || 'Failed to save configuration');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenDelete = useCallback((config: Configuration) => {
    setDeleteTarget(config);
  }, []);

  const handleCloseDelete = () => {
    if (isDeleting) return;
    setDeleteTarget(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    setError(null);
    try {
      await api.deleteConfiguration(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete configuration');
    } finally {
      setIsDeleting(false);
    }
  };

  const columns: DataTableColumn<Configuration>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        render: (c) => (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 600 }}>{c.name}</span>
        ),
      },
      {
        key: 'description',
        header: 'Description',
        render: (c) => (
          <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>{c.description || '—'}</span>
        ),
      },
      {
        key: 'counts',
        header: 'Contents',
        render: (c) => (
          <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>{summarizeCounts(c.counts)}</span>
        ),
      },
      {
        key: 'actions',
        header: '',
        width: '260px',
        align: 'right',
        render: (c) => {
          const canEditRow = can('edit', c.id);
          if (!canEditRow && !canManage) return null;
          return (
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              {canEditRow && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleOpenRename(c)}
                  aria-label={`Rename configuration ${c.name}`}
                >
                  Rename
                </Button>
              )}
              {canManage && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleOpenClone(c)}
                  aria-label={`Clone configuration ${c.name}`}
                >
                  Clone
                </Button>
              )}
              {canEditRow && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleOpenDelete(c)}
                  aria-label={`Delete configuration ${c.name}`}
                >
                  Delete
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [can, canManage, handleOpenRename, handleOpenClone, handleOpenDelete]
  );

  const modalTitle =
    action === 'create'
      ? 'Create configuration'
      : action === 'rename'
      ? `Rename ${actionTarget?.name ?? ''}`
      : `Clone ${actionTarget?.name ?? ''}`;

  const submitLabel =
    action === 'create' ? 'Create configuration' : action === 'rename' ? 'Rename' : 'Clone configuration';

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
            Configurations
          </h1>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)' }}>
            Each Configuration is a fully isolated DNS world — views, zones, records, blocks and servers don't cross
            between them.
          </p>
        </div>
        {canManage && (
          <Button variant="primary" onClick={handleOpenCreate}>
            Create configuration
          </Button>
        )}
      </div>

      {error && (
        <InlineAlert tone="error" style={{ marginBottom: '16px' }}>
          {error}
        </InlineAlert>
      )}
      {notice && (
        <InlineAlert tone="info" style={{ marginBottom: '16px' }}>
          {notice}
        </InlineAlert>
      )}

      <div style={{ border: '1px solid var(--color-divider)', background: 'var(--color-surface)' }}>
        <DataTable columns={columns} rows={configs} loading={loading} emptyMessage="No configurations" />
      </div>

      <Modal
        open={action !== null}
        onClose={handleCloseActionModal}
        title={modalTitle}
        actions={
          <>
            <Button variant="secondary" onClick={handleCloseActionModal} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => handleSubmitAction()}
              disabled={!nameValue.trim() || isSubmitting}
              loading={isSubmitting}
            >
              {submitLabel}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmitAction} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {modalError && <InlineAlert tone="error">{modalError}</InlineAlert>}
          {action === 'clone' && (
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)' }}>
              Deep-copies every view, zone, record, server, ACL and TSIG key from “{actionTarget?.name}” into a new
              configuration.
            </p>
          )}
          <div className="field">
            <label htmlFor="configuration-name">{action === 'clone' ? 'New configuration name' : 'Name'}</label>
            <Input
              id="configuration-name"
              placeholder="e.g. split-horizon-test"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              autoFocus
            />
          </div>
        </form>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={handleCloseDelete}
        title="Delete configuration?"
        actions={
          <>
            <Button variant="secondary" onClick={handleCloseDelete} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete} loading={isDeleting}>
              Delete
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <p style={{ margin: 0, fontSize: '13px' }}>
            Delete <strong>{deleteTarget?.name}</strong>?
          </p>
          <InlineAlert tone="warn">
            This permanently removes the configuration and everything in it — views, zones, records, blocks and
            servers. This cannot be undone.
          </InlineAlert>
        </div>
      </Modal>
    </div>
  );
}

export default Configurations;
