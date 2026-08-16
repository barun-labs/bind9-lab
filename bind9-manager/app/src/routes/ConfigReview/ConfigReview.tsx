import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import type { RenderedServerConfig } from '../../types/entities';
import { useApi } from '../../data/store';
import { Select } from '../../components/Select/Select';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';

export function ConfigReview() {
  const { configId = 'dns-lab' } = useParams();
  const api = useApi();

  const [servers, setServers] = useState<RenderedServerConfig[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedServerId, setSelectedServerId] = useState<string>('');

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.getRenderedConfig(configId);
      setServers(list);
      setSelectedServerId((current) =>
        list.some((s) => s.serverId === current) ? current : list[0]?.serverId ?? ''
      );
    } catch (err: any) {
      setError(err?.message || 'Failed to load rendered configuration');
    } finally {
      setLoading(false);
    }
  }, [api, configId]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const selectedServer = useMemo(
    () => servers.find((s) => s.serverId === selectedServerId) ?? null,
    [servers, selectedServerId]
  );

  return (
    <div
      style={{
        padding: '24px 32px',
        maxWidth: 'var(--chrome-max-content-w, 1040px)',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ marginBottom: '24px' }}>
        <h1
          style={{
            fontSize: '24px',
            fontWeight: 600,
            margin: '0 0 6px 0',
            fontFamily: 'var(--font-heading)',
          }}
        >
          Config Review
        </h1>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)' }}>
          Generated named.conf and zone files, as they would be deployed to each server.
        </p>
      </div>

      {error && (
        <InlineAlert tone="error" style={{ marginBottom: '16px' }}>
          {error}
        </InlineAlert>
      )}

      {loading && (
        <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>Loading…</p>
      )}

      {!loading && !error && servers.length === 0 && (
        <InlineAlert tone="info">No servers in this configuration yet.</InlineAlert>
      )}

      {!loading && servers.length > 0 && (
        <>
          <div style={{ marginBottom: '12px', maxWidth: '320px' }}>
            <Select
              value={selectedServerId}
              onChange={(e) => setSelectedServerId(e.target.value)}
              options={servers.map((s) => ({ label: s.hostname, value: s.serverId }))}
              aria-label="Server"
            />
          </div>

          <pre
            style={{
              margin: 0,
              padding: '16px',
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              lineHeight: 1.6,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-divider)',
              maxHeight: 'calc(100vh - 300px)',
              overflow: 'auto',
            }}
          >
            {selectedServer?.text ?? ''}
          </pre>
        </>
      )}
    </div>
  );
}

export default ConfigReview;
