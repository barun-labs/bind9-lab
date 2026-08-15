
export interface PlaceholderProps {
  title: string;
  description?: string;
}

export function Placeholder({ title, description }: PlaceholderProps) {
  return (
    <div
      style={{
        flex: 1,
        padding: '24px',
        maxWidth: 'var(--chrome-max-content-w, 1040px)',
        overflowY: 'auto',
      }}
    >
      <div style={{ marginBottom: '20px' }}>
        <h1
          style={{
            margin: '0 0 6px',
            fontSize: '24px',
            fontFamily: 'var(--font-heading)',
            fontWeight: 600,
            color: 'var(--color-text)',
          }}
        >
          {title}
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: '13px',
            color: 'color-mix(in srgb, var(--color-text) 60%, transparent)',
            maxWidth: '60ch',
          }}
        >
          {description ?? 'This section is part of the planned scope and will be available in a subsequent update.'}
        </p>
      </div>
      <div
        style={{
          border: '1px dashed var(--color-divider)',
          borderRadius: 'var(--radius-sm, 2px)',
          padding: '32px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          color: 'var(--color-neutral-600)',
          background: 'color-mix(in srgb, var(--color-surface) 30%, transparent)',
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: 500 }}>
          {title} placeholder
        </span>
        <span style={{ fontSize: '11px', opacity: 0.7, fontFamily: 'var(--font-mono)' }}>
          Route ready
        </span>
      </div>
    </div>
  );
}
