import { useId, type ReactNode } from 'react';

export type InheritanceMode = 'INHERIT' | 'OVERRIDE' | 'DISABLE';

export interface InheritanceControlProps {
  label: string;
  mode: InheritanceMode;
  inheritedDisplay: ReactNode;
  children?: ReactNode;
  onInherit: () => void;
  onOverride: () => void;
  onDisable: () => void;
}

const SEGMENTS: { mode: InheritanceMode; text: string }[] = [
  { mode: 'INHERIT', text: 'Inherit' },
  { mode: 'OVERRIDE', text: 'Override' },
  { mode: 'DISABLE', text: 'Disable' },
];

// Presentational three-state toggle for one option/role row. The caller owns
// the data and every API call; this component only renders the current mode
// and calls back when the user picks a different one.
export function InheritanceControl({
  label,
  mode,
  inheritedDisplay,
  children,
  onInherit,
  onOverride,
  onDisable,
}: InheritanceControlProps) {
  const groupName = useId();
  const handlers: Record<InheritanceMode, () => void> = {
    INHERIT: onInherit,
    OVERRIDE: onOverride,
    DISABLE: onDisable,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', minWidth: '160px' }}>{label}</span>
        <div className="seg" role="radiogroup" aria-label={`${label} mode`}>
          {SEGMENTS.map((seg) => (
            <label key={seg.mode} className="seg-opt">
              <input
                type="radio"
                name={groupName}
                checked={mode === seg.mode}
                onChange={() => {
                  if (mode !== seg.mode) handlers[seg.mode]();
                }}
              />
              {seg.text}
            </label>
          ))}
        </div>
      </div>

      {mode === 'INHERIT' && (
        <div
          style={{
            fontSize: '12px',
            color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
            paddingLeft: '4px',
          }}
        >
          Inherited from view: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text)' }}>{inheritedDisplay}</span>
        </div>
      )}

      {mode === 'OVERRIDE' && <div style={{ paddingLeft: '4px' }}>{children}</div>}

      {mode === 'DISABLE' && (
        <div style={{ fontSize: '12px', color: 'var(--state-error)', paddingLeft: '4px' }}>
          Disabled — clause omitted from generated config.
        </div>
      )}
    </div>
  );
}

export default InheritanceControl;
