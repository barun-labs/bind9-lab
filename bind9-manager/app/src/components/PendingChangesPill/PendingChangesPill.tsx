import type { MouseEvent } from 'react';

export interface PendingChangesPillProps {
  count?: number;
  href?: string;
  onClick?: (e: MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => void;
}

export function PendingChangesPill({
  count = 0,
  href = '#',
  onClick,
}: PendingChangesPillProps) {
  if (count > 0) {
    return (
      <a
        href={href}
        onClick={onClick}
        className="blueprint"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '7px 14px',
          border: '1px solid var(--state-pending)',
          background: 'var(--state-pending-bg)',
          color: 'var(--state-pending)',
          fontFamily: 'var(--font-heading)',
          fontWeight: 600,
          fontSize: '14px',
          textDecoration: 'none',
          cursor: 'pointer',
        }}
      >
        <i className="corner tl" aria-hidden="true" />
        <i className="corner tr" aria-hidden="true" />
        <i className="corner bl" aria-hidden="true" />
        <i className="corner br" aria-hidden="true" />
        <span
          style={{
            width: '7px',
            height: '7px',
            borderRadius: '50%',
            background: 'var(--state-pending)',
            flex: 'none',
          }}
        />
        <span style={{ whiteSpace: 'nowrap' }}>
          {count} pending {count === 1 ? 'change' : 'changes'}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      </a>
    );
  }

  return (
    <a
      href={href}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '7px 14px',
        border: '1px solid var(--color-divider)',
        background: 'transparent',
        color: 'var(--color-neutral-600)',
        fontFamily: 'var(--font-heading)',
        fontWeight: 600,
        fontSize: '14px',
        textDecoration: 'none',
        opacity: 0.7,
        cursor: 'pointer',
      }}
    >
      <span
        style={{
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          background: 'var(--color-neutral-400)',
          flex: 'none',
        }}
      />
      <span style={{ whiteSpace: 'nowrap' }}>0 pending changes</span>
    </a>
  );
}
