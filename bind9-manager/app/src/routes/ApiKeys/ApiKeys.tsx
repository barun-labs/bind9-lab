import React, { useState, useEffect, useCallback } from 'react';
import { useApi } from '../../data/store';
import { useAuth } from '../../auth/AuthProvider';
import { seedUsers } from '../../data/users.seed';
import type { ApiKey } from '../../types/entities';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { Checkbox } from '../../components/Checkbox/Checkbox';
import { CopyButton } from '../../components/CopyButton/CopyButton';
import { Modal } from '../../components/Modal/Modal';

function formatDate(isoString?: string | null): string {
  if (!isoString) return 'Never';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return date.toISOString().replace('T', ' ').substring(0, 16);
  } catch {
    return isoString;
  }
}

export function ApiKeys() {
  const { listApiKeys, createApiKey, deleteApiKey } = useApi();
  const { currentUser, can } = useAuth();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [keyName, setKeyName] = useState<string>('');
  const [scopes, setScopes] = useState<('read' | 'write' | 'deploy')[]>(['read', 'write']);
  const [readOnly, setReadOnly] = useState<boolean>(false);
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const fetchKeys = useCallback(async () => {
    try {
      const response = await listApiKeys();
      setKeys(response.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [listApiKeys]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleOpenModal = () => {
    setKeyName('');
    setScopes(['read', 'write']);
    setReadOnly(false);
    setExpiresAt('');
    setCreatedToken(null);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setKeyName('');
    setScopes(['read', 'write']);
    setReadOnly(false);
    setExpiresAt('');
    setCreatedToken(null);
  };

  const handleScopeToggle = (scope: 'read' | 'write' | 'deploy') => {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  const handleCreate = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
    }
    const trimmed = keyName.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const newKey = await createApiKey({
        name: trimmed,
        ownerUserId: currentUser ? currentUser.id : 'usr-admin',
        scopes,
        readOnly,
        expiresAt: expiresAt.trim() ? expiresAt.trim() : null,
      });
      setCreatedToken(newKey.token ?? null);
      await fetchKeys();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteApiKey(id);
      await fetchKeys();
    } catch {
      // ignore
    }
  };

  const getOwnerDisplayName = (ownerUserId: string): string => {
    const user = seedUsers.find((u) => u.id === ownerUserId);
    return user ? user.displayName : ownerUserId;
  };

  const canDeleteKey = useCallback(
    (key: ApiKey) => {
      if (!currentUser) return false;
      if (key.ownerUserId === currentUser.id) return true;
      return currentUser.roles?.some((r) => can('admin', r.configurationId)) ?? false;
    },
    [currentUser, can]
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
            API Keys
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: '13px',
              color: 'var(--color-text-secondary)',
            }}
          >
            Manage API keys for programmatic access to Bind9-Manager.
          </p>
        </div>
        <Button variant="primary" onClick={handleOpenModal}>
          New API key
        </Button>
      </div>

      <div
        style={{
          border: '1px solid var(--color-divider)',
          background: 'var(--color-surface)',
        }}
      >
        <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th scope="col" style={{ padding: '10px 16px' }}>
                Name
              </th>
              <th scope="col" style={{ padding: '10px 16px' }}>
                Owner
              </th>
              <th scope="col" style={{ padding: '10px 16px' }}>
                Scopes
              </th>
              <th scope="col" style={{ padding: '10px 16px' }}>
                Created
              </th>
              <th scope="col" style={{ padding: '10px 16px' }}>
                Last used
              </th>
              <th scope="col" style={{ padding: '10px 16px', textAlign: 'right' }}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    textAlign: 'center',
                    padding: '32px 16px',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  Loading API keys…
                </td>
              </tr>
            ) : keys.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    textAlign: 'center',
                    padding: '32px 16px',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  No API keys yet.
                </td>
              </tr>
            ) : (
              keys.map((key) => (
                <tr key={key.id}>
                  <td style={{ padding: '12px 16px', fontWeight: 600 }}>{key.name}</td>
                  <td
                    style={{
                      padding: '12px 16px',
                      color: 'var(--color-text-secondary)',
                      fontSize: '13px',
                    }}
                  >
                    {getOwnerDisplayName(key.ownerUserId)}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: '13px' }}>
                    <div
                      style={{
                        display: 'inline-flex',
                        gap: '4px',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                      }}
                    >
                      {key.scopes && key.scopes.length > 0 ? (
                        key.scopes.map((s) => (
                          <span key={s} className="tag tag-neutral" style={{ fontSize: '11px' }}>
                            {s}
                          </span>
                        ))
                      ) : (
                        <span
                          style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}
                        >
                          none
                        </span>
                      )}
                      {key.readOnly && (
                        <span className="tag tag-outline" style={{ fontSize: '11px' }}>
                          read-only
                        </span>
                      )}
                    </div>
                  </td>
                  <td
                    style={{
                      padding: '12px 16px',
                      color: 'var(--color-text-secondary)',
                      fontSize: '13px',
                    }}
                  >
                    {formatDate(key.createdAt)}
                  </td>
                  <td
                    style={{
                      padding: '12px 16px',
                      color: 'var(--color-text-secondary)',
                      fontSize: '13px',
                    }}
                  >
                    {formatDate(key.lastUsedAt)}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    {canDeleteKey(key) && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(key.id)}
                        aria-label={`Delete API key ${key.name}`}
                      >
                        Delete
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={isModalOpen}
        onClose={handleCloseModal}
        title={createdToken ? 'API key created' : 'New API key'}
        actions={
          createdToken ? (
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
                onClick={() => handleCreate()}
                disabled={!keyName.trim() || isSubmitting}
                loading={isSubmitting}
              >
                Create key
              </Button>
            </>
          )
        }
      >
        {createdToken ? (
          <div>
            <p
              style={{
                margin: '0 0 12px 0',
                fontSize: '13px',
                color: 'var(--color-text)',
              }}
            >
              Your new API key has been generated.
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
              <span style={{ color: 'var(--color-text)', userSelect: 'all' }}>{createdToken}</span>
              <CopyButton value={createdToken} aria-label="Copy API key token" />
            </div>
            <p
              style={{
                margin: 0,
                fontSize: '12px',
                color: 'var(--state-drift)',
                fontWeight: 500,
              }}
            >
              Copy it now — it won't be shown again.
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleCreate}
            style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
          >
            <div className="field">
              <label htmlFor="api-key-name">Name</label>
              <Input
                id="api-key-name"
                placeholder="e.g. CI/CD Pipeline"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="field">
              <label
                style={{
                  display: 'block',
                  marginBottom: '6px',
                  fontSize: '13px',
                  fontWeight: 500,
                }}
              >
                Scopes
              </label>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <Checkbox
                  id="scope-read"
                  label="read"
                  checked={scopes.includes('read')}
                  onChange={() => handleScopeToggle('read')}
                />
                <Checkbox
                  id="scope-write"
                  label="write"
                  checked={scopes.includes('write')}
                  onChange={() => handleScopeToggle('write')}
                />
                <Checkbox
                  id="scope-deploy"
                  label="deploy"
                  checked={scopes.includes('deploy')}
                  onChange={() => handleScopeToggle('deploy')}
                />
              </div>
            </div>

            <div className="field">
              <Checkbox
                id="api-key-readonly"
                label="Read-only"
                checked={readOnly}
                onChange={(e) => setReadOnly(e.target.checked)}
              />
            </div>

            <div className="field">
              <label htmlFor="api-key-expiry">Expiry date (optional)</label>
              <Input
                id="api-key-expiry"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

export default ApiKeys;
