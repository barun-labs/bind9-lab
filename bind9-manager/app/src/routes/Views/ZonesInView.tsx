import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Zone } from '../../types/entities';
import { useStore } from '../../data/store';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';

export function ZonesInView() {
  const { configId = 'dns-lab', viewId = '' } = useParams();
  const store = useStore();

  const zones = useMemo(
    () =>
      store.zones.filter((z) => z.configurationId === configId && z.viewId === viewId),
    [store.zones, configId, viewId]
  );

  const columns: DataTableColumn<Zone>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        render: (z) => (
          <Link
            to={`${z.id}/records`}
            style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'inherit', textDecoration: 'none' }}
          >
            {z.name}
          </Link>
        ),
      },
      {
        key: 'type',
        header: 'Type',
        render: (z) => z.type,
      },
      {
        key: 'recordCount',
        header: 'Records',
        align: 'right',
        render: (z) => z.recordCount,
      },
    ],
    []
  );

  return (
    <div
      style={{
        padding: '20px 32px',
        maxWidth: 'var(--chrome-max-content-w, 1040px)',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ border: '1px solid var(--color-divider)', background: 'var(--color-surface)' }}>
        <DataTable columns={columns} rows={zones} emptyMessage="No zones in this view" />
      </div>
    </div>
  );
}

export default ZonesInView;
