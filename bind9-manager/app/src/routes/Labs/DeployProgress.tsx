import { useState, useEffect, useRef } from 'react';
import type { DeployJob } from '../../types/entities';
import { useApi } from '../../data/store';
import { StatusPill } from '../../components/StatusPill/StatusPill';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';
import { CodeBlock } from '../../components/CodeBlock/CodeBlock';

export interface DeployProgressProps {
  jobId: string;
  onComplete?: (job: DeployJob) => void;
  pollIntervalMs?: number;
}

export function DeployProgress({ jobId, onComplete, pollIntervalMs = 1500 }: DeployProgressProps) {
  const api = useApi();
  const [job, setJob] = useState<DeployJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(false);
  const onCompleteCalledRef = useRef<boolean>(false);

  // Check prefers-reduced-motion
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    if (mql.addEventListener) {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    } else if (mql.addListener) {
      mql.addListener(onChange);
      return () => mql.removeListener(onChange);
    }
  }, []);

  // Reset completion ref if jobId changes
  useEffect(() => {
    onCompleteCalledRef.current = false;
  }, [jobId]);

  // Polling logic
  useEffect(() => {
    let active = true;
    let timer: any = null;

    const fetchJob = async () => {
      try {
        const data = await api.getDeployJob(jobId);
        if (!active) return;
        if (!data) {
          setError(`Deploy job ${jobId} not found`);
          return;
        }
        setJob(data);

        if (data.status === 'SUCCEEDED' || data.status === 'FAILED') {
          if (!onCompleteCalledRef.current) {
            onCompleteCalledRef.current = true;
            onComplete?.(data);
          }
        } else {
          // Continue polling if QUEUED or RUNNING
          timer = setTimeout(fetchJob, pollIntervalMs);
        }
      } catch (err: any) {
        if (!active) return;
        setError(err?.message || 'Failed to check deploy job status');
      }
    };

    fetchJob();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [api, jobId, onComplete, pollIntervalMs]);

  const statusStateMap: Record<string, string> = {
    QUEUED: 'pending',
    RUNNING: 'deploying',
    SUCCEEDED: 'synced',
    FAILED: 'error',
  };

  const currentStatus = job?.status || 'QUEUED';
  const pillState = statusStateMap[currentStatus] || 'pending';
  const isFinished = currentStatus === 'SUCCEEDED' || currentStatus === 'FAILED';
  const isRunning = currentStatus === 'RUNNING' || currentStatus === 'QUEUED';

  // Gather server list
  const validatedServers = job?.result?.validated || [];
  const deployedServers = job?.result?.deployed || [];

  // Combine unique server IDs
  const allServerIds = Array.from(
    new Set([
      ...validatedServers.map((s) => s.serverId),
      ...deployedServers.map((s) => s.serverId),
    ])
  );

  return (
    <div
      style={{
        padding: '16px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-divider)',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Deployment Progress</h3>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                color: 'var(--color-text-secondary)',
              }}
            >
              ({jobId})
            </span>
          </div>
          <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
            {isRunning
              ? 'Executing containerlab deployment, IP configuration, named.conf push, and verification…'
              : currentStatus === 'SUCCEEDED'
              ? 'Deployment completed successfully.'
              : 'Deployment failed.'}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isRunning && !prefersReducedMotion && (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--state-deploying)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ animation: 'deploy-spin 1s linear infinite' }}
              aria-hidden="true"
            >
              <style>
                {`@keyframes deploy-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}
              </style>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          )}
          <StatusPill state={pillState} label={currentStatus} />
        </div>
      </div>

      {error && <InlineAlert tone="error">{error}</InlineAlert>}

      {(job?.error || job?.result?.aborted) && (
        <InlineAlert tone="error">
          <div style={{ fontWeight: 600, marginBottom: '2px' }}>Deployment Error:</div>
          <div>{job.error || job.result?.aborted}</div>
        </InlineAlert>
      )}

      {/* Per-server Results */}
      {allServerIds.length > 0 && (
        <div>
          <div
            style={{
              fontSize: '13px',
              fontWeight: 600,
              marginBottom: '8px',
              color: 'var(--color-text)',
            }}
          >
            Server Deployment & Verification:
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {allServerIds.map((serverId) => {
              const val = validatedServers.find((s) => s.serverId === serverId);
              const dep = deployedServers.find((s) => s.serverId === serverId);

              const serverOk = dep ? dep.ok : val ? val.ok : true;
              const serverLabel = dep
                ? dep.ok
                  ? 'SUCCEEDED'
                  : 'FAILED'
                : val
                ? val.ok
                  ? 'VALIDATED'
                  : 'FAILED'
                : currentStatus;

              const serverState = serverOk ? (isFinished ? 'synced' : 'deploying') : 'error';

              return (
                <div
                  key={serverId}
                  style={{
                    padding: '12px',
                    border: '1px solid var(--color-divider)',
                    background: 'var(--color-bg)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '8px',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '13px',
                        fontWeight: 600,
                      }}
                    >
                      {serverId}
                    </span>
                    <StatusPill state={serverState} label={serverLabel} />
                  </div>

                  {val && !val.ok && val.errors && val.errors.length > 0 && (
                    <InlineAlert tone="error" style={{ margin: '4px 0' }}>
                      <ul style={{ margin: 0, paddingLeft: '16px' }}>
                        {val.errors.map((e, idx) => (
                          <li key={idx}>{e}</li>
                        ))}
                      </ul>
                    </InlineAlert>
                  )}

                  {dep && dep.output && (
                    <div>
                      <div
                        style={{
                          fontSize: '11px',
                          color: 'var(--color-text-secondary)',
                          marginBottom: '4px',
                          fontWeight: 500,
                        }}
                      >
                        Verification Output:
                      </div>
                      <CodeBlock code={dep.output} language="bash" copyable />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {currentStatus === 'SUCCEEDED' && (
        <InlineAlert tone="info">
          Lab deployed and verified. All BIND DNS instances are active and answering queries.
        </InlineAlert>
      )}
    </div>
  );
}

export default DeployProgress;
