import { useEffect, useState } from 'react';
import { useApi } from '../../data/store';
import type { TelemetrySnapshot } from '../../types/entities';
import { SidePanel } from '../../components/SidePanel/SidePanel';
import { StatusPill } from '../../components/StatusPill/StatusPill';
import { CodeBlock } from '../../components/CodeBlock/CodeBlock';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';
import { Button } from '../../components/Button/Button';

interface TelemetryPanelProps {
  labId: string;
  open: boolean;
  onClose: () => void;
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  fontSize: '11px',
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
  padding: '8px',
  borderBottom: '1px solid var(--color-divider)',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '8px',
  borderBottom: '1px solid var(--color-divider)',
  fontSize: '13px',
  whiteSpace: 'nowrap',
};

export function TelemetryPanel({ labId, open, onClose }: TelemetryPanelProps) {
  const api = useApi();
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null);
  const [logsFor, setLogsFor] = useState<{ node: string; text: string } | null>(null);
  const [logsLoading, setLogsLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!open) return;
    const closeStream = api.openTelemetryStream(labId, setSnapshot);
    return closeStream;
  }, [api, labId, open]);

  const handleLogs = async (node: string) => {
    setLogsLoading(true);
    setLogsFor(null);
    try {
      const text = await api.getNodeLogs(labId, node);
      setLogsFor({ node, text });
    } finally {
      setLogsLoading(false);
    }
  };

  const nodes = snapshot?.nodes ?? [];

  return (
    <SidePanel open={open} onClose={onClose} title={`Telemetry — ${labId}`} width="640px">
      {snapshot?.runtimeError && (
        <InlineAlert tone="error">{snapshot.runtimeError}</InlineAlert>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>Node</th>
            <th style={thStyle}>State</th>
            <th style={thStyle}>CPU</th>
            <th style={thStyle}>Mem %</th>
            <th style={thStyle}>Mem usage</th>
            <th style={thStyle}>Net IO</th>
            <th style={thStyle} />
          </tr>
        </thead>
        <tbody>
          {nodes.map((n) => {
            const state = n.state ?? (n.present ? 'running' : 'NODE_ABSENT');
            return (
              <tr key={n.nodeName}>
                <td style={tdStyle}>{n.nodeName}</td>
                <td style={tdStyle}>
                  <StatusPill state={state} label={state} />
                </td>
                <td style={tdStyle}>{n.cpuPerc ?? '—'}</td>
                <td style={tdStyle}>{n.memPerc ?? '—'}</td>
                <td style={tdStyle}>{n.memUsage ?? '—'}</td>
                <td style={tdStyle}>{n.netIO ?? '—'}</td>
                <td style={tdStyle}>
                  <Button size="sm" onClick={() => handleLogs(n.nodeName)}>
                    Logs
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {logsLoading && <div>Loading…</div>}
      {logsFor && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
            Logs — {logsFor.node}
          </div>
          <CodeBlock code={logsFor.text} />
        </div>
      )}
    </SidePanel>
  );
}

export default TelemetryPanel;
