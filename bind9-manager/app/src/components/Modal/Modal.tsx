import React, { useEffect, useId, useRef } from 'react';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
  preventClose?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  actions,
  preventClose = false,
  className = '',
  style,
}: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previousActiveElementRef.current = document.activeElement as HTMLElement | null;

    const dialog = dialogRef.current;
    if (dialog) {
      const focusableSelector =
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const focusables = dialog.querySelectorAll<HTMLElement>(focusableSelector);
      if (focusables.length > 0) {
        const autoFocusEl = dialog.querySelector<HTMLElement>('[autofocus]');
        if (autoFocusEl) {
          autoFocusEl.focus();
        } else {
          focusables[0].focus();
        }
      } else {
        dialog.focus();
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        if (!preventClose) {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
        return;
      }

      if (e.key === 'Tab') {
        const currentDialog = dialogRef.current;
        if (!currentDialog) return;

        const focusableSelector =
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const focusables = Array.from(currentDialog.querySelectorAll<HTMLElement>(focusableSelector));

        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const current = document.activeElement;

        if (e.shiftKey) {
          if (current === first || !currentDialog.contains(current)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (current === last || !currentDialog.contains(current)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (previousActiveElementRef.current && document.body.contains(previousActiveElementRef.current)) {
        previousActiveElementRef.current.focus();
      }
    };
  }, [open, preventClose, onClose]);

  if (!open) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !preventClose) {
      onClose();
    }
  };

  return (
    <div
      className="dialog-backdrop"
      onClick={handleBackdropClick}
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-4)',
        background: 'color-mix(in srgb, var(--color-neutral-900) 50%, transparent)',
        zIndex: 1000,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`dialog blueprint ${className}`.trim()}
        style={{
          background: 'var(--color-surface)',
          position: 'relative',
          width: 'min(440px, 100%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
          padding: 'var(--space-4)',
          boxShadow: 'var(--shadow-lg)',
          ...style,
        }}
      >
        <i className="corner tl" aria-hidden="true" />
        <i className="corner tr" aria-hidden="true" />
        <i className="corner bl" aria-hidden="true" />
        <i className="corner br" aria-hidden="true" />

        <div id={titleId} className="dialog-title">
          {title}
        </div>

        <div className="dialog-body">{children}</div>

        {actions && <div className="dialog-actions">{actions}</div>}
      </div>
    </div>
  );
}

export default Modal;
