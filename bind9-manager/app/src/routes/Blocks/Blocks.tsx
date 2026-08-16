import { useState, useEffect, useCallback, useMemo, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Block, BlockKind, View } from '../../types/entities';
import { useApi } from '../../data/store';
import { useAuth } from '../../auth/AuthProvider';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { Select } from '../../components/Select/Select';
import { Modal } from '../../components/Modal/Modal';

interface BlockRow extends Block {
  depth: number;
}

// Depth-first flatten so children render directly under their parent, sorted
// by name at each level. Blocks whose parentBlockId points outside this list
// (or is null) are treated as roots.
function flattenHierarchy(blocks: Block[]): BlockRow[] {
  const byParent = new Map<string | null, Block[]>();
  const ids = new Set(blocks.map((b) => b.id));
  for (const block of blocks) {
    const parentKey = block.parentBlockId && ids.has(block.parentBlockId) ? block.parentBlockId : null;
    const siblings = byParent.get(parentKey) ?? [];
    siblings.push(block);
    byParent.set(parentKey, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.name.localeCompare(b.name));
  }

  const rows: BlockRow[] = [];
  function walk(parentKey: string | null, depth: number) {
    for (const block of byParent.get(parentKey) ?? []) {
      rows.push({ ...block, depth });
      walk(block.id, depth + 1);
    }
  }
  walk(null, 0);
  return rows;
}

function KindBadge({ kind }: { kind: BlockKind }) {
  const isNetwork = kind === 'NETWORK';
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: '11px',
        fontWeight: 600,
        letterSpacing: '.04em',
        padding: '2px 6px',
        border: `1px solid ${isNetwork ? 'var(--color-accent)' : 'var(--color-divider)'}`,
        background: isNetwork ? 'var(--color-accent-100)' : 'var(--color-surface)',
        color: isNetwork ? 'var(--color-accent-800)' : 'var(--color-text-secondary)',
      }}
    >
      {kind}
    </span>
  );
}

