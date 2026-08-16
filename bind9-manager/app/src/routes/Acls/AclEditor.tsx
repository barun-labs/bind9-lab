import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Acl, AclEntry, AclEntryType } from '../../types/entities';
import { useApi } from '../../data/store';
import { useAuth } from '../../auth/AuthProvider';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { Select } from '../../components/Select/Select';
import { Checkbox } from '../../components/Checkbox/Checkbox';

const ENTRY_TYPES: AclEntryType[] = [
  'ADDRESS',
  'CIDR',
  'ACL_NAME',
  'KEY_NAME',
  'ANY',
  'NONE',
  'LOCALHOST',
  'LOCALNETS',
];

// Types whose value is implied, so the value input is hidden and stored as null.
const VALUE_IRRELEVANT: ReadonlySet<AclEntryType> = new Set([
  'ANY',
  'NONE',
  'LOCALHOST',
  'LOCALNETS',
]);

const TYPE_OPTIONS = ENTRY_TYPES.map((t) => ({ label: t, value: t }));

function makeEntryId(): string {
  return 'entry-' + Math.random().toString(16).slice(2, 10);
}

export function AclEditor() {
  const { configId = 'dns-lab', aclId = '' } = useParams();
  const navigate = useNavigate();
  const api = useApi();
  const { can } = useAuth();
  const canEdit = can('edit', configId);

  const [name, setName] = useState<string>('');
  const [entries, setEntries] = useState<AclEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadAcl = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const acl: Acl | null = await api.getAcl(configId, aclId);
      if (!acl) {
        setError('ACL not found');
        return;
      }
      setName(acl.name);
      setEntries([...acl.entries].sort((a, b) => a.order - b.order));
    } catch (err: any) {
      setError(err?.message || 'Failed to load ACL');
    } finally {
      setLoading(false);
    }
  }, [api, configId, aclId]);

  useEffect(() => {
    loadAcl();
  }, [loadAcl]);

  const updateEntry = useCallback((index: number, patch: Partial<AclEntry>) => {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }, []);

  const removeEntry = useCallback((index: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const addEntry = useCallback(() => {
    setEntries((prev) => [
      ...prev,
      { id: makeEntryId(), order: prev.length, type: 'ADDRESS', value: null, negated: false },
    ]);
  }, []);

  const handleTypeChange = useCallback(
    (index: number, type: AclEntryType) => {
      const value = VALUE_IRRELEVANT.has(type) ? null : undefined;
      setEntries((prev) =>
        prev.map((e, i) => (i === index ? { ...e, type, ...(value === null ? { value } : {}) } : e))
      );
    },
    []
  );

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setSaveError('Name is required');
      return;
    }

    const payload: AclEntry[] = entries.map((e, index) => ({
      id: e.id,
      order: index,
      type: e.type,
      value: VALUE_IRRELEVANT.has(e.type) ? null : (e.value ?? '').trim() || null,
      negated: e.negated,
    }));

    setSaving(true);
    setSaveError(null);
    try {
      await api.updateAcl(configId, aclId, { name: trimmedName, entries: payload });
      navigate(`/config/${configId}/acls`);
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save ACL');
      setSaving(false);
    }
  }, [api, configId, aclId, name, entries, navigate]);

  if (loading) {
    return (
      <div style={{ padding: '24px 32px' }}>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>Loading ACL…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '24px 32px' }}>
        <InlineAlert tone="error">{error}</InlineAlert>
      </div>
    );
  }

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
            ACL Editor
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: '13px',
              color: 'var(--color-text-secondary)',
            }}
          >
            Edit the ACL name and its ordered list of entries.
          </p>
        </div>
        <Button variant="secondary" onClick={() => navigate(`/config/${configId}/acls`)}>
          Back
        </Button>
      </div>

      {saveError && (
        <InlineAlert tone="error" style={{ marginBottom: '16px' }}>
          {saveError}
        </InlineAlert>
      )}

      <div className="field" style={{ marginBottom: '24px', maxWidth: '360px' }}>
        <label htmlFor="acl-editor-name">Name</label>
        <Input
          id="acl-editor-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canEdit}
        />
      </div>

      <div
        style={{
          border: '1px solid var(--color-divider)',
          background: 'var(--color-surface)',
          marginBottom: '16px',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '180px 1fr 90px 70px',
            gap: '8px',
            padding: '10px 16px',
            borderBottom: '1px solid var(--color-divider)',
            fontSize: '11px',
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
          }}
        >
          <span>Type</span>
          <span>Value</span>
          <span>Negated</span>
          <span />
        </div>

        {entries.length === 0 ? (
          <div
            style={{
              padding: '32px 24px',
              textAlign: 'center',
              color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
              fontSize: '13px',
            }}
          >
            No entries
          </div>
        ) : (
          entries.map((entry, index) => (
            <div
              key={entry.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '180px 1fr 90px 70px',
                gap: '8px',
                alignItems: 'center',
                padding: '8px 16px',
                borderBottom: '1px solid var(--color-divider)',
              }}
            >
              <Select
                aria-label={`Entry ${index + 1} type`}
                value={entry.type}
                onChange={(e) => handleTypeChange(index, e.target.value as AclEntryType)}
                options={TYPE_OPTIONS}
                disabled={!canEdit}
              />
              <Input
                aria-label={`Entry ${index + 1} value`}
                placeholder={VALUE_IRRELEVANT.has(entry.type) ? '—' : 'e.g. 10.0.0.0/8'}
                value={entry.value ?? ''}
                onChange={(e) => updateEntry(index, { value: e.target.value })}
                disabled={!canEdit || VALUE_IRRELEVANT.has(entry.type)}
                mono
              />
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <Checkbox
                  aria-label={`Entry ${index + 1} negated`}
                  checked={entry.negated}
                  onChange={(e) => updateEntry(index, { negated: e.target.checked })}
                  disabled={!canEdit}
                />
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => removeEntry(index)}
                disabled={!canEdit}
                aria-label={`Remove entry ${index + 1}`}
              >
                Remove
              </Button>
            </div>
          ))
        )}
      </div>

      {canEdit && (
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button variant="secondary" onClick={addEntry}>
            Add entry
          </Button>
          <Button variant="primary" onClick={handleSave} loading={saving}>
            Save
          </Button>
        </div>
      )}
    </div>
  );
}

export default AclEditor;
