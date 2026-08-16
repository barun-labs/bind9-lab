import { useState, useEffect, useCallback, useMemo, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { RpzAction, RpzPolicy, View } from '../../types/entities';
import { useApi } from '../../data/store';
import { useAuth } from '../../auth/AuthProvider';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { Select } from '../../components/Select/Select';
import { Modal } from '../../components/Modal/Modal';

const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

const DEFAULT_POLICY_OPTIONS: { label: string; value: RpzAction }[] = [
  { label: 'NXDOMAIN', value: 'NXDOMAIN' },
  { label: 'NODATA', value: 'NODATA' },
  { label: 'PASSTHRU', value: 'PASSTHRU' },
  { label: 'DROP', value: 'DROP' },
  { label: 'TCP_ONLY', value: 'TCP_ONLY' },
  { label: 'CNAME', value: 'CNAME' },
];

export function RpzPolicies() {
  const { configId = 'dns-lab' } = useParams();
  const navigate = useNavigate();
  const api = useApi();
  const { can } = useAuth();
  const canEdit = can('edit', configId);

  const [policies, setPolicies] = useState<RpzPolicy[]>([]);
  const [views, setViews] = useState<View[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [name, setName] = useState<string>('');
  const [viewId, setViewId] = useState<string>('');
  const [defaultPolicy, setDefaultPolicy] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [policyList, viewList] = await Promise.all([api.listRpzPolicies(configId), api.listViews(configId)]);
      setPolicies(policyList);
      setViews(viewList);
    } catch (err: any) {
      setError(err?.message || 'Failed to load RPZ policies');
    } finally {
      setLoading(false);
    }
  }, [api, configId]);

  useEffect(() => {
    load();
  }, [load]);

  const viewNameById = useMemo(() => new Map(views.map((v) => [v.id, v.name])), [views]);
  const viewOptions = useMemo(() => views.map((v) => ({ label: v.name, value: v.id })), [views]);

  const handleOpenAdd = () => {
    setName('');
    setViewId('');
    setDefaultPolicy('');
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setModalError(null);
  };

  const handleSubmit = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (isSubmitting) return;

    const trimmedName = name.trim();
    if (!trimmedName || !viewId) return;
    if (!NAME_PATTERN.test(trimmedName)) {
      setModalError('Name may only contain letters, digits, dots, underscores, and hyphens.');
      return;
    }

    setIsSubmitting(true);
    setModalError(null);

    try {
      await api.createRpzPolicy(configId, {
        name: trimmedName,
        viewId,
        defaultPolicy: (defaultPolicy || undefined) as RpzAction | undefined,
      });
      setIsModalOpen(false);
      await load();
    } catch (err: any) {
      setModalError(err?.message || 'Failed to create RPZ policy');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleView = useCallback(
    (policy: RpzPolicy) => {
      navigate(`/config/${configId}/rpz/${policy.id}`);
    },
    [navigate, configId]
  );

  const handleDelete = useCallback(
    async (policy: RpzPolicy) => {
      if (!window.confirm(`Delete RPZ policy ${policy.name}?`)) {
        return;
      }
      try {
        await api.deleteRpzPolicy(configId, policy.id);
        await load();
      } catch (err: any) {
        setError(err?.message || 'Failed to delete RPZ policy');
      }
    },
    [api, configId, load]
  );

  const columns: DataTableColumn<RpzPolicy>[] = useMemo(() => {
    const cols: DataTableColumn<RpzPolicy>[] = [
      {
        key: 'name',
        header: 'Name',
        render: (p) => (
          <button
            type="button"
            onClick={() => handleView(p)}
            className="btn btn-ghost"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              padding: 0,
              color: 'var(--color-accent-800)',
              cursor: 'pointer',
            }}
          >
            {p.name}
          </button>
        ),
      },
      {
        key: 'view',
        header: 'View',
        render: (p) => (
          <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>
            {viewNameById.get(p.viewId) || p.viewId}
          </span>
        ),
      },
      {
        key: 'defaultPolicy',
        header: 'Default policy',
        render: (p) => p.defaultPolicy || '—',
      },
    ];

    if (canEdit) {
      cols.push({
        key: 'actions',
        header: '',
        width: '100px',
        align: 'right',
        render: (p) => (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => handleDelete(p)}
            aria-label={`Delete RPZ policy ${p.name}`}
          >
            Delete
          </Button>
        ),
      });
    }

    return cols;
  }, [canEdit, handleView, handleDelete, viewNameById]);

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
            Response Policy Zones
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: '13px',
              color: 'var(--color-text-secondary)',
            }}
          >
            DNS filtering and policy enforcement zones, scoped per view.
          </p>
        </div>
        {canEdit && (
          <Button variant="primary" onClick={handleOpenAdd}>
            Add RPZ policy
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
          rows={policies}
          loading={loading}
          emptyMessage="No RPZ policies"
        />
      </div>

      <Modal
        open={isModalOpen}
        onClose={handleCloseModal}
        title="Add RPZ policy"
        actions={
          <>
            <Button variant="secondary" onClick={handleCloseModal}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => handleSubmit()}
              disabled={!name.trim() || !viewId || isSubmitting}
              loading={isSubmitting}
            >
              Create RPZ policy
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {modalError && <InlineAlert tone="error">{modalError}</InlineAlert>}
          <div className="field">
            <label htmlFor="rpz-policy-name">Name</label>
            <Input
              id="rpz-policy-name"
              placeholder="e.g. malware-block"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="rpz-policy-view">View</label>
            <Select
              id="rpz-policy-view"
              value={viewId}
              onChange={(e) => setViewId(e.target.value)}
              placeholder="Select a view"
              options={viewOptions}
            />
          </div>
          <div className="field">
            <label htmlFor="rpz-policy-default">Default policy (optional)</label>
            <Select
              id="rpz-policy-default"
              value={defaultPolicy}
              onChange={(e) => setDefaultPolicy(e.target.value)}
              placeholder="None"
              options={DEFAULT_POLICY_OPTIONS}
            />
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default RpzPolicies;
