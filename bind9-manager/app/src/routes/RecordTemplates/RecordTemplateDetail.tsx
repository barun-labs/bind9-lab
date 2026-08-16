import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { RecordTemplate, RecordTemplateEntry } from '../../types/entities';
import { useApi } from '../../data/store';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';
import { Button } from '../../components/Button/Button';

// ponytail: entries render read-only. Each RecordType has a different rdata
// shape (A needs address, MX needs priority+target, ...) so a real editor
// would duplicate the per-type form already built into ZoneRecords.tsx.
// Not worth it for a first pass — add a shared rdata form component and
// wire PATCH .../record-templates/:id here when template authoring is asked for.
const entryColumns: DataTableColumn<RecordTemplateEntry>[] = [
  { key: 'name', header: 'Name', render: (e) => <span style={{ fontFamily: 'var(--font-mono)' }}>{e.name}</span> },
  { key: 'type', header: 'Type', render: (e) => e.type },
  { key: 'ttl', header: 'TTL', render: (e) => e.ttl ?? '—' },
  {
    key: 'rdata',
    header: 'Rdata',
    render: (e) => (
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{JSON.stringify(e.rdata)}</span>
    ),
  },
];

export function RecordTemplateDetail() {
  const { configId = 'dns-lab', templateId = '' } = useParams();
  const navigate = useNavigate();
  const api = useApi();

  const [template, setTemplate] = useState<RecordTemplate | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const found = await api.getRecordTemplate(configId, templateId);
      if (!found) {
        setError('Record template not found');
        return;
      }
      setTemplate(found);
    } catch (err: any) {
      setError(err?.message || 'Failed to load record template');
    } finally {
      setLoading(false);
    }
  }, [api, configId, templateId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div style={{ padding: '24px 32px' }}>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>Loading record template…</p>
      </div>
    );
  }

  if (error || !template) {
    return (
      <div style={{ padding: '24px 32px' }}>
        <InlineAlert tone="error">{error || 'Record template not found'}</InlineAlert>
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
            {template.name}
          </h1>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)' }}>
            {template.description || 'Standardized DNS record set for new zone provisioning.'}
          </p>
        </div>
        <Button variant="secondary" onClick={() => navigate(`/config/${configId}/templates`)}>
          Back
        </Button>
      </div>

      <div
        style={{
          border: '1px solid var(--color-divider)',
          background: 'var(--color-surface)',
        }}
      >
        <DataTable columns={entryColumns} rows={template.entries} emptyMessage="No entries" />
      </div>
    </div>
  );
}

export default RecordTemplateDetail;
