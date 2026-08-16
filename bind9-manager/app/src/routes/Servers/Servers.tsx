import { useState, useEffect, useCallback, useMemo, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import type { Server } from '../../types/entities';
import type { CreateServerInput } from '../../data/apiAdapter';
import { useApi } from '../../data/store';
import { useAuth } from '../../auth/AuthProvider';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { StatusPill } from '../../components/StatusPill/StatusPill';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { Select } from '../../components/Select/Select';
import { Modal } from '../../components/Modal/Modal';
import { TelemetryPanel } from './TelemetryPanel';

function labIdFor(s: Server): string {
  // reconciled server ids are `srv-<labId>-<nodeName>`
  if (s.id.startsWith('srv-') && s.nodeName && s.id.endsWith('-' + s.nodeName)) {
    return s.id.slice(4, -(s.nodeName.length + 1));
  }
  return s.labName ?? '';
}

const ADMIN_STATE_OPTIONS = [
  { label: 'Enabled', value: 'ENABLED' },
  { label: 'Disabled', value: 'DISABLED' },
];

export function Servers() {
  const { configId = 'dns-lab' } = useParams();
  const api = useApi();
  const { can } = useAuth();
  const canEdit = can('edit', configId);

  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [telemetryServer, setTelemetryServer] = useState<Server | null>(null);
  const [editingServer, setEditingServer] = useState<Server | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [hostname, setHostname] = useState<string>('');
  const [mgmtAddress, setMgmtAddress] = useState<string>('');
  const [serviceAddress, setServiceAddress] = useState<string>('');
  const [nodeName, setNodeName] = useState<string>('');
  const [image, setImage] = useState<string>('');
  const [adminState, setAdminState] = useState<'ENABLED' | 'DISABLED'>('ENABLED');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const loadServers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listServers(configId);
      setServers(list);
    } catch (err: any) {
      setError(err?.message || 'Failed to load servers');
    } finally {
      setLoading(false);
    }
  }, [api, configId]);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  const resetServerForm = () => {
    setHostname('');
    setMgmtAddress('');
    setServiceAddress('');
    setNodeName('');
    setImage('');
    setAdminState('ENABLED');
    setModalError(null);
  };

  const handleOpenModal = () => {
    setEditingServer(null);
    resetServerForm();
    setIsModalOpen(true);
  };

  const handleOpenEdit = useCallback((server: Server) => {
    setEditingServer(server);
    setHostname(server.hostname);
    setMgmtAddress(server.mgmtAddress ?? '');
    setServiceAddress(server.serviceAddress ?? '');
    setNodeName(server.nodeName ?? '');
    setImage(server.image ?? '');
    setModalError(null);
    setIsModalOpen(true);
  }, []);

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingServer(null);
    resetServerForm();
  };

  const handleSubmitServer = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    const trimmedHostname = hostname.trim();
    if (!trimmedHostname || isSubmitting) return;

    setIsSubmitting(true);
    setModalError(null);

    try {
      if (editingServer) {
        await api.updateServer(configId, editingServer.id, {
          hostname: trimmedHostname,
          mgmtAddress: mgmtAddress.trim() || undefined,
          nodeName: nodeName.trim() || undefined,
          image: image.trim() || undefined,
        });
      } else {
        const input: CreateServerInput = {
          hostname: trimmedHostname,
          adminState,
          ...(mgmtAddress.trim() ? { mgmtAddress: mgmtAddress.trim() } : {}),
          ...(nodeName.trim() ? { nodeName: nodeName.trim() } : {}),
          ...(image.trim() ? { image: image.trim() } : {}),
          ...(serviceAddress.trim()
            ? { serviceInterfaces: [{ address: serviceAddress.trim(), port: 53 }] }
            : {}),
        };
        await api.createServer(configId, input);
      }
      setIsModalOpen(false);
      setEditingServer(null);
      resetServerForm();
      await loadServers();
    } catch (err: any) {
      setModalError(err?.message || 'Failed to save server');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteServer = useCallback(
    async (server: Server) => {
      if (!window.confirm(`Delete server ${server.hostname}?`)) {
        return;
      }
      try {
        await api.deleteServer(configId, server.id);
        await loadServers();
      } catch (err: any) {
        setError(err?.message || 'Failed to delete server');
      }
    },
    [api, configId, loadServers]
  );

  const columns: DataTableColumn<Server>[] = useMemo(() => {
    const cols: DataTableColumn<Server>[] = [
      {
        key: 'hostname',
        header: 'Hostname',
        render: (s) => (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>{s.hostname}</span>
        ),
      },
      {
        key: 'node',
        header: 'Node',
        render: (s) => s.nodeName ?? '—',
      },
      {
        key: 'mgmt',
        header: 'Mgmt address',
        render: (s) => s.mgmtAddress ?? '—',
      },
      {
        key: 'runtime',
        header: 'Runtime address',
        render: (s) => s.runtimeAddress ?? '—',
      },
      {
        key: 'sync',
        header: 'Sync',
        width: '160px',
        render: (s) => <StatusPill state={s.syncState} label={s.syncState} />,
      },
      {
        key: 'telemetry',
        header: '',
        width: '120px',
        render: (s) => (
          <Button size="sm" onClick={() => setTelemetryServer(s)}>
            Telemetry
          </Button>
        ),
      },
    ];

    if (canEdit) {
      cols.push({
        key: 'actions',
        header: '',
        width: '150px',
        align: 'right',
        render: (s) => (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
            <Button
              size="sm"
              onClick={() => handleOpenEdit(s)}
              aria-label={`Edit server ${s.hostname}`}
            >
              Edit
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => handleDeleteServer(s)}
              aria-label={`Delete server ${s.hostname}`}
            >
              Delete
            </Button>
          </div>
        ),
      });
    }

    return cols;
  }, [canEdit, handleDeleteServer, handleOpenEdit]);

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
            Servers
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: '13px',
              color: 'var(--color-text-secondary)',
            }}
          >
            Managed BIND instances, network interfaces, and containerlab nodes.
          </p>
        </div>
        {canEdit && (
          <Button variant="primary" onClick={handleOpenModal}>
            Add Server
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
          rows={servers}
          loading={loading}
          emptyMessage="No servers"
        />
      </div>

      <TelemetryPanel
        labId={telemetryServer ? labIdFor(telemetryServer) : ''}
        open={telemetryServer !== null}
        onClose={() => setTelemetryServer(null)}
      />

      <Modal
        open={isModalOpen}
        onClose={handleCloseModal}
        title={editingServer ? 'Edit Server' : 'Add Server'}
        actions={
          <>
            <Button variant="secondary" onClick={handleCloseModal}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => handleSubmitServer()}
              disabled={!hostname.trim() || isSubmitting}
              loading={isSubmitting}
            >
              {editingServer ? 'Save' : 'Add'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmitServer} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {modalError && <InlineAlert tone="error">{modalError}</InlineAlert>}
          <div className="field">
            <label htmlFor="server-hostname">Hostname</label>
            <Input
              id="server-hostname"
              placeholder="e.g. ns1"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              autoFocus
            />
          </div>

          <div className="field">
            <label htmlFor="server-mgmt-address">Mgmt address</label>
            <Input
              id="server-mgmt-address"
              placeholder="e.g. 10.70.0.11"
              value={mgmtAddress}
              onChange={(e) => setMgmtAddress(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="server-service-address">Service address</label>
            <Input
              id="server-service-address"
              placeholder="e.g. 10.70.0.11"
              value={serviceAddress}
              onChange={(e) => setServiceAddress(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="server-node-name">Node name</label>
            <Input
              id="server-node-name"
              placeholder="e.g. ns1"
              value={nodeName}
              onChange={(e) => setNodeName(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="server-image">Image</label>
            <Input
              id="server-image"
              placeholder="e.g. dnsnode:1.0"
              value={image}
              onChange={(e) => setImage(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="server-admin-state">Admin state</label>
            <Select
              id="server-admin-state"
              value={adminState}
              onChange={(e) => setAdminState(e.target.value as 'ENABLED' | 'DISABLED')}
              options={ADMIN_STATE_OPTIONS}
            />
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default Servers;
