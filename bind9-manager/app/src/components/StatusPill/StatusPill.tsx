import React from 'react';

export type StatusPillState =
  | 'synced'
  | 'pending'
  | 'deploying'
  | 'drift'
  | 'error'
  | 'disabled'
  | 'SYNCED'
  | 'PENDING'
  | 'DEPLOYING'
  | 'DRIFT'
  | 'ERROR'
  | 'DISABLED'
  | 'NODE_ABSENT'
  | 'UNREACHABLE'
  | string;

export interface StatusPillProps {
  state: StatusPillState;
  label: string;
  issue?: string | null;
  className?: string;
  style?: React.CSSProperties;
}

const stateColorMap: Record<string, string> = {
  synced: 'var(--state-synced)',
  pending: 'var(--state-pending)',
  deploying: 'var(--state-deploying)',
  drift: 'var(--state-drift)',
  error: 'var(--state-error)',
  disabled: 'var(--state-disabled)',
  node_absent: 'var(--state-disabled)',
  unreachable: 'var(--state-error)',
};

export function StatusPill({
  state,
  label,
  issue,
  className = '',
  style,
}: StatusPillProps) {
  const normState = state.toLowerCase().replace(/_/g, '-');
  const rawKey = state.toLowerCase();
  const color = stateColorMap[rawKey] || 'var(--color-neutral-600)';

  return (
    <span
      role="img"
      aria-label={label}
      className={`status-pill status-pill-${normState} ${className}`.trim()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '12px',
        color,
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: color,
          flex: 'none',
        }}
      />
      <span>{label}</span>
      {issue && (
        <span
          title={issue}
          style={{
            display: 'inline-flex',
            marginLeft: '6px',
            color: 'var(--state-drift)',
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3l9.5 17H2.5L12 3z" />
            <path d="M12 10v4" />
            <circle cx="12" cy="17" r=".6" fill="currentColor" stroke="none" />
          </svg>
        </span>
      )}
    </span>
  );
}
