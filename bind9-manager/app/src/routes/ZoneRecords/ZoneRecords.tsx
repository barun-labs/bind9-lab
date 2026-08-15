import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type {
  RecordType,
  ResourceRecord,
  SyncState,
  ExternalHost,
  ListEnvelope,
} from '../../types/entities';
import { useStore, useApi } from '../../data/store';
import { parseQuery, toSearch, type TableState } from '../../lib/query';
import { zoneFileLine, rdataDisplay } from '../../lib/zonefile';
import { validateRecord, type ValidationResult } from '../../lib/validate';

import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { SidePanel } from '../../components/SidePanel/SidePanel';
import { Combobox, type ComboboxOption } from '../../components/Combobox/Combobox';
import { ToastProvider, useToast } from '../../components/Toast/ToastProvider';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { Textarea } from '../../components/Textarea/Textarea';
import { Select } from '../../components/Select/Select';
import { StatusPill } from '../../components/StatusPill/StatusPill';
import { RecordTypeChip } from '../../components/RecordTypeChip/RecordTypeChip';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';

const RECORD_TYPES: RecordType[] = [
  'A',
  'AAAA',
  'CNAME',
  'MX',
  'TXT',
  'SRV',
  'NS',
  'PTR',
  'CAA',
  'ALIAS',
];

interface RecordFormState {
  type: RecordType;
  name: string;
  ttl: string;
  address: string;
  target: string;
  priority: string;
  weight: string;
  port: string;
  text: string;
  flags: string;
  tag: string;
  caaValue: string;
}

const DEFAULT_FORM: RecordFormState = {
  type: 'A',
  name: '',
  ttl: '3600',
  address: '',
  target: '',
  priority: '10',
  weight: '10',
  port: '',
  text: '',
  flags: '0',
  tag: 'issue',
  caaValue: '',
};

function parseRdataToForm(type: RecordType, rdata: any): Partial<RecordFormState> {
  if (!rdata) return {};
  switch (type) {
    case 'A':
    case 'AAAA':
      return { address: String(rdata.address ?? '') };
    case 'CNAME':
    case 'NS':
    case 'PTR':
    case 'ALIAS':
      return { target: String(rdata.target ?? '').replace(/\.$/, '') };
    case 'MX':
      return {
        priority: String(rdata.priority ?? '10'),
        target: String(rdata.target ?? '').replace(/\.$/, ''),
      };
    case 'SRV':
      return {
        priority: String(rdata.priority ?? '10'),
        weight: String(rdata.weight ?? '10'),
        port: String(rdata.port ?? ''),
        target: String(rdata.target ?? '').replace(/\.$/, ''),
      };
    case 'TXT':
      return { text: String(rdata.text ?? '').replace(/^"|"$/g, '') };
    case 'CAA':
      return {
        flags: String(rdata.flags ?? '0'),
        tag: String(rdata.tag ?? 'issue'),
        caaValue: String(rdata.value ?? ''),
      };
    default:
      return {};
  }
}

function buildFormRdata(form: RecordFormState): Record<string, unknown> {
  switch (form.type) {
    case 'A':
    case 'AAAA':
      return { address: form.address };
    case 'CNAME':
    case 'NS':
    case 'ALIAS':
    case 'PTR': {
      const t = form.target.trim();
      const withDot = t && !t.endsWith('.') ? `${t}.` : t;
      return { target: withDot };
    }
    case 'MX': {
      const t = form.target.trim();
      const withDot = t && !t.endsWith('.') ? `${t}.` : t;
      return {
        priority: parseInt(form.priority, 10) || 0,
        target: withDot,
      };
    }
    case 'SRV': {
      const t = form.target.trim();
      const withDot = t && !t.endsWith('.') ? `${t}.` : t;
      return {
        priority: parseInt(form.priority, 10) || 0,
        weight: parseInt(form.weight, 10) || 0,
        port: parseInt(form.port, 10) || 0,
        target: withDot,
      };
    }
    case 'TXT':
      return { text: form.text };
    case 'CAA':
      return {
        flags: parseInt(form.flags, 10) || 0,
        tag: form.tag,
        value: form.caaValue,
      };
    default:
      return {};
  }
}

