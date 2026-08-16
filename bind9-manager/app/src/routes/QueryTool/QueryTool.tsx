import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import type { Lab, QueryResult } from '../../types/entities';
import { useApi } from '../../data/store';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { Select } from '../../components/Select/Select';

const QTYPE_OPTIONS = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME', 'SOA', 'PTR', 'SRV', 'CAA', 'ANY'].map(
  (qt) => ({ label: qt, value: qt })
);

export function QueryTool() {
  const { configId = 'dns-lab' } = useParams();
  const api = useApi();

  const [labs, setLabs] = useState<Lab[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedLabId, setSelectedLabId] = useState<string>('');
  const [node, setNode] = useState<string>('');
  const [qname, setQname] = useState<string>('');
  const [qtype, setQtype] = useState<string>('A');
  const [server, setServer] = useState<string>('');

  const [running, setRunning] = useState<boolean>(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const envelope = await api.listLabs(configId);
        const list = Array.isArray(envelope) ? envelope : envelope.data ?? [];
        if (!cancelled) {
          setLabs(list);
          if (list.length > 0) {
            setSelectedLabId(list[0].id);
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          setLoadError(err?.message || 'Failed to load labs');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, configId]);

  const selectedLab = useMemo(
    () => labs.find((l) => l.id === selectedLabId) ?? null,
    [labs, selectedLabId]
  );

  const bindNodes = useMemo(
    () => (selectedLab?.topology?.nodes ?? []).filter((n) => n.intent === 'bind'),
    [selectedLab]
  );

  // Keep the source node pinned to a valid bind node when the lab changes.
  useEffect(() => {
    const names = bindNodes.map((n) => n.name);
    if (!names.includes(node)) {
      setNode(names[0] ?? '');
    }
  }, [bindNodes, node]);

  const labOptions = useMemo(
    () => labs.map((l) => ({ label: l.name, value: l.id })),
    [labs]
  );
  const nodeOptions = useMemo(
    () => bindNodes.map((n) => ({ label: n.name, value: n.name })),
    [bindNodes]
  );

  const handleLabChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedLabId(e.target.value);
  };

  const handleRun = useCallback(async () => {
    const trimmedQname = qname.trim();
    if (!selectedLab || !node || !trimmedQname || running) return;

    setRunning(true);
    setQueryError(null);
    setResult(null);
    try {
      const trimmedServer = server.trim();
      const res = await api.runQuery(selectedLab.id, {
        node,
        qname: trimmedQname,
        qtype,
        server: trimmedServer || undefined,
      });
      setResult(res);
    } catch (err: any) {
      setQueryError(err?.message || 'Query failed');
    } finally {
      setRunning(false);
    }
  }, [api, selectedLab, node, qname, qtype, server, running]);

  const noLabOrBindNode = !loading && (labs.length === 0 || bindNodes.length === 0);

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
          Query Tool
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: '13px',
            color: 'var(--color-text-secondary)',
          }}
        >
          Run dig queries from a lab BIND node.
        </p>
      </div>

      {loadError && (
        <InlineAlert tone="error" style={{ marginBottom: '16px' }}>
          {loadError}
        </InlineAlert>
      )}

      {noLabOrBindNode && !loadError ? (
        <InlineAlert tone="info">Deploy a DNS lab to run queries.</InlineAlert>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleRun();
          }}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            alignItems: 'flex-end',
            marginBottom: '16px',
          }}
        >
          <div className="field" style={{ minWidth: '180px' }}>
            <label htmlFor="query-lab">Lab</label>
            <Select
              id="query-lab"
              value={selectedLabId}
              onChange={handleLabChange}
              options={labOptions}
              disabled={loading || running}
            />
          </div>
          <div className="field" style={{ minWidth: '140px' }}>
            <label htmlFor="query-node">Source node</label>
            <Select
              id="query-node"
              value={node}
              onChange={(e) => setNode(e.target.value)}
              options={nodeOptions}
              disabled={loading || running || bindNodes.length === 0}
            />
          </div>
          <div className="field" style={{ flex: '1 1 180px' }}>
            <label htmlFor="query-qname">Query name</label>
            <Input
              id="query-qname"
              placeholder="example.com."
              value={qname}
              onChange={(e) => setQname(e.target.value)}
              disabled={running}
              mono
            />
          </div>
          <div className="field" style={{ minWidth: '90px' }}>
            <label htmlFor="query-qtype">Type</label>
            <Select
              id="query-qtype"
              value={qtype}
              onChange={(e) => setQtype(e.target.value)}
              options={QTYPE_OPTIONS}
              disabled={running}
            />
          </div>
          <div className="field" style={{ minWidth: '140px' }}>
            <label htmlFor="query-server">@server</label>
            <Input
              id="query-server"
              placeholder="optional"
              value={server}
              onChange={(e) => setServer(e.target.value)}
              disabled={running}
              mono
            />
          </div>
          <div className="field">
            <Button
              variant="primary"
              type="submit"
              disabled={loading || running || !node || !qname.trim()}
              loading={running}
            >
              Run
            </Button>
          </div>
        </form>
      )}

      {queryError && (
        <InlineAlert tone="error" style={{ marginBottom: '16px' }}>
          {queryError}
        </InlineAlert>
      )}

      {result && (
        <pre
          style={{
            margin: 0,
            padding: '16px',
            fontFamily: 'var(--font-mono)',
            fontSize: '13px',
            lineHeight: 1.5,
            overflowX: 'auto',
            whiteSpace: 'pre',
            border: '1px solid var(--color-divider)',
            background: 'var(--color-surface)',
            color: 'var(--color-text)',
          }}
        >
          {result.output}
        </pre>
      )}
    </div>
  );
}

export default QueryTool;
