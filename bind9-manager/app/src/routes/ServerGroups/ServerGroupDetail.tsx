import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ServerGroup, Server } from '../../types/entities';
import { useApi } from '../../data/store';
import { useAuth } from '../../auth/AuthProvider';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';

const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

// ponytail: member assignment (add/remove a server from this group) happens
// on the server's own record, not here — this view is read-only for
// membership. Add an assign/unassign control when the Servers screen grows
// a "group" field to edit.
const memberColumns: DataTableColumn<Server>[] = [
  { key: 'hostname', header: 'Hostname', render: (s) => s.hostname },
  { key: 'mgmtAddress', header: 'Mgmt address', render: (s) => s.mgmtAddress || '—' },
  { key: 'syncState', header: 'Sync state', render: (s) => s.syncState },
];

export function ServerGroupDetail() {
  const { configId = 'dns-lab', groupId = '' } = useParams();
  const navigate = useNavigate();
  const api = useApi();
  const { can } = useAuth();
  const canEdit = can('edit', configId);

  const [group, setGroup] = useState<ServerGroup | null>(null);
  const [members, setMembers] = useState<Server[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [found, servers] = await Promise.all([
        api.getServerGroup(configId, groupId),
        api.listServers(configId),
      ]);
      if (!found) {
        setError('Server group not found');
        return;
      }
      setGroup(found);
      setName(found.name);
      setDescription(found.description || '');
      setMembers(servers.filter((s: any) => s.serverGroupId === groupId));
    } catch (err: any) {
      setError(err?.message || 'Failed to load server group');
    } finally {
      setLoading(false);
    }
  }, [api, configId, groupId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setSaveError('Name is required');
      return;
    }
    if (!NAME_PATTERN.test(trimmedName)) {
      setSaveError('Name may only contain letters, digits, dots, underscores, and hyphens.');
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const updated = await api.updateServerGroup(configId, groupId, {
        name: trimmedName,
        description: description.trim() || undefined,
      });
      setGroup(updated);
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save server group');
    } finally {
      setSaving(false);
    }
  }, [api, configId, groupId, name, description]);

  if (loading) {
    return (
      <div style={{ padding: '24px 32px' }}>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>Loading server group…</p>
      </div>
    );
  }

  if (error || !group) {
    return (
      <div style={{ padding: '24px 32px' }}>
        <InlineAlert tone="error">{error || 'Server group not found'}</InlineAlert>
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
            {group.name}
          </h1>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)' }}>
            Server group members and group-wide options.
          </p>
        </div>
        <Button variant="secondary" onClick={() => navigate(`/config/${configId}/groups`)}>
          Back
        </Button>
      </div>

      {saveError && (
        <InlineAlert tone="error" style={{ marginBottom: '16px' }}>
          {saveError}
        </InlineAlert>
      )}

      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', maxWidth: '480px', flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: 1, minWidth: '200px' }}>
          <label htmlFor="server-group-detail-name">Name</label>
          <Input
            id="server-group-detail-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canEdit}
          />
        </div>
        <div className="field" style={{ flex: 1, minWidth: '200px' }}>
          <label htmlFor="server-group-detail-description">Description</label>
          <Input
            id="server-group-detail-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!canEdit}
          />
        </div>
      </div>

      {canEdit && (
        <div style={{ marginBottom: '32px' }}>
          <Button variant="primary" onClick={handleSave} loading={saving}>
            Save
          </Button>
        </div>
      )}

      <h2 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 12px 0', fontFamily: 'var(--font-heading)' }}>
        Members
      </h2>
      <div
        style={{
          border: '1px solid var(--color-divider)',
          background: 'var(--color-surface)',
        }}
      >
        <DataTable columns={memberColumns} rows={members} emptyMessage="No servers in this group" />
      </div>
    </div>
  );
}

export default ServerGroupDetail;
