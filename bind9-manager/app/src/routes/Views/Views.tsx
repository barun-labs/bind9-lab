import { useState, useEffect, useCallback, useMemo, type FormEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { View } from '../../types/entities';
import type { CreateViewInput, UpdateViewPatch } from '../../data/apiAdapter';
import { useApi } from '../../data/store';
import { useAuth } from '../../auth/AuthProvider';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { Modal } from '../../components/Modal/Modal';

export function Views() {
  const { configId = 'dns-lab' } = useParams();
  const api = useApi();
  const { can } = useAuth();
  const canEdit = can('edit', configId);

  const [views, setViews] = useState<View[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Modal State (shared between Add and Edit)
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingView, setEditingView] = useState<View | null>(null);
  const [name, setName] = useState<string>('');
  const [order, setOrder] = useState<string>('');
  const [matchClients, setMatchClients] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const loadViews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listViews(configId);
      setViews(list);
    } catch (err: any) {
      setError(err?.message || 'Failed to load views');
    } finally {
      setLoading(false);
    }
  }, [api, configId]);

  useEffect(() => {
    loadViews();
  }, [loadViews]);

  const resetForm = () => {
    setName('');
    setOrder('');
    setMatchClients('');
    setModalError(null);
  };

  const handleOpenAdd = () => {
    setEditingView(null);
    resetForm();
    setIsModalOpen(true);
  };

  const handleOpenEdit = useCallback((view: View) => {
    setEditingView(view);
    setName(view.name);
    setOrder(String(view.order));
    setMatchClients(view.matchClients?.join(', ') ?? '');
    setModalError(null);
    setIsModalOpen(true);
  }, []);

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingView(null);
    resetForm();
  };

  const parseForm = () => {
    const trimmedName = name.trim();
    const orderNum = order.trim() === '' ? undefined : Number(order.trim());
    const clients = matchClients.trim() === ''
      ? undefined
      : matchClients.split(',').map((s) => s.trim()).filter(Boolean);
    return { trimmedName, orderNum, clients };
  };

  const handleSubmit = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (isSubmitting) return;

    const { trimmedName, orderNum, clients } = parseForm();
    if (!trimmedName) return;

    setIsSubmitting(true);
    setModalError(null);

    try {
      if (editingView) {
        const patch: UpdateViewPatch = {
          name: trimmedName,
          ...(orderNum !== undefined && !Number.isNaN(orderNum) ? { order: orderNum } : {}),
          ...(clients ? { matchClients: clients } : {}),
        };
        await api.updateView(configId, editingView.id, patch);
      } else {
        const input: CreateViewInput = {
          name: trimmedName,
          ...(orderNum !== undefined && !Number.isNaN(orderNum) ? { order: orderNum } : {}),
          ...(clients ? { matchClients: clients } : {}),
        };
        await api.createView(configId, input);
      }
      setIsModalOpen(false);
      setEditingView(null);
      resetForm();
      await loadViews();
    } catch (err: any) {
      setModalError(err?.message || 'Failed to save view');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteView = useCallback(
    async (view: View) => {
      if (!window.confirm(`Delete view ${view.name}?`)) {
        return;
      }
      try {
        await api.deleteView(configId, view.id);
        await loadViews();
      } catch (err: any) {
        setError(err?.message || 'Failed to delete view');
      }
    },
    [api, configId, loadViews]
  );

  const columns: DataTableColumn<View>[] = useMemo(() => {
    const cols: DataTableColumn<View>[] = [
      {
        key: 'name',
        header: 'Name',
        render: (v) => (
          <Link
            to={`/config/${configId}/views/${v.id}`}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              color: 'var(--color-accent-800)',
              textDecoration: 'none',
              fontWeight: 500,
            }}
          >
            {v.name}
          </Link>
        ),
      },
      {
        key: 'order',
        header: 'Order',
        render: (v) => v.order,
      },
      {
        key: 'matchClients',
        header: 'Match clients',
        render: (v) => (v.matchClients?.length ? v.matchClients.join(', ') : '—'),
      },
      {
        key: 'zones',
        header: 'Zones',
        render: (v) => v.zoneCount,
      },
    ];

    if (canEdit) {
      cols.push({
        key: 'actions',
        header: '',
        width: '150px',
        align: 'right',
        render: (v) => (
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button size="sm" onClick={() => handleOpenEdit(v)}>
              Edit
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => handleDeleteView(v)}
              aria-label={`Delete view ${v.name}`}
            >
              Delete
            </Button>
          </div>
        ),
      });
    }

    return cols;
  }, [canEdit, handleOpenEdit, handleDeleteView]);

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
            Views
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: '13px',
              color: 'var(--color-text-secondary)',
            }}
          >
            DNS views define distinct query contexts with independent ACLs and zones.
          </p>
        </div>
        {canEdit && (
          <Button variant="primary" onClick={handleOpenAdd}>
            Add View
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
          rows={views}
          loading={loading}
          emptyMessage="No views"
        />
      </div>

      <Modal
        open={isModalOpen}
        onClose={handleCloseModal}
        title={editingView ? 'Edit View' : 'Add View'}
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
              {editingView ? 'Save View' : 'Create View'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {modalError && <InlineAlert tone="error">{modalError}</InlineAlert>}
          <div className="field">
            <label htmlFor="view-name">Name</label>
            <Input
              id="view-name"
              placeholder="e.g. internal"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="field">
            <label htmlFor="view-order">Order</label>
            <Input
              id="view-order"
              placeholder="e.g. 1"
              value={order}
              onChange={(e) => setOrder(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="view-match-clients">Match clients</label>
            <Input
              id="view-match-clients"
              placeholder="e.g. 10.0.0.0/8, 172.20.0.0/16"
              value={matchClients}
              onChange={(e) => setMatchClients(e.target.value)}
            />
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default Views;
