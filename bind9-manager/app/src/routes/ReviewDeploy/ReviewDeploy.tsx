import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import type {
  ChangeSetResponse,
  DeployPreflight,
  ChangeSetDeployJob,
  Server,
} from '../../types/entities';
import type { CreateDeployJobInput, UnifiedDiff, SplitDiff } from '../../data/apiAdapter';
import { useApi } from '../../data/store';
import { useAuth } from '../../auth/AuthProvider';
import { Checkbox } from '../../components/Checkbox/Checkbox';
import { Button } from '../../components/Button/Button';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';

const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'PARTIAL', 'CANCELLED']);
const MONO = { fontFamily: 'var(--font-mono)' } as const;

function preflightHasWarn(preflight: DeployPreflight | undefined | null): boolean {
  if (!preflight) return false;
  return [...preflight.checkconf, ...preflight.checkzone].some((c) => c.result === 'WARN');
}

interface ResultRow {
  serverId: string;
  outcome: string;
  stderr?: string;
}

function CheckIcon({ color }: { color: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}>
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function XIcon({ color }: { color: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5l5 5M14.5 9.5l-5 5" />
    </svg>
  );
}

function WarnIcon({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none', marginTop: '1px' }}>
      <path d="M12 3l9.5 17H2.5L12 3z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17" r=".6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ flex: 'none', animation: 'reviewdeploy-spin .8s linear infinite' }}>
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
    </svg>
  );
}

const PREFLIGHT_RESULT_META: Record<string, { color: string; icon: (c: string) => React.ReactNode }> = {
  OK: { color: 'var(--state-success)', icon: (c) => <CheckIcon color={c} /> },
  WARN: { color: 'var(--state-drift)', icon: (c) => <WarnIcon color={c} /> },
  FAIL: { color: 'var(--state-error)', icon: (c) => <XIcon color={c} /> },
};

export function ReviewDeploy() {
  const { configId = 'dns-lab' } = useParams();
  const api = useApi();
  const { can } = useAuth();
  const canDeploy = can('deploy', configId);

  const [changeSet, setChangeSet] = useState<ChangeSetResponse | null>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [diffMode, setDiffMode] = useState<'unified' | 'split'>('unified');
  const [diff, setDiff] = useState<UnifiedDiff | SplitDiff | null>(null);

  const [job, setJob] = useState<ChangeSetDeployJob | null>(null);
  const [running, setRunning] = useState<boolean>(false);
  const [blockedPreflight, setBlockedPreflight] = useState<DeployPreflight | null>(null);
  const [warningAck, setWarningAck] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [cs, srv] = await Promise.all([api.getChangeSet(configId), api.listServers(configId)]);
        if (cancelled) return;
        setChangeSet(cs);
        setServers(srv);
        setSelected(srv.map((s) => s.id));
      } catch (err: any) {
        if (!cancelled) setLoadError(err?.message || 'Failed to load change set');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, configId]);

  const diffServerId = selected.length > 0 ? selected[0] : undefined;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await api.getChangeSetDiff(configId, diffMode, diffServerId);
        if (!cancelled) setDiff(d);
      } catch {
        if (!cancelled) {
          setDiff(diffMode === 'unified' ? { mode: 'unified', lines: [] } : { mode: 'split', left: [], right: [] });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, configId, diffMode, diffServerId]);

  useEffect(() => () => {
    if (pollRef.current !== null) window.clearTimeout(pollRef.current);
  }, []);

  const pollJob = useCallback(
    (jobId: string) => {
      const tick = async () => {
        try {
          const j = await api.getChangeSetDeployJob(configId, jobId);
          if (!j) {
            setError('Deploy job not found');
            setRunning(false);
            return;
          }
          setJob(j);
          if (TERMINAL_STATUSES.has(j.status)) {
            setRunning(false);
            if (j.status === 'SUCCEEDED') {
              try {
                const cs = await api.getChangeSet(configId);
                setChangeSet(cs);
              } catch {
                // keep last known change set
              }
            }
            return;
          }
        } catch (err: any) {
          setError(err?.message || 'Failed to poll deploy job');
          setRunning(false);
          return;
        }
        pollRef.current = window.setTimeout(tick, 1500);
      };
      tick();
    },
    [api, configId]
  );

  const changeSetItemIds = useMemo(() => (changeSet?.items ?? []).map((i) => i.id), [changeSet]);

  const preflight = job?.preflight ?? blockedPreflight;
  const hasWarn = preflightHasWarn(preflight);

  const handleDeploy = useCallback(async () => {
    if (running || selected.length === 0) return;
    setError(null);
    setBlockedPreflight(null);
    setRunning(true);
    try {
      const payload: CreateDeployJobInput = { changeSetItemIds, targetServerIds: selected };
      if (hasWarn) payload.warningAck = warningAck;
      const { jobId } = await api.createDeployJob(configId, payload);
      setJob({
        id: jobId,
        configurationId: configId,
        changeSetItemIds,
        targetServerIds: selected,
        status: 'QUEUED',
        serverResults: [],
        createdAt: '',
      });
      pollJob(jobId);
    } catch (err: any) {
      setRunning(false);
      if (err?.code === 'PREFLIGHT_FAILED' || err?.code === 'PREFLIGHT_WARNING_UNACK') {
        setBlockedPreflight(err?.preflight ?? null);
      } else {
        setError(err?.message || 'Deploy failed');
      }
    }
  }, [running, selected, changeSetItemIds, hasWarn, warningAck, api, configId, pollJob]);

  const handleRetry = useCallback(
    async (serverId: string) => {
      if (!job || running) return;
      setError(null);
      setRunning(true);
      try {
        const { jobId } = await api.retryDeployJob(configId, job.id, serverId);
        setJob({ ...job, id: jobId, status: 'QUEUED' });
        pollJob(jobId);
      } catch (err: any) {
        setRunning(false);
        setError(err?.message || 'Retry failed');
      }
    },
    [job, running, api, configId, pollJob]
  );

  const toggleServer = useCallback((id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const toggleGroup = useCallback((key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const isGroupExpanded = useCallback(
    (key: string, idx: number) => expanded[key] ?? idx === 0,
    [expanded]
  );

  const resultRows: ResultRow[] = useMemo(() => {
    if (!job) return [];
    if (job.serverResults.length > 0) return job.serverResults;
    return (job.targetServerIds ?? []).map((sid) => ({ serverId: sid, outcome: 'RUNNING' }));
  }, [job]);

  const isRunning = job !== null && !TERMINAL_STATUSES.has(job.status);
  const succeededCount = resultRows.filter((r) => r.outcome === 'SUCCEEDED').length;

  const deployDisabled =
    !canDeploy || selected.length === 0 || running || (hasWarn && !warningAck);
  const deployLabel = running
    ? 'Deploying…'
    : `Deploy to ${selected.length} server${selected.length === 1 ? '' : 's'}`;

  const pendingCount = changeSet?.items.length ?? 0;

  const diffLines =
    diff && diff.mode === 'unified' ? (diff as UnifiedDiff).lines : [];

  const renderUnifiedDiff = () => (
    <div style={{ ...MONO, fontSize: '12px', lineHeight: 1.7, background: 'var(--color-surface)', border: '1px solid var(--color-divider)' }}>
      {diffLines.map((ln, i) => {
        const prefix = ln.kind === 'add' ? '+' : ln.kind === 'del' ? '-' : ' ';
        const bg = ln.kind === 'add' ? 'var(--diff-added-bg)' : ln.kind === 'del' ? 'var(--diff-removed-bg)' : 'transparent';
        const color = ln.kind === 'add' ? 'var(--diff-added-text)' : ln.kind === 'del' ? 'var(--diff-removed-text)' : 'var(--color-text)';
        return (
          <div key={i} style={{ padding: '0 12px', whiteSpace: 'pre', background: bg, color }}>
            {prefix} {ln.text}
          </div>
        );
      })}
    </div>
  );

  const renderSplitDiff = () => {
    const left = diff && diff.mode === 'split' ? (diff as SplitDiff).left : [];
    const right = diff && diff.mode === 'split' ? (diff as SplitDiff).right : [];
    const col = (lines: { kind: string; text: string }[], side: 'left' | 'right') => (
      <div style={{ background: 'var(--color-surface)' }}>
        <div style={{ padding: '4px 12px', fontSize: '10px', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', borderBottom: '1px solid var(--color-divider)' }}>
          {side === 'left' ? 'Deployed' : 'Staged'}
        </div>
        {lines.map((ln, i) => {
          const tinted = side === 'left' ? ln.kind === 'del' : ln.kind === 'add';
          return (
            <div
              key={i}
              style={{
                padding: '0 12px',
                whiteSpace: 'pre',
                background: tinted ? (side === 'left' ? 'var(--diff-removed-bg)' : 'var(--diff-added-bg)') : 'transparent',
                color: tinted ? (side === 'left' ? 'var(--diff-removed-text)' : 'var(--diff-added-text)') : 'var(--color-text)',
              }}
            >
              {ln.text}
            </div>
          );
        })}
      </div>
    );
    return (
      <div style={{ ...MONO, fontSize: '12px', lineHeight: 1.7, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', background: 'var(--color-divider)', border: '1px solid var(--color-divider)' }}>
        {col(left, 'left')}
        {col(right, 'right')}
      </div>
    );
  };

  const renderOutcomeIcon = (outcome: string) => {
    if (outcome === 'SUCCEEDED') return <CheckIcon color="var(--state-success)" />;
    if (outcome === 'RUNNING' || outcome === 'QUEUED') return <SpinnerIcon />;
    return <XIcon color="var(--state-error)" />;
  };

  const outcomeText: Record<string, { text: string; color: string }> = {
    SUCCEEDED: { text: 'Deployed', color: 'var(--state-success)' },
    FAILED: { text: 'Failed', color: 'var(--state-error)' },
    PARTIAL: { text: 'Partial', color: 'var(--state-drift)' },
    CANCELLED: { text: 'Cancelled', color: 'var(--color-text-tertiary)' },
    RUNNING: { text: 'Deploying…', color: 'var(--color-accent)' },
    QUEUED: { text: 'Queued', color: 'var(--color-text-tertiary)' },
  };

  return (
    <div style={{ padding: '24px 32px 120px', maxWidth: 'var(--chrome-max-content-w, 1040px)', width: '100%', boxSizing: 'border-box' }}>
      <style>{`@keyframes reviewdeploy-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 600, margin: '0 0 6px 0', fontFamily: 'var(--font-heading)' }}>
          Review &amp; Deploy
        </h1>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-secondary)' }}>
          {pendingCount} pending change{pendingCount === 1 ? '' : 's'}
          {!job && '. Nothing below has been written to a server yet.'}
        </p>
      </div>

      {loadError && (
        <InlineAlert tone="error" style={{ marginBottom: '16px' }}>
          {loadError}
        </InlineAlert>
      )}
      {error && (
        <InlineAlert tone="error" style={{ marginBottom: '16px' }}>
          {error}
        </InlineAlert>
      )}

      {job && (
        <div className="blueprint" style={{ border: '1px solid var(--color-divider)', padding: '16px', marginBottom: '20px' }}>
          <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: '16px', marginBottom: '10px' }}>
            {isRunning ? 'Deploying…' : 'Deploy result'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {resultRows.map((row) => {
              const meta = outcomeText[row.outcome] ?? { text: row.outcome, color: 'var(--color-text)' };
              const failed = row.outcome === 'FAILED';
              return (
                <div key={row.serverId} style={{ border: '1px solid var(--color-divider)', padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {renderOutcomeIcon(row.outcome)}
                    <span style={{ ...MONO, fontSize: '13px', fontWeight: 500 }}>{row.serverId}</span>
                    <span style={{ fontSize: '12px', color: meta.color }}>{meta.text}</span>
                    <div style={{ flex: 1 }} />
                    {failed && (
                      <Button variant="secondary" size="sm" disabled={!canDeploy || running} onClick={() => handleRetry(row.serverId)}>
                        Retry
                      </Button>
                    )}
                  </div>
                  {failed && row.stderr && (
                    <div style={{ marginTop: '8px', background: 'var(--state-error-bg)', color: 'var(--state-error)', border: '1px solid var(--state-error)', padding: '8px 10px', ...MONO, fontSize: '11.5px', whiteSpace: 'pre-wrap' }}>
                      {row.stderr}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {!isRunning && (
            <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
              {succeededCount} of {resultRows.length} server{resultRows.length === 1 ? '' : 's'} deployed successfully
            </div>
          )}
        </div>
      )}

      <div style={{ border: '1px solid var(--color-divider)', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--color-divider)' }}>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: '15px' }}>Change set</div>
          <div style={{ display: 'flex', border: '1px solid var(--color-divider)' }}>
            {(['unified', 'split'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setDiffMode(m)}
                style={{
                  padding: '4px 10px',
                  fontSize: '11px',
                  textTransform: 'capitalize',
                  border: 'none',
                  cursor: 'pointer',
                  background: diffMode === m ? 'var(--color-accent-100)' : 'transparent',
                  color: diffMode === m ? 'var(--color-accent-800)' : 'var(--color-text-tertiary)',
                  fontWeight: diffMode === m ? 600 : 400,
                }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {!loading && pendingCount === 0 && (
          <div style={{ padding: '16px' }}>
            <InlineAlert tone="info">No pending changes.</InlineAlert>
          </div>
        )}

        {(changeSet?.groups ?? []).map((g, idx) => {
          const key = g.groupKey;
          const open = isGroupExpanded(key, idx);
          return (
            <div key={key} style={{ borderBottom: '1px solid var(--color-divider)' }}>
              <button
                type="button"
                onClick={() => toggleGroup(key)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(90deg)' : 'none', flex: 'none', color: 'var(--color-text-tertiary)' }}>
                  <path d="M9 18l6-6-6-6" />
                </svg>
                <span style={{ ...MONO, fontSize: '14px', fontWeight: 500 }}>{g.groupKey}</span>
                <span style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                  {g.objectType} · {g.items.length} change{g.items.length === 1 ? '' : 's'}
                </span>
              </button>
              {open && (
                <div style={{ padding: '0 16px 16px' }}>
                  <div style={{ marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {g.items.map((item) => (
                      <div key={item.id} style={{ ...MONO, fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                        {item.action.padEnd(8, ' ')} {item.objectLabel}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {pendingCount > 0 && (
          <div style={{ padding: '16px' }}>{diffMode === 'unified' ? renderUnifiedDiff() : renderSplitDiff()}</div>
        )}
      </div>

      <div style={{ border: '1px solid var(--color-divider)', marginBottom: '8px' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-divider)', fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: '15px' }}>
          Pre-flight validation
        </div>
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {!preflight ? (
            <span style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
              Run a deploy to see pre-flight results.
            </span>
          ) : (
            <>
              <div style={{ fontSize: '10px', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>
                named-checkconf · per server
              </div>
              {preflight.checkconf.map((c) => {
                const meta = PREFLIGHT_RESULT_META[c.result] ?? PREFLIGHT_RESULT_META.OK;
                return (
                  <div key={c.serverId ?? c.detail} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0', borderBottom: '1px solid color-mix(in srgb, var(--color-text) 6%, transparent)' }}>
                    {meta.icon(meta.color)}
                    <span style={{ ...MONO, fontSize: '13px', width: '140px', flex: 'none' }}>{c.serverId ?? '—'}</span>
                    <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{c.detail}</span>
                  </div>
                );
              })}
              <div style={{ fontSize: '10px', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginTop: '6px' }}>
                named-checkzone · per changed zone
              </div>
              {preflight.checkzone.map((z) => {
                const meta = PREFLIGHT_RESULT_META[z.result] ?? PREFLIGHT_RESULT_META.OK;
                return (
                  <div key={z.zoneName ?? z.zoneId ?? z.detail} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '6px 0', borderBottom: '1px solid color-mix(in srgb, var(--color-text) 6%, transparent)' }}>
                    {meta.icon(meta.color)}
                    <span style={{ ...MONO, fontSize: '13px', width: '140px', flex: 'none' }}>{z.zoneName ?? z.zoneId ?? '—'}</span>
                    <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{z.detail}</span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      <div style={{ border: '1px solid var(--color-divider)', marginBottom: '8px' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-divider)', fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: '15px' }}>
          Target servers
        </div>
        {servers.map((s) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 16px', borderBottom: '1px solid color-mix(in srgb, var(--color-text) 6%, transparent)' }}>
            <Checkbox
              id={`target-${s.id}`}
              checked={selected.includes(s.id)}
              onChange={() => toggleServer(s.id)}
              disabled={running}
              aria-label={`Target server ${s.id}`}
            />
            <span style={{ ...MONO, fontSize: '13px', fontWeight: 500, width: '140px' }}>{s.id}</span>
            <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{s.hostname ?? s.nodeName ?? ''}</span>
            <div style={{ flex: 1 }} />
            {s.mgmtAddress && <span style={{ ...MONO, fontSize: '11px', color: 'var(--color-text-tertiary)' }}>{s.mgmtAddress}</span>}
          </div>
        ))}
      </div>

      <footer
        style={{
          position: 'sticky',
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          padding: '14px 24px',
          borderTop: '1px solid var(--color-divider)',
          background: 'var(--color-surface)',
        }}
      >
        {hasWarn && (
          <Checkbox
            id="ack-warning"
            checked={warningAck}
            onChange={(e) => setWarningAck(e.target.checked)}
            label="I've reviewed the pre-flight warnings and want to deploy anyway"
            disabled={running}
          />
        )}
        <div style={{ flex: 1 }} />
        {hasWarn && !warningAck && (
          <span style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
            Acknowledge the pre-flight warning to enable deploy.
          </span>
        )}
        <Button variant="primary" disabled={deployDisabled} loading={running} onClick={handleDeploy}>
          {deployLabel}
        </Button>
      </footer>
    </div>
  );
}

export default ReviewDeploy;
