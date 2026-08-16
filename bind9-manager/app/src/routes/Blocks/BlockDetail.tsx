import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Block } from '../../types/entities';
import { useApi } from '../../data/store';
import { useAuth } from '../../auth/AuthProvider';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { Select } from '../../components/Select/Select';
import { StatusPill } from '../../components/StatusPill/StatusPill';
import type { BlockAddress, BlockAddressPage } from '../../data/apiAdapter';

const childColumns: DataTableColumn<Block>[] = [
  { key: 'name', header: 'Name', render: (b) => b.name },
  { key: 'cidr', header: 'CIDR', render: (b) => <span style={{ fontFamily: 'var(--font-mono)' }}>{b.cidr}</span> },
  { key: 'kind', header: 'Kind', render: (b) => b.kind },
];

const PAGE_SIZES = [256, 512, 1024, 2048, 4096, 8192];

function statusPillState(status: BlockAddress['status']): { state: string; label: string } {
  switch (status) {
    case 'allocated':
      return { state: 'synced', label: 'allocated' };
    case 'network':
      return { state: 'disabled', label: 'network' };
    case 'broadcast':
      return { state: 'disabled', label: 'broadcast' };
    default:
      return { state: 'free', label: 'free' };
  }
}

const addressColumns: DataTableColumn<BlockAddress>[] = [
  { key: 'ip', header: 'IP', render: (a) => <span style={{ fontFamily: 'var(--font-mono)' }}>{a.ip}</span> },
  {
    key: 'status',
    header: 'Status',
    render: (a) => {
      const { state, label } = statusPillState(a.status);
      return <StatusPill state={state} label={label} />;
    },
  },
  { key: 'record', header: 'Record', render: (a) => a.recordName ?? '—' },
];

