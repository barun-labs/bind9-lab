import React from 'react';

export type InlineAlertTone = 'info' | 'warn' | 'error';

export interface InlineAlertProps {
  tone: InlineAlertTone;
  children: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const toneStyles: Record<
  InlineAlertTone,
  { border: string; background: string; color: string; defaultIcon: React.ReactNode }
> = {
  warn: {
    border: '1px solid var(--state-drift)',
    background: 'var(--state-drift-bg)',
    color: 'var(--state-drift)',
    defaultIcon: (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flex: 'none', marginTop: '1px' }}
        aria-hidden="true"
      >
        <path d="M12 3l9.5 17H2.5L12 3z" />
        <path d="M12 10v4" />
        <circle cx="12" cy="17" r=".6" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  error: {
    border: '1px solid var(--state-error)',
    background: 'var(--state-error-bg)',
    color: 'var(--state-error)',
    defaultIcon: (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flex: 'none', marginTop: '1px' }}
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ),
  },
  info: {
    border: '1px solid var(--color-accent)',
    background: 'var(--color-accent-100)',
    color: 'var(--color-accent-800)',
    defaultIcon: (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flex: 'none', marginTop: '1px' }}
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    ),
  },
};

export function InlineAlert({
  tone,
  children,
  icon,
  className = '',
  style,
}: InlineAlertProps) {
  const currentTone = toneStyles[tone] || toneStyles.info;
  const role = tone === 'info' ? 'status' : 'alert';

  return (
    <div
      role={role}
      className={`inline-alert inline-alert-${tone} ${className}`.trim()}
      style={{
        display: 'flex',
        gap: '8px',
        padding: '10px 12px',
        border: currentTone.border,
        background: currentTone.background,
        color: currentTone.color,
        fontSize: '12px',
        lineHeight: 1.4,
        ...style,
      }}
    >
      {icon !== undefined ? icon : currentTone.defaultIcon}
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}
