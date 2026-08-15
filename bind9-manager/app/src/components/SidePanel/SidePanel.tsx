import React, { useEffect, useId, useRef } from 'react';

export interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  width?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function SidePanel({
  open,
  onClose,
  title,
  width = '440px',
  children,
  actions,
  className = '',
  style,
}: SidePanelProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previousActiveElementRef.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    if (panel) {
      const focusableSelector =
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const focusables = panel.querySelectorAll<HTMLElement>(focusableSelector);
      if (focusables.length > 0) {
        const autoFocusEl = panel.querySelector<HTMLElement>('[autofocus]');
        if (autoFocusEl) {
          autoFocusEl.focus();
        } else {
          // Focus the first focusable element inside the panel
          focusables[0].focus();
        }
      } else {
        panel.focus();
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        const currentPanel = panelRef.current;
        if (!currentPanel) return;

        const focusableSelector =
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const focusables = Array.from(
          currentPanel.querySelectorAll<HTMLElement>(focusableSelector)
        );

        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const current = document.activeElement;

        if (e.shiftKey) {
          if (current === first || !currentPanel.contains(current)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (current === last || !currentPanel.contains(current)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (
        previousActiveElementRef.current &&
        document.body.contains(previousActiveElementRef.current)
      ) {
        previousActiveElementRef.current.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'color-mix(in srgb, var(--color-neutral-900) 45%, transparent)',
          zIndex: 40,
        }}
        onClick={handleBackdropClick}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`side-panel ${className}`.trim()}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width,
          background: 'var(--color-bg)',
          borderLeft: '1px solid var(--color-divider)',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 41,
          display: 'flex',
          flexDirection: 'column',
          transition: 'transform var(--duration-panel) var(--ease-panel)',
          ...style,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--color-divider)',
          }}
        >
          <h3
            id={titleId}
            style={{
              margin: 0,
              fontSize: '18px',
              fontFamily: 'var(--font-heading)',
              fontWeight: 600,
            }}
          >
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="btn btn-ghost btn-icon"
            style={{ width: '32px', height: '32px' }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          {children}
        </div>

        {actions && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '8px',
              padding: '16px 20px',
              borderTop: '1px solid var(--color-divider)',
            }}
          >
            {actions}
          </div>
        )}
      </div>
    </>
  );
}

export default SidePanel;