export function ZoneRecordsInner() {
  const { configId = 'dns-lab', zoneId = 'zone-lab' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const store = useStore();
  const api = useApi();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<'records' | 'roles' | 'options' | 'settings' | 'history'>('records');

  // URL Query / Table State
  const tableState: TableState = useMemo(() => {
    return parseQuery(searchParams.toString());
  }, [searchParams]);

  const updateTableState = useCallback(
    (updater: (prev: TableState) => TableState) => {
      const next = updater(tableState);
      const searchStr = toSearch(next);
      setSearchParams(searchStr ? `?${searchStr}` : '', { replace: true });
    },
    [tableState, setSearchParams]
  );

  // Data states
  const [recordsEnvelope, setRecordsEnvelope] = useState<ListEnvelope<ResourceRecord>>({
    data: [],
    page: 1,
    size: 50,
    total: 0,
  });
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [externalHosts, setExternalHosts] = useState<ExternalHost[]>([]);

  // Load external hosts
  useEffect(() => {
    let active = true;
    api.listExternalHosts(configId, { size: 1000 }).then((res) => {
      if (active) {
        setExternalHosts(res.data);
      }
    });
    return () => {
      active = false;
    };
  }, [api, configId]);

  // Load records
  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listRecords(zoneId, {
        type: tableState.type,
        status: tableState.status,
        q: tableState.q,
        page: tableState.page,
        size: tableState.size,
        sort: tableState.sort,
      });
      setRecordsEnvelope(res);
    } finally {
      setLoading(false);
    }
  }, [api, zoneId, tableState]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords, store.records]);

  // Zone info
  const zone = store.zones.find((z) => z.id === zoneId) || {
    id: zoneId,
    configurationId: configId,
    viewId: 'view-internal',
    name: 'lab.lun.net',
    type: 'PRIMARY' as const,
    soa: {
      primaryNs: 'ns1.lab.lun.net.',
      adminEmail: 'hostmaster.lab.lun.net.',
      serial: 2026081401,
      refresh: 3600,
      retry: 900,
      expire: 604800,
      minimum: 300,
    },
    allowTransfer: ['10.20.30.11'],
    allowUpdate: [],
    recordCount: 40,
    syncState: 'SYNCED' as const,
  };

  const view = store.views.find((v) => v.id === zone.viewId);
  const zonePendingCount = store.records.filter(
    (r) => r.zoneId === zoneId && (r.syncState === 'PENDING' || r.disabled)
  ).length;

  // Quick-Add state
  const [quickName, setQuickName] = useState('');
  const [quickType, setQuickType] = useState<RecordType>('A');
  const [quickTtl, setQuickTtl] = useState('3600');
  const [quickValue, setQuickValue] = useState('');

  // SidePanel state
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<'add' | 'edit'>('add');
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [form, setForm] = useState<RecordFormState>(DEFAULT_FORM);

  const openAddPanel = useCallback((prefill?: Partial<RecordFormState>) => {
    setPanelMode('add');
    setEditingRecordId(null);
    setForm({
      ...DEFAULT_FORM,
      ...prefill,
    });
    setPanelOpen(true);
  }, []);

  const openEditPanel = useCallback((record: ResourceRecord) => {
    setPanelMode('edit');
    setEditingRecordId(record.id);
    setForm({
      ...DEFAULT_FORM,
      type: record.type,
      name: record.name,
      ttl: String(record.ttl),
      ...parseRdataToForm(record.type, record.rdata),
    });
    setPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
  }, []);

  // Quick Type change
  const handleQuickTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextType = e.target.value as RecordType;
    if (['MX', 'SRV', 'CAA'].includes(nextType)) {
      const prefill = {
        type: nextType,
        name: quickName,
        ttl: quickTtl,
      };
      setQuickName('');
      setQuickValue('');
      setQuickType('A');
      openAddPanel(prefill);
    } else {
      setQuickType(nextType);
    }
  };

  const handleQuickAdd = async () => {
    if (!quickName.trim() || !quickValue.trim()) return;

    let rdata: Record<string, unknown> = {};
    if (quickType === 'A' || quickType === 'AAAA') {
      rdata = { address: quickValue.trim() };
    } else if (['CNAME', 'NS', 'ALIAS', 'PTR'].includes(quickType)) {
      const t = quickValue.trim();
      rdata = { target: t.endsWith('.') ? t : `${t}.` };
    } else if (quickType === 'TXT') {
      rdata = { text: quickValue.trim() };
    }

    await api.createRecord(zoneId, {
      name: quickName.trim(),
      type: quickType,
      ttl: parseInt(quickTtl, 10) || 3600,
      rdata,
      disabled: false,
      syncState: 'PENDING',
    });

    setQuickName('');
    setQuickValue('');
    setQuickTtl('3600');
    setQuickType('A');
    await loadRecords();
  };

  // Form field changes
  const updateFormField = <K extends keyof RecordFormState>(key: K, value: RecordFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  // Form validation
  const validation: ValidationResult = useMemo(() => {
    const input = {
      name: form.name.trim() || '@',
      type: form.type,
      ttl: parseInt(form.ttl, 10) || 0,
    };

    const targetForValidation =
      ['CNAME', 'NS', 'ALIAS', 'PTR', 'MX', 'SRV'].includes(form.type)
        ? form.target.trim()
        : undefined;

    return validateRecord(input, {
      zoneName: zone.name,
      existing: store.records.filter((r) => r.zoneId === zoneId),
      externalHostFqdns: externalHosts.map((h) => h.fqdn),
      editingId: editingRecordId ?? undefined,
      target: targetForValidation,
    });
  }, [form, zone.name, store.records, zoneId, externalHosts, editingRecordId]);

  // Live preview
  const previewLine = useMemo(() => {
    const name = form.name.trim() || '@';
    const ttl = parseInt(form.ttl, 10) || 3600;
    const rdataObj = buildFormRdata(form);
    return zoneFileLine(name, ttl, form.type, rdataObj);
  }, [form]);

  // Target suggestions for Combobox
  const searchTargetSuggestions = useCallback(
    async (q: string): Promise<ComboboxOption[]> => {
      const qLower = q.trim().toLowerCase();
      const results: ComboboxOption[] = [];

      // In-zone records
      const inZone = store.records.filter((r) => r.zoneId === zoneId);
      for (const rec of inZone) {
        const fullFqdn = rec.name === '@' ? zone.name : `${rec.name}.${zone.name}`;
        if (!qLower || fullFqdn.toLowerCase().includes(qLower) || rec.name.toLowerCase().includes(qLower)) {
          results.push({
            label: fullFqdn,
            value: fullFqdn,
            meta: `Zone (${rec.type})`,
          });
        }
      }

      // External hosts
      for (const host of externalHosts) {
        if (!qLower || host.fqdn.toLowerCase().includes(qLower)) {
          results.push({
            label: host.fqdn,
            value: host.fqdn,
            meta: 'External Host',
          });
        }
      }

      // De-duplicate
      const seen = new Set<string>();
      return results.filter((item) => {
        if (seen.has(item.value)) return false;
        seen.add(item.value);
        return true;
      });
    },
    [store.records, zoneId, zone.name, externalHosts]
  );

  // Panel Save
  const handleSave = async () => {
    if (Object.keys(validation.errors).length > 0) {
      return;
    }

    const rdata = buildFormRdata(form);
    const name = form.name.trim() || '@';
    const ttl = parseInt(form.ttl, 10) || 3600;

    if (panelMode === 'add') {
      await api.createRecord(zoneId, {
        name,
        type: form.type,
        ttl,
        rdata,
        disabled: false,
        syncState: 'PENDING',
        issue: validation.warnings.target
          ? 'Target not declared in this zone or in External Hosts — will create a dangling reference.'
          : null,
      });
    } else if (editingRecordId) {
      await api.updateRecord(editingRecordId, {
        name,
        type: form.type,
        ttl,
        rdata,
        syncState: 'PENDING',
        issue: validation.warnings.target
          ? 'Target not declared in this zone or in External Hosts — will create a dangling reference.'
          : null,
      });
    }

    setPanelOpen(false);
    await loadRecords();
  };

  // Row actions
  const handleToggleDisable = async (record: ResourceRecord) => {
    await api.setRecordDisabled(record.id, !record.disabled);
    await loadRecords();
  };

  const handleDeleteRecord = async (record: ResourceRecord) => {
    const deleted = await api.deleteRecord(record.id);
    await loadRecords();

    if (deleted) {
      toast.push({
        message: `Deleted ${record.type} record '${record.name}'`,
        tone: 'info',
        action: {
          label: 'Undo',
          onClick: async () => {
            await api.createRecord(zoneId, {
              name: deleted.name,
              type: deleted.type,
              ttl: deleted.ttl,
              rdata: deleted.rdata,
              disabled: deleted.disabled,
              syncState: deleted.syncState,
              issue: deleted.issue,
            });
            await loadRecords();
          },
        },
      });
    }
  };

  // Bulk actions
  const handleBulkDisable = async () => {
    for (const id of selectedIds) {
      await api.setRecordDisabled(id, true);
    }
    setSelectedIds([]);
    await loadRecords();
  };

  const handleBulkDelete = async () => {
    const toDelete = store.records.filter((r) => selectedIds.includes(r.id));
    for (const id of selectedIds) {
      await api.deleteRecord(id);
    }
    setSelectedIds([]);
    await loadRecords();

    toast.push({
      message: `Deleted ${toDelete.length} records`,
      tone: 'info',
      action: {
        label: 'Undo',
        onClick: async () => {
          for (const item of toDelete) {
            await api.createRecord(zoneId, {
              name: item.name,
              type: item.type,
              ttl: item.ttl,
              rdata: item.rdata,
              disabled: item.disabled,
              syncState: item.syncState,
              issue: item.issue,
            });
          }
          await loadRecords();
        },
      },
    });
  };

  // Click to copy rdata
  const handleCopyRdata = (text: string) => {
    try {
      navigator.clipboard.writeText(text);
      toast.push({ message: `Copied to clipboard: ${text}`, tone: 'success', duration: 2000 });
    } catch {
      // ignore
    }
  };

  // Table Columns
  const columns: DataTableColumn<ResourceRecord>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        render: (r) => (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
            {r.name || '@'}
          </span>
        ),
      },
      {
        key: 'type',
        header: 'Type',
        width: '80px',
        render: (r) => <RecordTypeChip type={r.type} />,
      },
      {
        key: 'ttl',
        header: 'TTL',
        width: '70px',
        align: 'right',
        render: (r) => (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', textAlign: 'right' }}>
            {r.ttl}
          </span>
        ),
      },
      {
        key: 'rdata',
        header: 'RDATA',
        render: (r) => {
          const formatted = rdataDisplay(r.type, r.rdata);
          return (
            <span
              onClick={() => handleCopyRdata(formatted)}
              title="Click to copy"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
                cursor: 'pointer',
                maxWidth: '360px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                display: 'inline-block',
              }}
            >
              {formatted}
            </span>
          );
        },
      },
      {
        key: 'status',
        header: 'Status',
        width: '160px',
        render: (r) => {
          const pillState = r.disabled ? 'disabled' : r.syncState;
          const statusLabel = r.disabled
            ? 'Disabled · pending'
            : r.syncState === 'PENDING'
            ? 'Pending'
            : r.syncState === 'SYNCED'
            ? 'Synced'
            : r.syncState;

          return (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <StatusPill state={pillState} label={statusLabel} />
              {r.issue && (
                <span
                  title={r.issue}
                  style={{
                    display: 'inline-flex',
                    color: 'var(--state-drift)',
                  }}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 3l9.5 17H2.5L12 3z" />
                    <path d="M12 10v4" />
                    <circle cx="12" cy="17" r=".6" fill="currentColor" stroke="none" />
                  </svg>
                </span>
              )}
            </div>
          );
        },
      },
      {
        key: 'actions',
        header: '',
        width: '120px',
        align: 'right',
        render: (r) => (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
            <button
              type="button"
              onClick={() => openEditPanel(r)}
              aria-label={`Edit ${r.name}`}
              title="Edit"
              className="btn btn-ghost btn-icon"
              style={{ width: '28px', height: '28px' }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleToggleDisable(r)}
              aria-label={r.disabled ? `Enable ${r.name}` : `Disable ${r.name}`}
              title={r.disabled ? 'Enable' : 'Disable'}
              className="btn btn-ghost"
              style={{ height: '28px', padding: '0 6px', fontSize: '11px' }}
            >
              {r.disabled ? 'Enable' : 'Disable'}
            </button>
            <button
              type="button"
              onClick={() => handleDeleteRecord(r)}
              aria-label={`Delete ${r.name}`}
              title="Delete"
              className="btn btn-ghost"
              style={{
                height: '28px',
                padding: '0 6px',
                fontSize: '11px',
                color: 'var(--state-error)',
              }}
            >
              Delete
            </button>
          </div>
        ),
      },
    ],
    [openEditPanel]
  );

  // Quick placeholders
  const quickPlaceholders: Record<string, string> = {
    A: '10.20.30.x',
    AAAA: '2001:db8::x',
    CNAME: 'target.fqdn.',
    NS: 'ns.fqdn.',
    ALIAS: 'target.fqdn.',
    TXT: 'text value',
    PTR: 'target.fqdn.',
  };
  const quickPlaceholder = quickPlaceholders[quickType] || 'value';

  // Quick-Add row
  const quickAddRow = (
    <tr style={{ background: 'color-mix(in srgb, var(--color-accent) 5%, transparent)' }}>
      <td style={{ padding: '6px 8px 6px 24px', borderBottom: '1px solid var(--color-divider)' }} />
      <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--color-divider)' }}>
        <input
          className="input"
          value={quickName}
          onChange={(e) => setQuickName(e.target.value)}
          placeholder="name"
          style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', height: '30px' }}
          aria-label="Quick add record name"
        />
      </td>
      <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--color-divider)' }}>
        <select
          className="input"
          value={quickType}
          onChange={handleQuickTypeChange}
          style={{ fontSize: '12px', height: '30px', fontFamily: 'var(--font-mono)' }}
          aria-label="Quick add record type"
        >
          {RECORD_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </td>
      <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--color-divider)' }}>
        <input
          className="input"
          value={quickTtl}
          onChange={(e) => setQuickTtl(e.target.value)}
          style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', height: '30px', textAlign: 'right' }}
          aria-label="Quick add record TTL"
        />
      </td>
      <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--color-divider)' }}>
        <input
          className="input"
          value={quickValue}
          onChange={(e) => setQuickValue(e.target.value)}
          placeholder={quickPlaceholder}
          style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', height: '30px' }}
          aria-label="Quick add record value"
        />
      </td>
      <td
        colSpan={2}
        style={{
          padding: '6px 24px 6px 8px',
          borderBottom: '1px solid var(--color-divider)',
          textAlign: 'right',
        }}
      >
        <button
          type="button"
          onClick={handleQuickAdd}
          aria-label="Quick add submit"
          className="btn btn-primary btn-icon blueprint"
          style={{ width: '30px', height: '30px' }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </td>
    </tr>
  );

  const isAddr = form.type === 'A' || form.type === 'AAAA';
  const isSimpleTarget = ['CNAME', 'NS', 'ALIAS', 'PTR'].includes(form.type);
  const isMX = form.type === 'MX';
  const isSRV = form.type === 'SRV';
  const isTXT = form.type === 'TXT';
  const isCAA = form.type === 'CAA';

  const soa = zone.soa;
  const allowTransferStr =
    zone.allowTransfer && zone.allowTransfer.length > 0
      ? zone.allowTransfer.join(', ')
      : 'none';

  return (
    <div style={{ flex: 1, overflow: 'auto', position: 'relative', width: '100%' }}>
      {/* Zone Sticky Header */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 5,
          background: 'var(--color-bg)',
          borderBottom: '1px solid var(--color-divider)',
          padding: '16px 24px 12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <h1
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 500,
              fontSize: '22px',
              letterSpacing: 0,
              margin: 0,
            }}
          >
            {zone.name}
          </h1>
          <span className="tag tag-outline">{zone.type || 'Primary'}</span>
          <span className="tag tag-accent" style={{ textTransform: 'uppercase' }}>
            {view?.name || 'internal'}
          </span>
          {zonePendingCount > 0 && (
            <span
              className="tag"
              style={{ background: 'var(--state-pending-bg)', color: 'var(--state-pending)' }}
            >
              {zonePendingCount} pending
            </span>
          )}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: '12px', color: 'color-mix(in srgb, var(--color-text) 55%, transparent)' }}>
            {recordsEnvelope.total} records · 2 of 3 servers synced
          </span>
          <Button variant="secondary" size="md">
            Edit SOA
          </Button>
        </div>

        {/* SOA Summary Box */}
        <div
          style={{
            display: 'flex',
            gap: '1px',
            marginTop: '12px',
            background: 'var(--color-divider)',
            border: '1px solid var(--color-divider)',
            width: 'fit-content',
          }}
        >
          <div style={{ background: 'var(--color-bg)', padding: '6px 14px' }}>
            <div
              style={{
                fontSize: '9px',
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
              }}
            >
              Serial
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{soa.serial}</div>
          </div>
          <div style={{ background: 'var(--color-bg)', padding: '6px 14px' }}>
            <div
              style={{
                fontSize: '9px',
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
              }}
            >
              Refresh
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{soa.refresh}</div>
          </div>
          <div style={{ background: 'var(--color-bg)', padding: '6px 14px' }}>
            <div
              style={{
                fontSize: '9px',
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
              }}
            >
              Retry
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{soa.retry}</div>
          </div>
          <div style={{ background: 'var(--color-bg)', padding: '6px 14px' }}>
            <div
              style={{
                fontSize: '9px',
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
              }}
            >
              Expire
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{soa.expire}</div>
          </div>
          <div style={{ background: 'var(--color-bg)', padding: '6px 14px' }}>
            <div
              style={{
                fontSize: '9px',
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
              }}
            >
              Min TTL
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{soa.minimum}</div>
          </div>
          <div style={{ background: 'var(--color-bg)', padding: '6px 14px', whiteSpace: 'nowrap' }}>
            <div
              style={{
                fontSize: '9px',
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
              }}
            >
              Allow-transfer
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{allowTransferStr}</div>
          </div>
        </div>

        {/* Tab Switcher */}
        <div style={{ display: 'flex', gap: '2px', marginTop: '12px' }}>
          {[
            { id: 'records', label: 'Records' },
            { id: 'roles', label: 'Deployment Roles' },
            { id: 'options', label: 'Deployment Options' },
            { id: 'settings', label: 'Settings' },
            { id: 'history', label: 'History' },
          ].map((tb) => {
            const isTabActive = activeTab === tb.id;
            return (
              <button
                key={tb.id}
                type="button"
                onClick={() => setActiveTab(tb.id as any)}
                style={{
                  padding: '7px 14px',
                  border: 0,
                  borderBottom: isTabActive ? '2px solid var(--color-accent)' : '2px solid transparent',
                  background: 'transparent',
                  fontFamily: 'var(--font-heading)',
                  fontWeight: 600,
                  fontSize: '13px',
                  color: isTabActive
                    ? 'var(--color-text)'
                    : 'color-mix(in srgb, var(--color-text) 55%, transparent)',
                  cursor: 'pointer',
                }}
              >
                {tb.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === 'records' && (
        <>
          {/* Filter & Action Controls */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px 24px',
              borderBottom: '1px solid var(--color-divider)',
              flexWrap: 'wrap',
            }}
          >
            <select
              className="input"
              value={tableState.type || ''}
              onChange={(e) => {
                const val = e.target.value as RecordType;
                updateTableState((prev) => ({
                  ...prev,
                  type: val ? val : undefined,
                  page: 1,
                }));
              }}
              style={{ width: '150px', height: '32px', fontSize: '12px' }}
              aria-label="Filter by record type"
            >
              <option value="">All types</option>
              {RECORD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            <select
              className="input"
              value={tableState.status || ''}
              onChange={(e) => {
                const val = e.target.value as SyncState;
                updateTableState((prev) => ({
                  ...prev,
                  status: val ? val : undefined,
                  page: 1,
                }));
              }}
              style={{ width: '150px', height: '32px', fontSize: '12px' }}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              <option value="PENDING">Pending only</option>
              <option value="SYNCED">Synced</option>
              <option value="DRIFT">Drift</option>
              <option value="ERROR">Error</option>
            </select>

            <div style={{ flex: 1 }} />

            {selectedIds.length > 0 && (
              <>
                <span
                  style={{
                    fontSize: '12px',
                    color: 'color-mix(in srgb, var(--color-text) 60%, transparent)',
                  }}
                >
                  {selectedIds.length} selected
                </span>
                <Button
                  variant="secondary"
                  size="md"
                  onClick={handleBulkDisable}
                >
                  Disable
                </Button>
                <Button
                  variant="destructive"
                  size="md"
                  onClick={handleBulkDelete}
                >
                  Delete
                </Button>
              </>
            )}

            <Button variant="ghost" size="md">
              Import
            </Button>
            <Button variant="ghost" size="md">
              Export
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => openAddPanel()}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add record
            </Button>
          </div>

          {/* Records DataTable */}
          <DataTable<ResourceRecord>
            columns={columns}
            rows={recordsEnvelope.data}
            loading={loading}
            selectable
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            topRow={quickAddRow}
            pagination={{
              page: recordsEnvelope.page,
              size: recordsEnvelope.size,
              total: recordsEnvelope.total,
              onPageChange: (newPage) => {
                updateTableState((prev) => ({ ...prev, page: newPage }));
              },
            }}
            getRowProps={(r) => ({
              style: {
                opacity: r.disabled ? 0.55 : 1,
              },
              'data-disabled': r.disabled ? 'true' : undefined,
            })}
          />
        </>
      )}

      {activeTab === 'roles' && (
        <div style={{ padding: '20px 24px', maxWidth: '820px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '15px' }}>Servers serving this zone</h3>
          <div style={{ border: '1px solid var(--color-divider)' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '170px 130px 1fr 150px',
                padding: '8px 16px',
                borderBottom: '1px solid var(--color-divider)',
                fontSize: '11px',
                letterSpacing: '.06em',
                textTransform: 'uppercase',
                color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
              }}
            >
              <div>Server</div>
              <div>Role</div>
              <div>Lab · mgmt</div>
              <div>Sync (this zone)</div>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '170px 130px 1fr 150px',
                padding: '10px 16px',
                alignItems: 'center',
              }}
            >
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>bind-pri-01</div>
              <div>
                <span className="tag tag-neutral">Primary</span>
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11.5px',
                  color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
                }}
              >
                lab dns-lab · mgmt 172.20.20.11
              </div>
              <div style={{ fontSize: '12px', color: 'var(--color-neutral-600)' }}>Synced</div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'options' && (
        <div style={{ padding: '20px 24px', maxWidth: '820px' }}>
          <p
            style={{
              margin: '0 0 14px',
              fontSize: '12px',
              color: 'color-mix(in srgb, var(--color-text) 60%, transparent)',
              maxWidth: '68ch',
            }}
          >
            Effective value, then where it came from. The scope chip is the management scope that set
            it; the small tag beside it is where it lands in BIND syntax — they can differ.
          </p>
        </div>
      )}

      {activeTab === 'settings' && (
        <div
          style={{
            padding: '20px 24px',
            fontSize: '13px',
            color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
          }}
        >
          Zone settings (transfer/update ACLs, DNSSEC status placeholder) — queued for a follow-up pass.
        </div>
      )}

      {activeTab === 'history' && (
        <div
          style={{
            padding: '20px 24px',
            fontSize: '13px',
            color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
          }}
        >
          Per-zone change history — queued for a follow-up pass.
        </div>
      )}

      {/* Add / Edit SidePanel */}
      <SidePanel
        open={panelOpen}
        onClose={closePanel}
        title={panelMode === 'add' ? 'Add record' : 'Edit record'}
        width="440px"
        actions={
          <>
            <Button variant="secondary" onClick={closePanel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={Object.keys(validation.errors).length > 0}
            >
              Save (stages change)
            </Button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="record-name-input">Name</label>
          <Input
            id="record-name-input"
            value={form.name}
            onChange={(e) => updateFormField('name', e.target.value)}
            placeholder="@ for zone apex"
            mono
            error={validation.errors.name}
          />
          {validation.errors.name && (
            <span style={{ color: 'var(--state-error)', fontSize: '11px', marginTop: '2px', display: 'block' }}>
              {validation.errors.name}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="record-type-select">Type</label>
            <Select
              id="record-type-select"
              value={form.type}
              onChange={(e) => updateFormField('type', e.target.value as RecordType)}
              options={RECORD_TYPES.map((t) => ({ label: t, value: t }))}
              mono
              error={validation.errors.type}
            />
            {validation.errors.type && (
              <span style={{ color: 'var(--state-error)', fontSize: '11px', marginTop: '2px', display: 'block' }}>
                {validation.errors.type}
              </span>
            )}
          </div>
          <div className="field" style={{ width: '110px' }}>
            <label htmlFor="record-ttl-input">TTL</label>
            <Input
              id="record-ttl-input"
              value={form.ttl}
              onChange={(e) => updateFormField('ttl', e.target.value)}
              mono
              error={validation.errors.ttl}
            />
            {validation.errors.ttl && (
              <span style={{ color: 'var(--state-error)', fontSize: '11px', marginTop: '2px', display: 'block' }}>
                {validation.errors.ttl}
              </span>
            )}
          </div>
        </div>

        {/* Type-Specific Fields */}
        {isAddr && (
          <div className="field">
            <label htmlFor="record-address-input">Address</label>
            <Input
              id="record-address-input"
              value={form.address}
              onChange={(e) => updateFormField('address', e.target.value)}
              placeholder={form.type === 'A' ? '10.20.30.x' : '2001:db8::x'}
              mono
            />
          </div>
        )}

        {isSimpleTarget && (
          <div className="field">
            <label htmlFor="record-target-combobox">Target</label>
            <Combobox
              id="record-target-combobox"
              value={form.target}
              onChange={(val) => updateFormField('target', val)}
              onSearch={searchTargetSuggestions}
              placeholder="target.lab.lun.net"
              mono
            />
          </div>
        )}

        {isMX && (
          <div style={{ display: 'flex', gap: '12px' }}>
            <div className="field" style={{ width: '90px' }}>
              <label htmlFor="record-priority-input">Priority</label>
              <Input
                id="record-priority-input"
                value={form.priority}
                onChange={(e) => updateFormField('priority', e.target.value)}
                mono
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="record-mx-target-combobox">Mail server</label>
              <Combobox
                id="record-mx-target-combobox"
                value={form.target}
                onChange={(val) => updateFormField('target', val)}
                onSearch={searchTargetSuggestions}
                placeholder="mx1.lab.lun.net"
                mono
              />
            </div>
          </div>
        )}

        {isSRV && (
          <>
            <div style={{ display: 'flex', gap: '12px' }}>
              <div className="field" style={{ width: '80px' }}>
                <label htmlFor="record-srv-pri">Priority</label>
                <Input
                  id="record-srv-pri"
                  value={form.priority}
                  onChange={(e) => updateFormField('priority', e.target.value)}
                  mono
                />
              </div>
              <div className="field" style={{ width: '80px' }}>
                <label htmlFor="record-srv-weight">Weight</label>
                <Input
                  id="record-srv-weight"
                  value={form.weight}
                  onChange={(e) => updateFormField('weight', e.target.value)}
                  mono
                />
              </div>
              <div className="field" style={{ width: '80px' }}>
                <label htmlFor="record-srv-port">Port</label>
                <Input
                  id="record-srv-port"
                  value={form.port}
                  onChange={(e) => updateFormField('port', e.target.value)}
                  mono
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="record-srv-target">Target</label>
              <Combobox
                id="record-srv-target"
                value={form.target}
                onChange={(val) => updateFormField('target', val)}
                onSearch={searchTargetSuggestions}
                placeholder="sip1.lab.lun.net"
                mono
              />
            </div>
          </>
        )}

        {isTXT && (
          <div className="field">
            <label htmlFor="record-text-area">Text value</label>
            <Textarea
              id="record-text-area"
              value={form.text}
              onChange={(e) => updateFormField('text', e.target.value)}
              rows={3}
              mono
            />
          </div>
        )}

        {isCAA && (
          <div style={{ display: 'flex', gap: '12px' }}>
            <div className="field" style={{ width: '70px' }}>
              <label htmlFor="record-caa-flags">Flags</label>
              <Input
                id="record-caa-flags"
                value={form.flags}
                onChange={(e) => updateFormField('flags', e.target.value)}
                mono
              />
            </div>
            <div className="field" style={{ width: '120px' }}>
              <label htmlFor="record-caa-tag">Tag</label>
              <Input
                id="record-caa-tag"
                value={form.tag}
                onChange={(e) => updateFormField('tag', e.target.value)}
                mono
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="record-caa-value">Value</label>
              <Input
                id="record-caa-value"
                value={form.caaValue}
                onChange={(e) => updateFormField('caaValue', e.target.value)}
                mono
              />
            </div>
          </div>
        )}

        {/* Dangling Reference Warning */}
        {validation.warnings.target && (
          <InlineAlert tone="warn">
            Target not found in this zone or in External Hosts. Deploying will create a dangling
            reference.
          </InlineAlert>
        )}

        {/* TTL Warning */}
        {validation.warnings.ttl && (
          <InlineAlert tone="warn">{validation.warnings.ttl}</InlineAlert>
        )}

        {/* Live Preview Box */}
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '12px',
              marginBottom: '5px',
              color: 'color-mix(in srgb, var(--color-text) 70%, transparent)',
            }}
          >
            Preview — what will be written
          </label>
          <div
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-divider)',
              padding: '10px 12px',
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {previewLine}
          </div>
        </div>
      </SidePanel>
    </div>
  );
}

export function ZoneRecords() {
  return (
    <ToastProvider>
      <ZoneRecordsInner />
    </ToastProvider>
  );
}

export default ZoneRecords;
