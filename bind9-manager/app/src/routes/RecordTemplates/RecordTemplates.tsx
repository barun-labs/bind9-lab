import { useState, useEffect, useCallback, useMemo, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { RecordTemplate } from '../../types/entities';
import { useApi } from '../../data/store';
import { useAuth } from '../../auth/AuthProvider';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { Modal } from '../../components/Modal/Modal';

const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export function RecordTemplates() {
  const { configId = 'dns-lab' } = useParams();
  const navigate = useNavigate();
  const api = useApi();
  const { can } = useAuth();
  const canEdit = can('edit', configId);

  const [templates, setTemplates] = useState<RecordTemplate[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [name, setName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listRecordTemplates(configId);
      setTemplates(list);
    } catch (err: any) {
      setError(err?.message || 'Failed to load record templates');
    } finally {
      setLoading(false);
    }
  }, [api, configId]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

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
      await api.createRecordTemplate(configId, { name: trimmedName, description: description.trim() || undefined });
      setIsModalOpen(false);
      setName('');
      setDescription('');
      await loadTemplates();
    } catch (err: any) {
      setModalError(err?.message || 'Failed to create record template');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleView = useCallback(
    (template: RecordTemplate) => {
      navigate(`/config/${configId}/templates/${template.id}`);
    },
    [navigate, configId]
  );

  const handleDelete = useCallback(
    async (template: RecordTemplate) => {
      if (!window.confirm(`Delete record template ${template.name}?`)) {
        return;
      }
      try {
        await api.deleteRecordTemplate(configId, template.id);
        await loadTemplates();
      } catch (err: any) {
        setError(err?.message || 'Failed to delete record template');
      }
    },
    [api, configId, loadTemplates]
  );

  const columns: DataTableColumn<RecordTemplate>[] = useMemo(() => {
    const cols: DataTableColumn<RecordTemplate>[] = [
      {
        key: 'name',
        header: 'Name',
        render: (t) => (
          <button
            type="button"
            onClick={() => handleView(t)}
            className="btn btn-ghost"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              padding: 0,
              color: 'var(--color-accent-800)',
              cursor: 'pointer',
            }}
          >
            {t.name}
          </button>
        ),
      },
      {
        key: 'description',
        header: 'Description',
        render: (t) => (
          <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>
            {t.description || '—'}
          </span>
        ),
      },
      {
        key: 'entries',
        header: 'Entries',
        render: (t) => t.entries.length,
      },
    ];

    if (canEdit) {
      cols.push({
        key: 'actions',
        header: '',
        width: '100px',
        align: 'right',
        render: (t) => (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => handleDelete(t)}
            aria-label={`Delete record template ${t.name}`}
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
            Record Templates
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: '13px',
              color: 'var(--color-text-secondary)',
            }}
          >
            Standardized DNS record sets for new zone provisioning.
          </p>
        </div>
        {canEdit && (
          <Button variant="primary" onClick={handleOpenAdd}>
            Add record template
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
          rows={templates}
          loading={loading}
          emptyMessage="No record templates"
        />
      </div>

      <Modal
        open={isModalOpen}
        onClose={handleCloseModal}
        title="Add record template"
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
              Create record template
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {modalError && <InlineAlert tone="error">{modalError}</InlineAlert>}
          <div className="field">
            <label htmlFor="record-template-name">Name</label>
            <Input
              id="record-template-name"
              placeholder="e.g. standard-web-stack"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="record-template-description">Description (optional)</label>
            <Input
              id="record-template-description"
              placeholder="e.g. www CNAME + MX for new customer zones"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default RecordTemplates;
