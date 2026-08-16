import { useState, useEffect, useCallback, useMemo, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ServerGroup } from '../../types/entities';
import { useApi } from '../../data/store';
import { useAuth } from '../../auth/AuthProvider';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { Modal } from '../../components/Modal/Modal';

const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export function ServerGroups() {
  const { configId = 'dns-lab' } = useParams();
  const navigate = useNavigate();
  const api = useApi();
  const { can } = useAuth();
  const canEdit = can('edit', configId);

  const [groups, setGroups] = useState<ServerGroup[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [name, setName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listServerGroups(configId);
      setGroups(list);
    } catch (err: any) {
      setError(err?.message || 'Failed to load server groups');
    } finally {
      setLoading(false);
    }
  }, [api, configId]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  const handleOpenAdd = () => {
    setName('');
    setDescription('');
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setName('');
    setDescription('');
    setModalError(null);
  };

  const handleSubmit = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (isSubmitting) return;

    const trimmedName = name.trim();
    if (!trimmedName) return;
    if (!NAME_PATTERN.test(trimmedName)) {
      setModalError('Name may only contain letters, digits, dots, underscores, and hyphens.');
      return;
    }

    setIsSubmitting(true);
    setModalError(null);

    try {
      await api.createServerGroup(configId, { name: trimmedName, description: description.trim() || undefined });
      setIsModalOpen(false);
      setName('');
      setDescription('');
      await loadGroups();
    } catch (err: any) {
      setModalError(err?.message || 'Failed to create server group');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleView = useCallback(
    (group: ServerGroup) => {
      navigate(`/config/${configId}/groups/${group.id}`);
    },
    [navigate, configId]
  );

  const handleDelete = useCallback(
    async (group: ServerGroup) => {
      if (!window.confirm(`Delete server group ${group.name}?`)) {
        return;
      }
      try {
        await api.deleteServerGroup(configId, group.id);
        await loadGroups();
      } catch (err: any) {
        setError(err?.message || 'Failed to delete server group');
      }
    },
    [api, configId, loadGroups]
  );

  const columns: DataTableColumn<ServerGroup>[] = useMemo(() => {
    const cols: DataTableColumn<ServerGroup>[] = [
      {
        key: 'name',
        header: 'Name',
        render: (g) => (
          <button
            type="button"
            onClick={() => handleView(g)}
            className="btn btn-ghost"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              padding: 0,
              color: 'var(--color-accent-800)',
              cursor: 'pointer',
            }}
          >
            {g.name}
          </button>
        ),
      },
      {
        key: 'description',
        header: 'Description',
        render: (g) => (
          <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>
            {g.description || '—'}
          </span>
        ),
      },
      {
        key: 'members',
        header: 'Members',
        render: (g) => g.memberCount,
      },
    ];

    if (canEdit) {
      cols.push({
        key: 'actions',
        header: '',
        width: '100px',
        align: 'right',
        render: (g) => (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => handleDelete(g)}
            aria-label={`Delete server group ${g.name}`}
          >
            Delete
          </Button>
        ),
      });
    }

    return cols;
  }, [canEdit, handleView, handleDelete]);

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
          <h1
            style={{
              fontSize: '24px',
              fontWeight: 600,
              margin: '0 0 6px 0',
              fontFamily: 'var(--font-heading)',
            }}
          >
            Server Groups
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: '13px',
              color: 'var(--color-text-secondary)',
            }}
          >
            Logical server clusters and deployment synchronization.
          </p>
        </div>
        {canEdit && (
          <Button variant="primary" onClick={handleOpenAdd}>
            Add server group
          </Button>
        )}
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
          rows={groups}
          loading={loading}
          emptyMessage="No server groups"
        />
      </div>

      <Modal
        open={isModalOpen}
        onClose={handleCloseModal}
        title="Add server group"
        actions={
          <>
            <Button variant="secondary" onClick={handleCloseModal}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => handleSubmit()}
              disabled={!name.trim() || isSubmitting}
              loading={isSubmitting}
            >
              Create server group
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {modalError && <InlineAlert tone="error">{modalError}</InlineAlert>}
          <div className="field">
            <label htmlFor="server-group-name">Name</label>
            <Input
              id="server-group-name"
              placeholder="e.g. edge-pop-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="server-group-description">Description (optional)</label>
            <Input
              id="server-group-description"
              placeholder="e.g. Edge secondaries in POP1"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default ServerGroups;
