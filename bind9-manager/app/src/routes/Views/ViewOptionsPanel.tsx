import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import type { DeploymentOptionRow } from '../../data/apiAdapter';
import { useApi } from '../../data/store';
import { useAuth } from '../../auth/AuthProvider';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { Button } from '../../components/Button/Button';
import { Select } from '../../components/Select/Select';
import { OptionValueEditor } from '../../components/OptionValueEditor/OptionValueEditor';
import { OPTION_ALLOWLIST, VIEW_SCOPE_KEYS, defaultValueForKind } from '../../lib/optionKinds';

// View scope has no inherit/override/disable — a key is simply set (a VIEW
// row with a value) or unset (no row). The three-state control lives on the
// zone panel, one level below.
export function ViewOptionsPanel() {
  const { configId = 'dns-lab', viewId = '' } = useParams();
  const api = useApi();
  const { can } = useAuth();
  const canEdit = can('edit', configId);

  const [rows, setRows] = useState<DeploymentOptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const list = await api.listDeploymentOptions(configId, 'VIEW', viewId);
    setRows(list);
    setLoading(false);
  }, [api, configId, viewId]);

  useEffect(() => {
    load();
  }, [load]);

  const availableKeys = useMemo(
    () => VIEW_SCOPE_KEYS.filter((key) => !rows.some((r) => r.key === key)),
    [rows]
  );

  useEffect(() => {
    if (newKey && !availableKeys.includes(newKey)) setNewKey('');
    if (!newKey && availableKeys.length > 0) setNewKey(availableKeys[0]);
  }, [availableKeys, newKey]);

  const handleAdd = async () => {
    if (!newKey) return;
    const kind = OPTION_ALLOWLIST[newKey].kind;
    await api.createDeploymentOption(configId, {
      scope: 'VIEW',
      scopeId: viewId,
      key: newKey,
      value: defaultValueForKind(kind),
    });
    await load();
  };

  const handleValueChange = async (row: DeploymentOptionRow, value: unknown) => {
    await api.updateDeploymentOption(configId, row.id, { value });
    await load();
  };

  const handleDelete = async (row: DeploymentOptionRow) => {
    await api.deleteDeploymentOption(configId, row.id);
    await load();
  };

  const columns: DataTableColumn<DeploymentOptionRow>[] = useMemo(() => {
    const cols: DataTableColumn<DeploymentOptionRow>[] = [
      {
        key: 'key',
        header: 'Key',
        render: (r) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{r.key}</span>,
      },
      {
        key: 'value',
        header: 'Value',
        render: (r) => (
          <OptionValueEditor
            kind={OPTION_ALLOWLIST[r.key].kind}
            value={r.value}
            onChange={(value) => handleValueChange(r, value)}
            disabled={!canEdit}
            aria-label={`${r.key} value`}
          />
        ),
      },
    ];
    if (canEdit) {
      cols.push({
        key: 'actions',
        header: '',
        align: 'right',
        render: (r) => (
          <Button variant="destructive" size="sm" onClick={() => handleDelete(r)} aria-label={`Delete ${r.key}`}>
            Delete
          </Button>
        ),
      });
    }
    return cols;
  }, [canEdit]);

  return (
    <div style={{ padding: '20px 32px', maxWidth: 'var(--chrome-max-content-w, 1040px)', width: '100%', boxSizing: 'border-box' }}>
      <p
        style={{
          margin: '0 0 14px',
          fontSize: '12px',
          color: 'color-mix(in srgb, var(--color-text) 60%, transparent)',
          maxWidth: '68ch',
        }}
      >
        View-scope options are simply set or unset. The inherit / override / disable control
        applies below this, on each zone.
      </p>

      {canEdit && availableKeys.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '14px' }}>
          <Select
            aria-label="Option key to add"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            options={availableKeys.map((k) => ({ label: k, value: k }))}
            style={{ width: '220px' }}
          />
          <Button variant="secondary" size="md" onClick={handleAdd}>
            Add option
          </Button>
        </div>
      )}

      <div style={{ border: '1px solid var(--color-divider)', background: 'var(--color-surface)' }}>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          emptyMessage="No view-scope options set"
        />
      </div>
    </div>
  );
}

export default ViewOptionsPanel;