export function BlockDetail() {
  const { configId = 'dns-lab', blockId = '' } = useParams();
  const navigate = useNavigate();
  const api = useApi();
  const { can } = useAuth();
  const canEdit = can('edit', configId);

  const [block, setBlock] = useState<Block | null>(null);
  const [children, setChildren] = useState<Block[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState<string>('');
  const [cidr, setCidr] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [reconciling, setReconciling] = useState<boolean>(false);
  const [reconcileMessage, setReconcileMessage] = useState<string | null>(null);
  const [reconcileError, setReconcileError] = useState<string | null>(null);

  const [addressPage, setAddressPage] = useState<BlockAddressPage | null>(null);
  const [addressOffset, setAddressOffset] = useState<number>(0);
  const [addressLimit, setAddressLimit] = useState<number>(256);
  const [addressLoading, setAddressLoading] = useState<boolean>(false);
  const [addressError, setAddressError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [found, allBlocks] = await Promise.all([api.getBlock(configId, blockId), api.listBlocks(configId)]);
      if (!found) {
        setError('Block not found');
        return;
      }
      setBlock(found);
      setName(found.name);
      setCidr(found.cidr);
      setChildren(allBlocks.filter((b) => b.parentBlockId === blockId));
    } catch (err: any) {
      setError(err?.message || 'Failed to load block');
    } finally {
      setLoading(false);
    }
  }, [api, configId, blockId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    setAddressLoading(true);
    setAddressError(null);
    api
      .listBlockAddresses(configId, blockId, addressOffset, addressLimit)
      .then((page) => {
        if (!cancelled) setAddressPage(page);
      })
      .catch((err: any) => {
        if (!cancelled) setAddressError(err?.message || 'Failed to load IP addresses');
      })
      .finally(() => {
        if (!cancelled) setAddressLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, configId, blockId, addressOffset, addressLimit]);

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim();
    const trimmedCidr = cidr.trim();
    if (!trimmedName || !trimmedCidr) {
      setSaveError('Name and CIDR are required');
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const updated = await api.updateBlock(configId, blockId, { name: trimmedName, cidr: trimmedCidr });
      setBlock(updated);
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save block');
    } finally {
      setSaving(false);
    }
  }, [api, configId, blockId, name, cidr]);

  const handleReconcile = useCallback(async () => {
    setReconciling(true);
    setReconcileError(null);
    setReconcileMessage(null);
    try {
      const result = await api.reconcileBlock(configId, blockId);
      setReconcileMessage(`Created ${result.created} reverse PTR record${result.created === 1 ? '' : 's'}.`);
    } catch (err: any) {
      setReconcileError(err?.message || 'Failed to reconcile reverse PTRs');
    } finally {
      setReconciling(false);
    }
  }, [api, configId, blockId]);

  const isNetwork = block?.kind === 'NETWORK';

  if (loading) {
    return (
      <div style={{ padding: '24px 32px' }}>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>Loading block…</p>
      </div>
    );
  }

  if (error || !block) {
    return (
      <div style={{ padding: '24px 32px' }}>
        <InlineAlert tone="error">{error || 'Block not found'}</InlineAlert>
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
          <h1 style={{ fontSize: '24px', fontWeight: 600, margin: '0 0 6px 0', fontFamily: 'var(--font-heading)' }}>
            {block.name}
          </h1>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)' }}>
            {block.cidr} · {block.kind}
          </p>
        </div>
        <Button variant="secondary" onClick={() => navigate(`/config/${configId}/blocks`)}>
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
          <label htmlFor="block-detail-name">Name</label>
          <Input id="block-detail-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: '200px' }}>
          <label htmlFor="block-detail-cidr">CIDR</label>
          <Input id="block-detail-cidr" mono value={cidr} onChange={(e) => setCidr(e.target.value)} disabled={!canEdit} />
        </div>
      </div>

      {canEdit && (
        <div style={{ marginBottom: '32px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="primary" onClick={handleSave} loading={saving}>
            Save
          </Button>
          {isNetwork && (
            <Button variant="secondary" onClick={handleReconcile} loading={reconciling}>
              Reconcile reverse PTRs
            </Button>
          )}
        </div>
      )}

      {reconcileMessage && (
        <InlineAlert tone="info" style={{ marginBottom: '16px' }}>
          {reconcileMessage}
        </InlineAlert>
      )}
      {reconcileError && (
        <InlineAlert tone="error" style={{ marginBottom: '16px' }}>
          {reconcileError}
        </InlineAlert>
      )}

      <h2 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 12px 0', fontFamily: 'var(--font-heading)' }}>
        Child blocks
      </h2>
      <div style={{ border: '1px solid var(--color-divider)', background: 'var(--color-surface)' }}>
        <DataTable columns={childColumns} rows={children} emptyMessage="No child blocks" />
      </div>

      {block.cidr && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '32px 0 12px 0' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 600, margin: 0, fontFamily: 'var(--font-heading)' }}>
              IP addresses
            </h2>
            <Select
              value={addressLimit}
              onChange={(e) => {
                setAddressLimit(Number(e.target.value));
                setAddressOffset(0);
              }}
              options={PAGE_SIZES.map((n) => ({ label: `${n} / page`, value: n }))}
              aria-label="IP addresses per page"
            />
          </div>
          <div style={{ border: '1px solid var(--color-divider)', background: 'var(--color-surface)' }}>
            <DataTable
              columns={addressColumns}
              rows={addressPage?.data ?? []}
              loading={addressLoading}
              error={addressError}
              emptyMessage="No addresses"
              rowKey={(a) => a.ip}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 24px',
                borderTop: '1px solid var(--color-divider)',
              }}
            >
              <span style={{ fontSize: '12px', color: 'color-mix(in srgb, var(--color-text) 55%, transparent)' }}>
                Showing {addressPage ? addressOffset + 1 : 0}–{addressPage ? addressOffset + addressPage.data.length : 0} of {addressPage?.total ?? 0}
              </span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={addressOffset === 0}
                  onClick={() => setAddressOffset((o) => Math.max(0, o - addressLimit))}
                >
                  Prev
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={addressOffset + addressLimit >= (addressPage?.total ?? 0)}
                  onClick={() => setAddressOffset((o) => o + addressLimit)}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default BlockDetail;
