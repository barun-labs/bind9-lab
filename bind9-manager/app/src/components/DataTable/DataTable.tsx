import React, { useMemo } from 'react';
import { Skeleton } from '../Skeleton/Skeleton';
import { Button } from '../Button/Button';
import { Checkbox } from '../Checkbox/Checkbox';
import { InlineAlert } from '../InlineAlert/InlineAlert';

export interface DataTableColumn<T> {
  key: string;
  header: React.ReactNode;
  width?: string | number;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  render?: (row: T, index: number) => React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export interface DataTablePagination {
  page: number;
  size: number;
  total: number;
  onPageChange: (page: number) => void;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  sortBy?: string;
  onSort?: (sortKey: string) => void;
  selectable?: boolean;
  selectedIds?: string[] | Set<string> | Record<string, boolean>;
  onSelectionChange?: (selectedIds: string[]) => void;
  stickyHeader?: boolean;
  virtualized?: boolean;
  pagination?: DataTablePagination;
  loading?: boolean;
  error?: string | null | React.ReactNode;
  emptyMessage?: React.ReactNode;
  topRow?: React.ReactNode;
  rowKey?: (row: T, index: number) => string;
  getRowProps?: (
    row: T,
    index: number
  ) => {
    className?: string;
    style?: React.CSSProperties;
    'data-disabled'?: boolean | string;
    opacity?: number | string;
    [key: string]: any;
  };
  className?: string;
  style?: React.CSSProperties;
}

export function DataTable<T extends Record<string, any>>({
  columns,
  rows,
  sortBy,
  onSort,
  selectable = false,
  selectedIds,
  onSelectionChange,
  stickyHeader = true,
  pagination,
  loading = false,
  error = null,
  emptyMessage,
  topRow,
  rowKey = (row: T, idx: number) => (row.id != null ? String(row.id) : String(idx)),
  getRowProps,
  className = '',
  style,
}: DataTableProps<T>) {
  const selectedSet = useMemo<Set<string>>(() => {
    if (!selectedIds) return new Set();
    if (selectedIds instanceof Set) return selectedIds;
    if (Array.isArray(selectedIds)) return new Set(selectedIds);
    if (typeof selectedIds === 'object') {
      const keys = Object.keys(selectedIds).filter((k) => !!selectedIds[k]);
      return new Set(keys);
    }
    return new Set();
  }, [selectedIds]);

  const allRowKeys = useMemo(() => rows.map((r, i) => rowKey(r, i)), [rows, rowKey]);
  const isAllSelected =
    rows.length > 0 && allRowKeys.every((key) => selectedSet.has(key));
  const isSomeSelected =
    rows.length > 0 &&
    !isAllSelected &&
    allRowKeys.some((key) => selectedSet.has(key));

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!onSelectionChange) return;
    if (e.target.checked) {
      const nextSet = new Set(selectedSet);
      allRowKeys.forEach((k) => nextSet.add(k));
      onSelectionChange(Array.from(nextSet));
    } else {
      const nextSet = new Set(selectedSet);
      allRowKeys.forEach((k) => nextSet.delete(k));
      onSelectionChange(Array.from(nextSet));
    }
  };

  const handleToggleRow = (key: string) => {
    if (!onSelectionChange) return;
    const nextSet = new Set(selectedSet);
    if (nextSet.has(key)) {
      nextSet.delete(key);
    } else {
      nextSet.add(key);
    }
    onSelectionChange(Array.from(nextSet));
  };

  const totalCols = columns.length + (selectable ? 1 : 0);

  const totalPages = pagination
    ? Math.max(1, Math.ceil(pagination.total / pagination.size))
    : 1;

  return (
    <div
      className={`data-table-container ${className}`.trim()}
      style={{ display: 'flex', flexDirection: 'column', width: '100%', ...style }}
    >
      <div style={{ width: '100%', overflowX: 'auto' }}>
        <table
          className="table"
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '13px',
          }}
        >
          <thead>
            <tr
              style={{
                position: stickyHeader ? 'sticky' : undefined,
                top: stickyHeader ? 0 : undefined,
                background: 'var(--color-bg)',
                zIndex: stickyHeader ? 2 : undefined,
              }}
            >
              {selectable && (
                <th
                  style={{
                    width: '34px',
                    padding: '8px 8px 8px 24px',
                    borderBottom: '1px solid var(--color-divider)',
                  }}
                >
                  <Checkbox
                    checked={isAllSelected}
                    indeterminate={isSomeSelected}
                    onChange={handleSelectAll}
                    aria-label="Select all rows"
                  />
                </th>
              )}
              {columns.map((col, colIdx) => {
                const isFirstCol = !selectable && colIdx === 0;
                const isLastCol = colIdx === columns.length - 1;
                const isSorted =
                  sortBy && (sortBy === col.key || sortBy.startsWith(`${col.key}:`));
                const isDesc = sortBy?.endsWith(':desc');

                return (
                  <th
                    key={col.key || colIdx}
                    style={{
                      textAlign: col.align || 'left',
                      fontSize: '11px',
                      letterSpacing: '.06em',
                      textTransform: 'uppercase',
                      color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
                      padding: isFirstCol
                        ? '8px 8px 8px 24px'
                        : isLastCol
                        ? '8px 24px 8px 8px'
                        : '8px',
                      borderBottom: '1px solid var(--color-divider)',
                      width: col.width,
                      cursor: col.sortable ? 'pointer' : undefined,
                      userSelect: col.sortable ? 'none' : undefined,
                      ...col.style,
                    }}
                    className={col.className}
                    onClick={() => {
                      if (col.sortable && onSort) {
                        const nextDir =
                          sortBy === `${col.key}:asc` ? 'desc' : 'asc';
                        onSort(`${col.key}:${nextDir}`);
                      }
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      {col.header}
                      {col.sortable && isSorted && (
                        <span style={{ fontSize: '10px' }}>{isDesc ? '▼' : '▲'}</span>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {topRow}

            {loading ? (
              <tr>
                <td colSpan={totalCols} style={{ padding: '16px 24px' }}>
                  <Skeleton variant="table" rows={pagination?.size ? Math.min(pagination.size, 5) : 5} />
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={totalCols} style={{ padding: '16px 24px' }}>
                  <InlineAlert tone="error">
                    {typeof error === 'string' ? error : error}
                  </InlineAlert>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={totalCols}
                  style={{
                    padding: '32px 24px',
                    textAlign: 'center',
                    color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
                    fontSize: '13px',
                  }}
                >
                  {emptyMessage || 'No records found'}
                </td>
              </tr>
            ) : (
              rows.map((row, rowIdx) => {
                const key = rowKey(row, rowIdx);
                const isSelected = selectedSet.has(key);
                const rowCustomProps = getRowProps ? getRowProps(row, rowIdx) : {};
                const {
                  className: customRowClass = '',
                  style: customRowStyle,
                  ...restCustomProps
                } = rowCustomProps;

                return (
                  <tr
                    key={key}
                    className={customRowClass}
                    style={{
                      ...customRowStyle,
                    }}
                    {...restCustomProps}
                  >
                    {selectable && (
                      <td
                        style={{
                          padding: '6px 8px 6px 24px',
                          borderBottom: '1px solid var(--color-divider)',
                          width: '34px',
                        }}
                      >
                        <Checkbox
                          checked={isSelected}
                          onChange={() => handleToggleRow(key)}
                          aria-label={`Select row ${key}`}
                        />
                      </td>
                    )}
                    {columns.map((col, colIdx) => {
                      const isFirstCol = !selectable && colIdx === 0;
                      const isLastCol = colIdx === columns.length - 1;
                      const content = col.render
                        ? col.render(row, rowIdx)
                        : row[col.key];

                      return (
                        <td
                          key={col.key || colIdx}
                          style={{
                            padding: isFirstCol
                              ? '6px 8px 6px 24px'
                              : isLastCol
                              ? '6px 24px 6px 8px'
                              : '6px 8px',
                            borderBottom: '1px solid var(--color-divider)',
                            textAlign: col.align || 'left',
                            width: col.width,
                            ...col.style,
                          }}
                          className={col.className}
                        >
                          {content}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {pagination && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 24px',
            borderTop: '1px solid var(--color-divider)',
          }}
        >
          <span
            style={{
              fontSize: '12px',
              color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
            }}
          >
            Showing {rows.length} of {pagination.total} records
          </span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <Button
              variant="secondary"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPageChange(pagination.page - 1)}
            >
              Prev
            </Button>
            <span
              style={{
                fontSize: '12px',
                padding: '0 6px',
                display: 'flex',
                alignItems: 'center',
                color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
              }}
            >
              Page {pagination.page} of {totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={pagination.page >= totalPages}
              onClick={() => pagination.onPageChange(pagination.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DataTable;