export function Blocks() {
  const { configId = 'dns-lab' } = useParams();
  const navigate = useNavigate();
  const api = useApi();
  const { can } = useAuth();
  const canEdit = can('edit', configId);

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [views, setViews] = useState<View[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [name, setName] = useState<string>('');
  const [cidr, setCidr] = useState<string>('');
  const [kind, setKind] = useState<BlockKind>('BLOCK');
  const [parentBlockId, setParentBlockId] = useState<string>('');
  const [viewId, setViewId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [blockList, viewList] = await Promise.all([api.listBlocks(configId), api.listViews(configId)]);
      setBlocks(blockList);
      setViews(viewList);
    } catch (err: any) {
      setError(err?.message || 'Failed to load network blocks');
    } finally {
      setLoading(false);
    }
  }, [api, configId]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => flattenHierarchy(blocks), [blocks]);
  const blockById = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks]);

  const handleOpenAdd = () => {
    setName('');
    setCidr('');
    setKind('BLOCK');
    setParentBlockId('');
    setViewId('');
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setModalError(null);
  };

  const handleSubmit = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (isSubmitting) return;

    const trimmedName = name.trim();
    const trimmedCidr = cidr.trim();
    if (!trimmedName || !trimmedCidr) return;
    if (kind === 'NETWORK' && !viewId) {
      setModalError('NETWORK blocks require a view.');
      return;
    }

    setIsSubmitting(true);
    setModalError(null);

    try {
      await api.createBlock(configId, {
        name: trimmedName,
        cidr: trimmedCidr,
        kind,
        parentBlockId: parentBlockId || null,
        viewId: kind === 'NETWORK' ? viewId : undefined,
      });
      setIsModalOpen(false);
      await load();
    } catch (err: any) {
      setModalError(err?.message || 'Failed to create block');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleView = useCallback(
    (block: Block) => {
      navigate(`/config/${configId}/blocks/${block.id}`);
    },
    [navigate, configId]
  );

  const handleDelete = useCallback(
    async (block: Block) => {
      if (!window.confirm(`Delete block ${block.name}?`)) {
        return;
      }
      try {
        await api.deleteBlock(configId, block.id);
        await load();
      } catch (err: any) {
        setError(err?.message || 'Failed to delete block');
      }
    },
    [api, configId, load]
  );

  const columns: DataTableColumn<BlockRow>[] = useMemo(() => {
    const cols: DataTableColumn<BlockRow>[] = [
      {
        key: 'name',
        header: 'Name',
        render: (b) => (
          <button
            type="button"
            onClick={() => handleView(b)}
            className="btn btn-ghost"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              padding: 0,
              paddingLeft: `${b.depth * 20}px`,
              color: 'var(--color-accent-800)',
              cursor: 'pointer',
            }}
          >
            {b.name}
          </button>
        ),
      },
      {
        key: 'cidr',
        header: 'CIDR',
        render: (b) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{b.cidr}</span>,
      },
      {
        key: 'kind',
        header: 'Kind',
        render: (b) => <KindBadge kind={b.kind} />,
      },
      {
        key: 'parent',
        header: 'Parent',
        render: (b) => {
          const parent = b.parentBlockId ? blockById.get(b.parentBlockId) : null;
          return <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>{parent?.name || '—'}</span>;
        },
      },
    ];

    if (canEdit) {
      cols.push({
        key: 'actions',
        header: '',
        width: '100px',
        align: 'right',
        render: (b) => (
          <Button variant="destructive" size="sm" onClick={() => handleDelete(b)} aria-label={`Delete block ${b.name}`}>
            Delete
          </Button>
        ),
      });
    }

    return cols;
  }, [canEdit, handleView, handleDelete, blockById]);

  const parentOptions = useMemo(
    () => blocks.filter((b) => b.kind === 'BLOCK').map((b) => ({ label: b.name, value: b.id })),
    [blocks]
  );
  const viewOptions = useMemo(() => views.map((v) => ({ label: v.name, value: v.id })), [views]);

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
            Network Blocks & Reverse Zones
          </h1>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)' }}>
            CIDR network blocks and reverse DNS hierarchy.
          </p>
        </div>
        {canEdit && (
          <Button variant="primary" onClick={handleOpenAdd}>
            Add block
          </Button>
        )}
      </div>

      {error && (
        <InlineAlert tone="error" style={{ marginBottom: '16px' }}>
          {error}
        </InlineAlert>
      )}

      <div style={{ border: '1px solid var(--color-divider)', background: 'var(--color-surface)' }}>
        <DataTable columns={columns} rows={rows} loading={loading} emptyMessage="No network blocks" />
      </div>

      <Modal
        open={isModalOpen}
        onClose={handleCloseModal}
        title="Add block"
        actions={
          <>
            <Button variant="secondary" onClick={handleCloseModal}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => handleSubmit()}
              disabled={!name.trim() || !cidr.trim() || isSubmitting}
              loading={isSubmitting}
            >
              Create block
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {modalError && <InlineAlert tone="error">{modalError}</InlineAlert>}
          <div className="field">
            <label htmlFor="block-name">Name</label>
            <Input
              id="block-name"
              placeholder="e.g. 10.20.30.0/24 pop1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="block-cidr">CIDR</label>
            <Input
              id="block-cidr"
              mono
              placeholder="e.g. 10.20.30.0/24"
              value={cidr}
              onChange={(e) => setCidr(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="block-kind">Kind</label>
            <Select
              id="block-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as BlockKind)}
              options={[
                { label: 'BLOCK (container)', value: 'BLOCK' },
                { label: 'NETWORK (has reverse zones)', value: 'NETWORK' },
              ]}
            />
          </div>
          <div className="field">
            <label htmlFor="block-parent">Parent block (optional)</label>
            <Select
              id="block-parent"
              value={parentBlockId}
              onChange={(e) => setParentBlockId(e.target.value)}
              placeholder="None (root)"
              options={parentOptions}
            />
          </div>
          {kind === 'NETWORK' && (
            <div className="field">
              <label htmlFor="block-view">View</label>
              <Select
                id="block-view"
                value={viewId}
                onChange={(e) => setViewId(e.target.value)}
                placeholder="Select a view"
                options={viewOptions}
              />
            </div>
          )}
        </form>
      </Modal>
    </div>
  );
}

export default Blocks;
