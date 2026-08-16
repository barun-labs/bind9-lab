import { useState, useEffect, useCallback, useMemo, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Acl } from '../../types/entities';
import { useApi } from '../../data/store';
import { useAuth } from '../../auth/AuthProvider';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { Modal } from '../../components/Modal/Modal';

const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export function Acls() {
  const { configId = 'dns-lab' } = useParams();
  const navigate = useNavigate();
  const api = useApi();
  const { can } = useAuth();
  const canEdit = can('edit', configId);

  const [acls, setAcls] = useState<Acl[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [name, setName] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const loadAcls = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listAcls(configId);
      setAcls(list);
    } catch (err: any) {
      setError(err?.message || 'Failed to load ACLs');
    } finally {
      setLoading(false);
    }
  }, [api, configId]);

  useEffect(() => {
    loadAcls();
  }, [loadAcls]);

  const handleOpenAdd = () => {
    setName('');
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setName('');
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
      await api.createAcl(configId, { name: trimmedName });
      setIsModalOpen(false);
      setName('');
      await loadAcls();
    } catch (err: any) {
      setModalError(err?.message || 'Failed to create ACL');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = useCallback(
    (acl: Acl) => {
      navigate(`/config/${configId}/acls/${acl.id}`);
    },
    [navigate, configId]
  );

  const handleDelete = useCallback(
    async (acl: Acl) => {
      if (!window.confirm(`Delete ACL ${acl.name}?`)) {
        return;
      }
      try {
        await api.deleteAcl(configId, acl.id);
        await loadAcls();
      } catch (err: any) {
        setError(err?.message || 'Failed to delete ACL');
      }
    },
    [api, configId, loadAcls]
  );

  const columns: DataTableColumn<Acl>[] = useMemo(() => {
    const cols: DataTableColumn<Acl>[] = [
      {
        key: 'name',
        header: 'Name',
        render: (a) => (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{a.name}</span>
        ),
      },
      {
        key: 'entries',
        header: 'Entries',
        render: (a) => a.entries.length,
      },
      {
        key: 'usedBy',
        header: 'Used by',
        render: (a) => a.usedByCount,
      },
    ];

    if (canEdit) {
      cols.push({
        key: 'actions',
        header: '',
        width: '150px',
        align: 'right',
        render: (a) => (
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button size="sm" onClick={() => handleEdit(a)}>
              Edit
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => handleDelete(a)}
              aria-label={`Delete ACL ${a.name}`}
            >
              Delete
            </Button>
          </div>
        ),
      });
    }

    return cols;
  }, [canEdit, handleEdit, handleDelete]);

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
            ACLs
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: '13px',
              color: 'var(--color-text-secondary)',
            }}
          >
            Named access control lists for queries, transfers, and recursive lookups.
          </p>
        </div>
        {canEdit && (
          <Button variant="primary" onClick={handleOpenAdd}>
            Add ACL
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
          rows={acls}
          loading={loading}
          emptyMessage="No ACLs"
        />
      </div>

      <Modal
        open={isModalOpen}
        onClose={handleCloseModal}
        title="Add ACL"
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
              Create ACL
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {modalError && <InlineAlert tone="error">{modalError}</InlineAlert>}
          <div className="field">
            <label htmlFor="acl-name">Name</label>
            <Input
              id="acl-name"
              placeholder="e.g. internal-clients"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default Acls;
