import { useState, useRef, useEffect } from 'react';
import type { Configuration } from '../../types/entities';

export interface ConfigurationSwitcherProps {
  configs: Configuration[];
  activeId?: string;
  onSelect?: (id: string) => void;
  onManage?: () => void;
}

export function ConfigurationSwitcher({
  configs,
  activeId,
  onSelect,
  onManage,
}: ConfigurationSwitcherProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  const activeConfig = configs.find((c) => c.id === activeId) ?? configs[0];

  const configCounts = activeConfig?.counts
    ? `${activeConfig.counts.views} views · ${activeConfig.counts.zones} zones · ${activeConfig.counts.records} records`
    : '';

  return (
    <div
      ref={containerRef}
      style={{
        height: 'var(--chrome-config-strip-h, 30px)',
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '0 16px',
        background: 'var(--config-strip-bg)',
        color: 'var(--config-strip-fg)',
        fontSize: '12px',
        position: 'relative',
        zIndex: 40,
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
        style={{ opacity: 0.75 }}
        aria-hidden="true"
      >
        <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" />
        <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
        <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
      </svg>
      <span style={{ opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '10px' }}>
        Configuration
      </span>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          border: 0,
          background: 'transparent',
          color: 'var(--config-strip-fg)',
          fontFamily: 'var(--font-heading)',
          fontWeight: 600,
          fontSize: '13px',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <span>{activeConfig?.name ?? activeId ?? 'Select configuration'}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {configCounts && (
        <span style={{ opacity: 0.55, fontFamily: 'var(--font-mono)' }}>{configCounts}</span>
      )}
      <div style={{ flex: 1 }} />
      <button
        type="button"
        onClick={onManage}
        style={{
          border: 0,
          background: 'transparent',
          color: 'var(--config-strip-fg)',
          opacity: 0.7,
          fontSize: '11px',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        Manage configurations
      </button>
      <a
        href="https://github.com/barun-labs/bind9-lab"
        target="_blank"
        rel="noreferrer"
        title="GitHub repository"
        aria-label="GitHub repository"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          color: 'var(--config-strip-fg)',
          opacity: 0.7,
          fontSize: '11px',
          textDecoration: 'none',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.05-.02-2.06-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.49 5.93.43.37.81 1.1.81 2.22 0 1.61-.01 2.9-.01 3.29 0 .32.21.7.82.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
        </svg>
        GitHub
      </a>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'var(--chrome-config-strip-h, 30px)',
            left: '16px',
            width: '260px',
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-divider)',
            boxShadow: 'var(--shadow-md)',
            zIndex: 50,
            padding: '4px',
          }}
        >
          {configs.map((cfg) => {
            const isSelected = cfg.id === activeId || cfg.id === activeConfig?.id;
            const meta = cfg.counts
              ? `${cfg.counts.views} views · ${cfg.counts.zones} zones · ${cfg.counts.records} records`
              : (cfg.description ?? '');
            return (
              <button
                key={cfg.id}
                type="button"
                onClick={() => {
                  onSelect?.(cfg.id);
                  setOpen(false);
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 10px',
                  border: 0,
                  background: isSelected ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'transparent',
                  cursor: 'pointer',
                  fontSize: '12px',
                  color: 'var(--color-text)',
                  display: 'block',
                }}
              >
                <div style={{ fontWeight: 600 }}>{cfg.name}</div>
                {meta && <div style={{ opacity: 0.55, fontSize: '11px' }}>{meta}</div>}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              onManage?.();
              setOpen(false);
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '8px 10px',
              fontSize: '12px',
              border: 0,
              borderTop: '1px solid var(--color-divider)',
              marginTop: '4px',
              background: 'transparent',
              color: 'var(--color-accent)',
              cursor: 'pointer',
            }}
          >
            Manage configurations →
          </button>
        </div>
      )}
    </div>
  );
}
