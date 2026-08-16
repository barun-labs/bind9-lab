import { useState, type ReactNode } from 'react';
import { ACCENTS, THEME_MODES, type Accent, type ThemeMode } from './theme';
import { useTheme } from './ThemeProvider';

// Swatch fill for each accent — its light-mode main hex, so the color reads the
// same regardless of the current theme.
const ACCENT_SWATCH: Record<Accent, string> = {
  steel: '#5980a6',
  green: '#3c8059',
  violet: '#7156b0',
};

const MODE_LABEL: Record<ThemeMode, string> = { auto: 'Auto', light: 'Light', dark: 'Dark' };
const ACCENT_LABEL: Record<Accent, string> = { steel: 'Steel', green: 'Green', violet: 'Violet' };

export function ThemeSwitcher() {
  const { mode, accent, setMode, setAccent } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: 'relative', flex: 'none' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Theme"
        aria-haspopup="true"
        aria-expanded={open}
        title="Theme"
        style={{
          height: '30px',
          width: '30px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid var(--color-divider)',
          borderRadius: 'var(--radius-md, 4px)',
          background: 'transparent',
          color: 'var(--color-text)',
          cursor: 'pointer',
        }}
      >
        {MODE_ICON[mode]}
      </button>

      {open && (
        <>
          {/* Click-away layer. */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 40 }}
          />
          <div
            role="menu"
            style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              right: 0,
              zIndex: 50,
              width: '208px',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-divider)',
              borderRadius: 'var(--radius-lg, 7px)',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <Field label="Appearance">
              <div
                style={{
                  display: 'flex',
                  border: '1px solid var(--color-divider)',
                  borderRadius: 'var(--radius-md, 4px)',
                  overflow: 'hidden',
                }}
              >
                {THEME_MODES.map((m) => {
                  const active = m === mode;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '5px',
                        padding: '6px 4px',
                        border: 0,
                        borderLeft: m === 'auto' ? 0 : '1px solid var(--color-divider)',
                        background: active
                          ? 'color-mix(in srgb, var(--color-accent) 16%, transparent)'
                          : 'transparent',
                        color: active ? 'var(--color-accent-800)' : 'var(--color-text-secondary)',
                        fontSize: '11px',
                        fontWeight: active ? 600 : 500,
                        cursor: 'pointer',
                      }}
                    >
                      {MODE_ICON[m]}
                      {MODE_LABEL[m]}
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="Accent">
              <div style={{ display: 'flex', gap: '10px' }}>
                {ACCENTS.map((a) => {
                  const active = a === accent;
                  return (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setAccent(a)}
                      aria-label={ACCENT_LABEL[a]}
                      title={ACCENT_LABEL[a]}
                      style={{
                        width: '30px',
                        height: '30px',
                        borderRadius: 'var(--radius-md, 4px)',
                        border: active
                          ? '2px solid var(--color-text)'
                          : '1px solid var(--color-divider)',
                        background: ACCENT_SWATCH[a],
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    />
                  );
                })}
              </div>
            </Field>
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <span
        style={{
          fontSize: '10px',
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--color-text-tertiary)',
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

const iconProps = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const MODE_ICON: Record<ThemeMode, ReactNode> = {
  auto: (
    <svg {...iconProps}>
      <rect x="2" y="3" width="20" height="14" rx="1" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  ),
  light: (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  dark: (
    <svg {...iconProps}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  ),
};
