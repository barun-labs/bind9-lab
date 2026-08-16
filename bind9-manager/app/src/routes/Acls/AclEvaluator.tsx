import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import type { Acl, AclEvalResult } from '../../types/entities';
import { useApi } from '../../data/store';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { Select } from '../../components/Select/Select';
import { StatusPill } from '../../components/StatusPill/StatusPill';

export function AclEvaluator() {
  const { configId = 'dns-lab' } = useParams();
  const api = useApi();

  const [acls, setAcls] = useState<Acl[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [target, setTarget] = useState<string>('');
  const [clientIp, setClientIp] = useState<string>('');
  const [running, setRunning] = useState<boolean>(false);
  const [result, setResult] = useState<AclEvalResult | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const list = await api.listAcls(configId);
        if (!cancelled) {
          setAcls(list);
          if (list.length > 0 && !target) {
            setTarget(list[0].name);
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          setLoadError(err?.message || 'Failed to load ACLs');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, configId]);

  const aclOptions = useMemo(
    () => acls.map((a) => ({ label: a.name, value: a.name })),
    [acls]
  );

  const handleEvaluate = useCallback(async () => {
    const trimmedTarget = target.trim();
    const trimmedIp = clientIp.trim();
    if (!trimmedTarget || !trimmedIp || running) return;

    setRunning(true);
    setEvalError(null);
    setResult(null);
    try {
      const res = await api.evaluateAcl(configId, { target: trimmedTarget, clientIp: trimmedIp });
      setResult(res);
    } catch (err: any) {
      setEvalError(err?.message || 'Evaluation failed');
    } finally {
      setRunning(false);
    }
  }, [api, configId, target, clientIp, running]);

  const canEvaluate = !loading && acls.length > 0 && !running && !!target && !!clientIp.trim();

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
          ACL Evaluator
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: '13px',
            color: 'var(--color-text-secondary)',
          }}
        >
          Test client IP evaluation against access control chains.
        </p>
      </div>

      {loadError && (
        <InlineAlert tone="error" style={{ marginBottom: '16px' }}>
          {loadError}
        </InlineAlert>
      )}

      {!loading && acls.length === 0 && !loadError ? (
        <InlineAlert tone="info">No ACLs defined in this configuration.</InlineAlert>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleEvaluate();
          }}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            alignItems: 'flex-end',
            marginBottom: '16px',
          }}
        >
          <div className="field" style={{ minWidth: '220px' }}>
            <label htmlFor="eval-target">Target</label>
            <Select
              id="eval-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              options={aclOptions}
              disabled={loading || running}
            />
          </div>
          <div className="field" style={{ flex: '1 1 200px' }}>
            <label htmlFor="eval-ip">Client IP</label>
            <Input
              id="eval-ip"
              placeholder="e.g. 10.70.0.11"
              value={clientIp}
              onChange={(e) => setClientIp(e.target.value)}
              disabled={running}
              mono
            />
          </div>
          <div className="field">
            <Button
              variant="primary"
              type="submit"
              disabled={!canEvaluate}
              loading={running}
            >
              Evaluate
            </Button>
          </div>
        </form>
      )}

      {evalError && (
        <InlineAlert tone="error" style={{ marginBottom: '16px' }}>
          {evalError}
        </InlineAlert>
      )}

      {result && (
        <div
          style={{
            border: '1px solid var(--color-divider)',
            background: 'var(--color-surface)',
            padding: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <span
              style={{
                fontSize: '12px',
                color: 'var(--color-text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '.06em',
              }}
            >
              Decision
            </span>
            <StatusPill
              state={result.decision === 'ALLOW' ? 'synced' : 'error'}
              label={result.decision}
            />
          </div>

          {result.trace.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr>
                  {['Type', 'Value', 'Negated', 'Matched'].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left',
                        fontSize: '11px',
                        letterSpacing: '.06em',
                        textTransform: 'uppercase',
                        color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
                        padding: '8px',
                        borderBottom: '1px solid var(--color-divider)',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.trace.map((step, i) => (
                  <tr key={step.entryId || i}>
                    <td style={{ padding: '8px', borderBottom: '1px solid var(--color-divider)' }}>
                      {step.type}
                    </td>
                    <td
                      style={{
                        padding: '8px',
                        borderBottom: '1px solid var(--color-divider)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {step.value ?? '—'}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid var(--color-divider)' }}>
                      {step.negated ? 'Yes' : 'No'}
                    </td>
                    <td style={{ padding: '8px', borderBottom: '1px solid var(--color-divider)' }}>
                      {step.matched ? 'Yes' : 'No'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export default AclEvaluator;
