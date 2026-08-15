import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import { Button } from '../Button/Button';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  message: string;
  tone?: 'info' | 'success' | 'warning' | 'error';
  action?: ToastAction;
  duration?: number;
}

export interface ToastItem extends ToastOptions {
  id: string;
}

export interface ToastContextValue {
  push: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    return {
      push: () => '',
      dismiss: () => {},
    };
  }
  return context;
}

export interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (options: ToastOptions): string => {
      const id = 'toast-' + Math.random().toString(36).substring(2, 9);
      const duration = options.duration ?? 5000;

      const item: ToastItem = {
        ...options,
        id,
      };

      setToasts((prev) => [...prev, item]);

      if (duration > 0) {
        setTimeout(() => {
          dismiss(id);
        }, duration);
      }

      return id;
    },
    [dismiss]
  );

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  const toneColorMap: Record<string, { border: string; bg: string; text: string }> = {
    info: {
      border: 'var(--color-divider)',
      bg: 'var(--color-surface)',
      text: 'var(--color-text)',
    },
    success: {
      border: 'var(--state-success)',
      bg: 'var(--state-success-bg)',
      text: 'var(--state-success)',
    },
    warning: {
      border: 'var(--state-drift)',
      bg: 'var(--state-drift-bg)',
      text: 'var(--state-drift)',
    },
    error: {
      border: 'var(--state-error)',
      bg: 'var(--state-error-bg)',
      text: 'var(--state-error)',
    },
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          maxWidth: '400px',
          pointerEvents: 'none',
        }}
      >
        {toasts.map((toast) => {
          const tone = toast.tone || 'info';
          const theme = toneColorMap[tone] || toneColorMap.info;

          return (
            <div
              key={toast.id}
              role="status"
              className="toast blueprint"
              style={{
                pointerEvents: 'auto',
                background: 'var(--color-surface)',
                border: `1px solid ${theme.border}`,
                boxShadow: 'var(--shadow-md)',
                padding: '10px 14px',
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                color: 'var(--color-text)',
                animation: 'toast-enter var(--duration-toast) ease-out',
              }}
            >
              <i className="corner tl" aria-hidden="true" />
              <i className="corner tr" aria-hidden="true" />
              <i className="corner bl" aria-hidden="true" />
              <i className="corner br" aria-hidden="true" />

              <span style={{ flex: 1 }}>{toast.message}</span>

              {toast.action && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    toast.action?.onClick();
                    dismiss(toast.id);
                  }}
                  style={{
                    height: '24px',
                    fontSize: '11px',
                    padding: '0 8px',
                  }}
                >
                  {toast.action.label}
                </Button>
              )}

              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss toast"
                className="btn btn-ghost btn-icon"
                style={{
                  width: '20px',
                  height: '20px',
                  padding: 0,
                  opacity: 0.6,
                }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export default ToastProvider;
