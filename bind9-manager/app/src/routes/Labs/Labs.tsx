import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import type { Lab, ListEnvelope } from '../../types/entities';
import { useApi } from '../../data/store';
import { useAuth } from '../../auth/AuthProvider';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { Textarea } from '../../components/Textarea/Textarea';
import { Modal } from '../../components/Modal/Modal';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';
import { StatusPill } from '../../components/StatusPill/StatusPill';

function formatDate(isoString?: string | null): string {
  if (!isoString) return '—';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return date.toISOString().replace('T', ' ').substring(0, 16);
  } catch {
    return isoString;
  }
}

export function Labs() {
  const { configId = 'dns-lab' } = useParams();
  const navigate = useNavigate();
  const api = useApi();
  const { can } = useAuth();
  const canEdit = can('edit', configId);

  const [labsEnvelope, setLabsEnvelope] = useState<ListEnvelope<Lab>>({
    data: [],
    page: 1,
    size: 50,
    total: 0,
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [labName, setLabName] = useState<string>('');
  const [importYaml, setImportYaml] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const fetchLabs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.listLabs(configId);
      setLabsEnvelope(response);
    } catch (err: any) {
      setError(err?.message || 'Failed to load labs');
    } finally {
      setLoading(false);
    }
  }, [api, configId]);

  useEffect(() => {
    fetchLabs();
  }, [fetchLabs]);

  const handleOpenModal = () => {
    setLabName('');
    setImportYaml('');
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setLabName('');
    setImportYaml('');
    setModalError(null);
  };

  const handleCreateLab = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmedName = labName.trim();
    if (!trimmedName || isSubmitting) return;

    setIsSubmitting(true);
    setModalError(null);

    try {
      let created: Lab;
      if (importYaml.trim()) {
        created = await api.importLab({
          name: trimmedName,
          configurationId: configId,
          yaml: importYaml.trim(),
        });
      } else {
        created = await api.createLab({
          name: trimmedName,
          configurationId: configId,
          topology: {
            name: trimmedName,
            mgmtNetwork: 'clab-mgmt',
            mgmtSubnet: '10.70.0.0/24',
            nodes: [],
            links: [],
          },
        });
      }
      setIsModalOpen(false);
      await fetchLabs();
      navigate(`/config/${configId}/labs/${created.id}`);
    } catch (err: any) {
      setModalError(err?.message || 'Failed to create lab');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteLab = useCallback(async (lab: Lab) => {
    if (!window.confirm(`Are you sure you want to delete lab "${lab.name}"?`)) {
      return;
    }
    try {
      await api.deleteLab(lab.id);
      await fetchLabs();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete lab');
    }
  }, [api, fetchLabs]);

  const columns: DataTableColumn<Lab>[] = useMemo(() => {
    const cols: DataTableColumn<Lab>[] = [
      {
        key: 'name',
        header: 'Lab Name',
        render: (lab) => (
          <Link
            to={`/config/${configId}/labs/${lab.id}`}
            style={{
              fontWeight: 600,
              color: 'var(--color-accent-800)',
              textDecoration: 'none',
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
            }}
          >
            {lab.name}
          </Link>
        ),
      },
      {
        key: 'nodes',
        header: 'Nodes',
        width: '120px',
        render: (lab) => {
          const count = lab.topology?.nodes?.length || 0;
          return <span>{count} node{count === 1 ? '' : 's'}</span>;
        },
      },
      {
        key: 'links',
        header: 'Links',
        width: '120px',
        render: (lab) => {
          const count = lab.topology?.links?.length || 0;
          return <span>{count} link{count === 1 ? '' : 's'}</span>;
        },
      },
      {
        key: 'lifecycle',
        header: 'Status',
        width: '150px',
        render: (lab) => {
          const st = lab.lifecycleState ?? 'NEVER_DEPLOYED';
          const map: Record<string, { state: string; label: string }> = {
            NEVER_DEPLOYED: { state: 'pending', label: 'Not deployed' },
            DEPLOYED: { state: 'synced', label: 'Deployed' },
            DESTROYED: { state: 'error', label: 'Destroyed' },
          };
          const m = map[st] ?? map.NEVER_DEPLOYED;
          return <StatusPill state={m.state} label={m.label} />;
        },
      },
      {
        key: 'updatedAt',
        header: 'Last Updated',
        width: '160px',
        render: (lab) => (
          <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
            {formatDate(lab.updatedAt || lab.createdAt)}
          </span>
        ),
      },
    ];

    if (canEdit) {
      cols.push({
        key: 'actions',
        header: '',
        width: '140px',
        align: 'right',
        render: (lab) => (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
            <Link
              to={`/config/${configId}/labs/${lab.id}`}
              className="btn btn-secondary blueprint"
              style={{
                height: '28px',
                padding: '0 10px',
                fontSize: '12px',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              Open
            </Link>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => handleDeleteLab(lab)}
              aria-label={`Delete lab ${lab.name}`}
            >
              Delete
            </Button>
          </div>
        ),
      });
    }

    return cols;
  }, [configId, canEdit, handleDeleteLab]);


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
            Declarative Labs
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: '13px',
              color: 'var(--color-text-secondary)',
            }}
          >
            Declare and manage containerlab DNS topologies paired with Configuration DNS models.
          </p>
        </div>
        {canEdit && (
          <Button variant="primary" onClick={handleOpenModal}>
            New Lab
          </Button>
        )}
      </div>

      {error && (
        <InlineAlert tone="error" style={{ marginBottom: '16px' }}>
          {error}
        </InlineAlert>
      )}

      <div
        style={{
          border: '1px solid var(--color-divider)',
          background: 'var(--color-surface)',
        }}
      >
        <DataTable
          columns={columns}
          rows={labsEnvelope.data}
          loading={loading}
          emptyMessage="No declarative labs defined yet. Click 'New Lab' to create one."
        />
      </div>

      <Modal
        open={isModalOpen}
        onClose={handleCloseModal}
        title="New Lab"
        actions={
          <>
            <Button variant="secondary" onClick={handleCloseModal}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => handleCreateLab()}
              disabled={!labName.trim() || isSubmitting}
              loading={isSubmitting}
            >
              Create Lab
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreateLab} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {modalError && <InlineAlert tone="error">{modalError}</InlineAlert>}
          <div className="field">
            <label htmlFor="lab-name">Lab Name</label>
            <Input
              id="lab-name"
              placeholder="e.g. dns-anycast-lab"
              value={labName}
              onChange={(e) => setLabName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="field">
            <label htmlFor="lab-import-yaml">Import from clab.yml (optional)</label>
            <Textarea
              id="lab-import-yaml"
              placeholder="Paste existing containerlab YAML here, or leave empty to start with an empty topology."
              value={importYaml}
              onChange={(e) => setImportYaml(e.target.value)}
              rows={8}
              mono
            />
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default Labs;
