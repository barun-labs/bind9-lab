import { useEffect, useState } from 'react';
import { useApi } from '../../data/store';
import type { StatisticsSnapshot, ServerStatistics } from '../../types/entities';
import { StatusPill } from '../../components/StatusPill/StatusPill';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';

interface StatisticsPanelProps {
  labId: string;
  active: boolean;
}

const labelStyle: React.CSSProperties = {
  fontSize: '11px',
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
  marginBottom: '2px',
};

const valueStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '15px',
  fontWeight: 600,
};

const cardStyle: React.CSSProperties = {
  padding: '16px',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-divider)',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

function Stat({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <div style={valueStyle}>{value ?? '—'}</div>
    </div>
  );
}

function friendlyError(err: any): string {
  const status = err?.status;
  if (status === 422) return 'Metrics are only available for a deployed DNS lab.';
  if (status === 403) return 'You do not have permission to view metrics for this lab.';
  if (status === 404) return 'This lab no longer exists.';
  return err?.message || 'Failed to load statistics.';
}

function ServerCard({ server }: { server: ServerStatistics }) {
  const codes = server.responseCodes;
  const ratio =
    server.cacheHitRatio !== undefined
      ? `${(server.cacheHitRatio * 100).toFixed(1)}%`
      : undefined;

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{server.nodeName}</span>
        <StatusPill
          state={server.present ? 'synced' : 'error'}
          label={server.present ? 'Live' : 'No data'}
        />
      </div>

      <Stat label="Total queries" value={server.totalQueries} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
        <Stat label="NOERROR" value={codes?.NOERROR} />
        <Stat label="NXDOMAIN" value={codes?.NXDOMAIN} />
        <Stat label="SERVFAIL" value={codes?.SERVFAIL} />
        <Stat label="REFUSED" value={codes?.REFUSED} />
      </div>

      <div>
        <div style={labelStyle}>Cache hit ratio</div>
        <div style={valueStyle}>{ratio ?? '—'}</div>
        {(server.cacheHits !== undefined || server.cacheMisses !== undefined) && (
          <div style={{ ...valueStyle, fontSize: '12px', fontWeight: 400, marginTop: '2px' }}>
            {server.cacheHits ?? '—'} hits · {server.cacheMisses ?? '—'} misses
          </div>
        )}
      </div>

      {server.recursionCount !== undefined && (
        <Stat label="Recursion count" value={server.recursionCount} />
      )}
    </div>
  );
}

export function StatisticsPanel({ labId, active }: StatisticsPanelProps) {
  const api = useApi();
  const [snapshot, setSnapshot] = useState<StatisticsSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !labId) return;
    let cancelled = false;

    const load = async () => {
      try {
        const snap = await api.getLabStatistics(labId);
        if (cancelled) return;
        setSnapshot(snap);
        setError(null);
      } catch (err: any) {
        if (cancelled) return;
        setError(friendlyError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    setLoading(true);
    load();
    const interval = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [api, labId, active]);

  if (!active) return null;

  const servers = snapshot?.servers ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>BIND Statistics</h3>
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-text-secondary)' }}>
          Per-server query and cache counters, refreshed every 5 seconds.
        </p>
      </div>

      {loading && !snapshot && (
        <div style={{ color: 'var(--color-text-secondary)' }}>Loading statistics…</div>
      )}

      {error && <InlineAlert tone="error">{error}</InlineAlert>}

      {snapshot?.runtimeError && <InlineAlert tone="warn">{snapshot.runtimeError}</InlineAlert>}

      {!error && !loading && servers.length === 0 && (
        <div
          style={{
            padding: '24px',
            textAlign: 'center',
            color: 'var(--color-text-secondary)',
            border: '1px solid var(--color-divider)',
            background: 'var(--color-surface)',
          }}
        >
          No BIND servers reporting statistics.
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: '16px',
        }}
      >
        {servers.map((server) => (
          <ServerCard key={server.serverId} server={server} />
        ))}
      </div>
    </div>
  );
}

export default StatisticsPanel;
