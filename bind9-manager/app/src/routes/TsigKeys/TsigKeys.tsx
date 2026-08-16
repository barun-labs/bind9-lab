import { useState, useEffect, useCallback, useMemo, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import type { TsigKey, TsigAlgorithm } from '../../types/entities';
import { useApi } from '../../data/store';
import { useAuth } from '../../auth/AuthProvider';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { Select } from '../../components/Select/Select';
import { Modal } from '../../components/Modal/Modal';
import { CopyButton } from '../../components/CopyButton/CopyButton';

const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

const ALGORITHMS: TsigAlgorithm[] = [
  'hmac-sha256',
  'hmac-sha512',
  'hmac-sha384',
  'hmac-sha224',
  'hmac-sha1',
  'hmac-md5',
];
const ALGORITHM_OPTIONS = ALGORITHMS.map((a) => ({ label: a, value: a }));

export function TsigKeys() {
  const { configId = 'dns-lab' } = useParams();
  const api = useApi();
  const { can } = useAuth();
  const canEdit = can('edit', configId);

  const [keys, setKeys] = useState<TsigKey[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [name, setName] = useState<string>('');
  const [algorithm, setAlgorithm] = useState<TsigAlgorithm>('hmac-sha256');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listTsigKeys(configId);
      setKeys(list);
    } catch (err: any) {
      setError(err?.message || 'Failed to load TSIG keys');
    } finally {
      setLoading(false);
    }
  }, [api, configId]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const handleOpenAdd = () => {
    setName('');
    setAlgorithm('hmac-sha256');
    setModalError(null);
    setCreatedSecret(null);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setName('');
    setModalError(null);
    setCreatedSecret(null);
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
      const created = await api.createTsigKey(configId, { name: trimmedName, algorithm });
      setCreatedSecret(created.secret ?? null);
      await loadKeys();
    } catch (err: any) {
      setModalError(err?.message || 'Failed to create TSIG key');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = useCallback(
    async (key: TsigKey) => {
      if (!window.confirm(`Delete TSIG key ${key.name}?`)) {
        return;
      }
      try {
        await api.deleteTsigKey(configId, key.id);
        await loadKeys();
      } catch (err: any) {
        setError(err?.message || 'Failed to delete TSIG key');
      }
    },
    [api, configId, loadKeys]
  );

  const columns: DataTableColumn<TsigKey>[] = useMemo(() => {
    const cols: DataTableColumn<TsigKey>[] = [
      {
        key: 'name',
        header: 'Name',
        render: (k) => (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{k.name}</span>
        ),
      },
      {
        key: 'algorithm',
        header: 'Algorithm',
        render: (k) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{k.algorithm}</span>,
      },
      {
        key: 'usedBy',
        header: 'Used by',
        render: (k) => k.usedByCount,
      },
    ];

    if (canEdit) {
      cols.push({
        key: 'actions',
        header: '',
        width: '100px',
        align: 'right',
        render: (k) => (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => handleDelete(k)}
            aria-label={`Delete TSIG key ${k.name}`}
          >
            Delete
          </Button>
        ),
      });
    }

    return cols;
  }, [canEdit, handleDelete]);

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
            TSIG Keys
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: '13px',
              color: 'var(--color-text-secondary)',
            }}
          >
            Transaction signature secret keys for authentication and zone transfers.
          </p>
        </div>
        {canEdit && (
          <Button variant="primary" onClick={handleOpenAdd}>
            Add TSIG key
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
          rows={keys}
          loading={loading}
          emptyMessage="No TSIG keys"
        />
      </div>

      <Modal
        open={isModalOpen}
        onClose={handleCloseModal}
        title={createdSecret ? 'TSIG key created' : 'Add TSIG key'}
        actions={
          createdSecret ? (
            <Button variant="primary" onClick={handleCloseModal}>
              Done
            </Button>
          ) : (
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
                Create TSIG key
              </Button>
            </>
          )
        }
      >
        {createdSecret ? (
          <div>
            <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: 'var(--color-text)' }}>
              Your new TSIG key secret has been generated.
            </p>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                background: 'var(--color-bg)',
                border: '1px solid var(--color-divider)',
                padding: '8px 12px',
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
                wordBreak: 'break-all',
                marginBottom: '8px',
              }}
            >
              <span style={{ color: 'var(--color-text)', userSelect: 'all' }}>{createdSecret}</span>
              <CopyButton value={createdSecret} aria-label="Copy TSIG key secret" />
            </div>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--state-drift)', fontWeight: 500 }}>
              Copy it now — it won't be shown again.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {modalError && <InlineAlert tone="error">{modalError}</InlineAlert>}
            <div className="field">
              <label htmlFor="tsig-key-name">Name</label>
              <Input
                id="tsig-key-name"
                placeholder="e.g. secondary-transfer"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="tsig-key-algorithm">Algorithm</label>
              <Select
                id="tsig-key-algorithm"
                value={algorithm}
                onChange={(e) => setAlgorithm(e.target.value as TsigAlgorithm)}
                options={ALGORITHM_OPTIONS}
              />
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

export default TsigKeys;
