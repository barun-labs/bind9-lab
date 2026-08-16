import { useState, useEffect, useCallback, useMemo, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { RpzAction, RpzPolicy, RpzRule, RpzTrigger, View } from '../../types/entities';
import { useApi } from '../../data/store';
import { useAuth } from '../../auth/AuthProvider';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { Select } from '../../components/Select/Select';
import { Modal } from '../../components/Modal/Modal';

const TRIGGER_OPTIONS: { label: string; value: RpzTrigger }[] = [
  { label: 'QNAME', value: 'QNAME' },
  { label: 'CLIENT_IP', value: 'CLIENT_IP' },
  { label: 'IP', value: 'IP' },
];

const ACTION_OPTIONS: { label: string; value: RpzAction }[] = [
  { label: 'NXDOMAIN', value: 'NXDOMAIN' },
  { label: 'NODATA', value: 'NODATA' },
  { label: 'PASSTHRU', value: 'PASSTHRU' },
  { label: 'DROP', value: 'DROP' },
  { label: 'TCP_ONLY', value: 'TCP_ONLY' },
  { label: 'CNAME', value: 'CNAME' },
];

// Client-side hint only, shown next to the value field — the server is the
// source of truth for whether a value is actually a valid domain / CIDR.
function valueHint(trigger: RpzTrigger): string {
  return trigger === 'QNAME' ? 'Domain name, e.g. malware.example.com' : 'IPv4 CIDR, e.g. 10.0.0.0/24';
}

export function RpzPolicyDetail() {
  const { configId = 'dns-lab', policyId = '' } = useParams();
  const navigate = useNavigate();
  const api = useApi();
  const { can } = useAuth();
  const canEdit = can('edit', configId);

  const [policy, setPolicy] = useState<RpzPolicy | null>(null);
  const [rules, setRules] = useState<RpzRule[]>([]);
  const [views, setViews] = useState<View[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [isRuleModalOpen, setIsRuleModalOpen] = useState<boolean>(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [trigger, setTrigger] = useState<RpzTrigger>('QNAME');
  const [value, setValue] = useState<string>('');
  const [action, setAction] = useState<RpzAction>('NXDOMAIN');
  const [cname, setCname] = useState<string>('');
  const [isSubmittingRule, setIsSubmittingRule] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [found, ruleList, viewList] = await Promise.all([
        api.getRpzPolicy(configId, policyId),
        api.listRpzRules(configId, policyId),
        api.listViews(configId),
      ]);
      if (!found) {
        setError('RPZ policy not found');
        return;
      }
      setPolicy(found);
      setRules(ruleList);
      setViews(viewList);
    } catch (err: any) {
      setError(err?.message || 'Failed to load RPZ policy');
    } finally {
      setLoading(false);
    }
  }, [api, configId, policyId]);

  useEffect(() => {
    load();
  }, [load]);

  const viewNameById = useMemo(() => new Map(views.map((v) => [v.id, v.name])), [views]);

  const handleOpenAddRule = () => {
    setEditingRuleId(null);
    setTrigger('QNAME');
    setValue('');
    setAction('NXDOMAIN');
    setCname('');
    setModalError(null);
    setIsRuleModalOpen(true);
  };

  const handleOpenEditRule = useCallback((rule: RpzRule) => {
    setEditingRuleId(rule.id);
    setTrigger(rule.trigger);
    setValue(rule.value);
    setAction(rule.action);
    setCname(rule.cname || '');
    setModalError(null);
    setIsRuleModalOpen(true);
  }, []);

  const handleCloseRuleModal = () => {
    setIsRuleModalOpen(false);
    setModalError(null);
  };

  const loadRules = useCallback(async () => {
    const ruleList = await api.listRpzRules(configId, policyId);
    setRules(ruleList);
  }, [api, configId, policyId]);

  const handleSubmitRule = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (isSubmittingRule) return;

    const trimmedValue = value.trim();
    if (!trimmedValue) return;

    setIsSubmittingRule(true);
    setModalError(null);

    try {
      const payload = {
        trigger,
        value: trimmedValue,
        action,
        cname: action === 'CNAME' ? cname.trim() || undefined : undefined,
      };
      if (editingRuleId) {
        await api.updateRpzRule(configId, editingRuleId, payload);
      } else {
        await api.createRpzRule(configId, policyId, payload);
      }
      setIsRuleModalOpen(false);
      await loadRules();
    } catch (err: any) {
      setModalError(err?.message || 'Failed to save rule');
    } finally {
      setIsSubmittingRule(false);
    }
  };

  const handleDeleteRule = useCallback(
    async (rule: RpzRule) => {
      if (!window.confirm(`Delete rule "${rule.value}"?`)) {
        return;
      }
      try {
        await api.deleteRpzRule(configId, rule.id);
        await loadRules();
      } catch (err: any) {
        setError(err?.message || 'Failed to delete rule');
      }
    },
    [api, configId, loadRules]
  );

  const columns: DataTableColumn<RpzRule>[] = useMemo(() => {
    const cols: DataTableColumn<RpzRule>[] = [
      { key: 'trigger', header: 'Trigger', render: (r) => r.trigger },
      {
        key: 'value',
        header: 'Value',
        render: (r) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{r.value}</span>,
      },
      { key: 'action', header: 'Action', render: (r) => r.action },
      {
        key: 'cname',
        header: 'CNAME target',
        render: (r) => (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{r.cname || '—'}</span>
        ),
      },
    ];

    if (canEdit) {
      cols.push({
        key: 'actions',
        header: '',
        width: '160px',
        align: 'right',
        render: (r) => (
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button variant="secondary" size="sm" onClick={() => handleOpenEditRule(r)} aria-label={`Edit rule ${r.value}`}>
              Edit
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => handleDeleteRule(r)}
              aria-label={`Delete rule ${r.value}`}
            >
              Delete
            </Button>
          </div>
        ),
      });
    }

    return cols;
  }, [canEdit, handleOpenEditRule, handleDeleteRule]);

  if (loading) {
    return (
      <div style={{ padding: '24px 32px' }}>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>Loading RPZ policy…</p>
      </div>
    );
  }

  if (error || !policy) {
    return (
      <div style={{ padding: '24px 32px' }}>
        <InlineAlert tone="error">{error || 'RPZ policy not found'}</InlineAlert>
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
            {policy.name}
          </h1>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)' }}>
            View: {viewNameById.get(policy.viewId) || policy.viewId}
            {policy.defaultPolicy ? ` · Default policy: ${policy.defaultPolicy}` : ''}
          </p>
        </div>
        <Button variant="secondary" onClick={() => navigate(`/config/${configId}/rpz`)}>
          Back
        </Button>
      </div>

      {canEdit && (
        <div style={{ marginBottom: '16px' }}>
          <Button variant="primary" onClick={handleOpenAddRule}>
            Add rule
          </Button>
        </div>
      )}

      <div
        style={{
          border: '1px solid var(--color-divider)',
          background: 'var(--color-surface)',
        }}
      >
        <DataTable columns={columns} rows={rules} emptyMessage="No rules" />
      </div>

      <Modal
        open={isRuleModalOpen}
        onClose={handleCloseRuleModal}
        title={editingRuleId ? 'Edit rule' : 'Add rule'}
        actions={
          <>
            <Button variant="secondary" onClick={handleCloseRuleModal}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => handleSubmitRule()}
              disabled={!value.trim() || isSubmittingRule}
              loading={isSubmittingRule}
            >
              {editingRuleId ? 'Save rule' : 'Create rule'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmitRule} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {modalError && <InlineAlert tone="error">{modalError}</InlineAlert>}
          <div className="field">
            <label htmlFor="rpz-rule-trigger">Trigger</label>
            <Select
              id="rpz-rule-trigger"
              value={trigger}
              onChange={(e) => setTrigger(e.target.value as RpzTrigger)}
              options={TRIGGER_OPTIONS}
            />
          </div>
          <div className="field">
            <label htmlFor="rpz-rule-value">Value</label>
            <Input
              id="rpz-rule-value"
              mono
              placeholder={valueHint(trigger)}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
              {valueHint(trigger)}
            </p>
          </div>
          <div className="field">
            <label htmlFor="rpz-rule-action">Action</label>
            <Select
              id="rpz-rule-action"
              value={action}
              onChange={(e) => setAction(e.target.value as RpzAction)}
              options={ACTION_OPTIONS}
            />
          </div>
          {action === 'CNAME' && (
            <div className="field">
              <label htmlFor="rpz-rule-cname">CNAME target</label>
              <Input
                id="rpz-rule-cname"
                mono
                placeholder="e.g. safe.example.com"
                value={cname}
                onChange={(e) => setCname(e.target.value)}
              />
            </div>
          )}
        </form>
      </Modal>
    </div>
  );
}

export default RpzPolicyDetail;
