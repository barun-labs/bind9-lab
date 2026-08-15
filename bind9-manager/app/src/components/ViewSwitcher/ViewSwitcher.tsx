import { useState, useRef, useEffect } from 'react';
import type { View } from '../../types/entities';

export interface ViewSwitcherProps {
  views: View[];
  activeId?: string;
  onSelect?: (id: string) => void;
}

export function ViewSwitcher({ views, activeId, onSelect }: ViewSwitcherProps) {
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

  const currentView = views.find((v) => v.id === activeId || v.name === activeId) ?? views[0];
  const viewDisplayName = currentView?.name ?? activeId ?? 'internal';

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="blueprint"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '7px 12px',
          border: '1px solid var(--color-accent)',
          background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
          color: 'var(--color-accent-800)',
          fontFamily: 'var(--font-heading)',
          fontWeight: 600,
          fontSize: '14px',
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
            background: 'var(--color-accent)',
            flex: 'none',
          }}
        />
        <span style={{ textTransform: 'uppercase', letterSpacing: '0.02em' }}>
          {viewDisplayName}
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
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '44px',
            left: 0,
            width: '180px',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-divider)',
            boxShadow: 'var(--shadow-md)',
            zIndex: 30,
            padding: '4px',
          }}
        >
          {views.map((v) => {
            const isSelected = v.id === activeId || v.name === activeId || v.id === currentView?.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  onSelect?.(v.id);
                  setOpen(false);
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 10px',
                  border: 0,
                  background: isSelected
                    ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)'
                    : 'transparent',
                  cursor: 'pointer',
                  fontSize: '13px',
                  color: 'var(--color-text)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: isSelected ? 'var(--color-accent)' : 'var(--color-neutral-400)',
                    flex: 'none',
                  }}
                />
                {v.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
