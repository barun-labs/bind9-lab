import React from 'react';
import { CopyButton } from '../CopyButton/CopyButton';

export interface CodeBlockProps {
  code: string;
  language?: string;
  lineNumbers?: boolean;
  copyable?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function CodeBlock({
  code,
  language,
  lineNumbers = false,
  copyable = false,
  className = '',
  style,
}: CodeBlockProps) {
  const lines = code.split('\n');

  return (
    <div
      className={`code-block ${className}`.trim()}
      style={{
        position: 'relative',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-divider)',
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
        borderRadius: 0,
        overflow: 'auto',
        ...style,
      }}
    >
      {copyable && (
        <div
          style={{
            position: 'absolute',
            top: '6px',
            right: '6px',
            zIndex: 2,
          }}
        >
          <CopyButton value={code} />
        </div>
      )}
      <pre
        data-language={language}
        style={{
          margin: 0,
          padding: '10px 12px',
          overflowX: 'auto',
          lineHeight: 1.5,
          color: 'var(--color-text-code)',
          fontFamily: 'inherit',
          fontSize: 'inherit',
        }}
      >
        {lineNumbers ? (
          <div style={{ display: 'table', width: '100%' }}>
            {lines.map((line, idx) => (
              <div key={idx} style={{ display: 'table-row' }}>
                <span
                  style={{
                    display: 'table-cell',
                    textAlign: 'right',
                    paddingRight: '12px',
                    userSelect: 'none',
                    color: 'color-mix(in srgb, var(--color-text) 40%, transparent)',
                    width: '1%',
                    whiteSpace: 'nowrap',
                  }}
                  aria-hidden="true"
                >
                  {idx + 1}
                </span>
                <span
                  style={{
                    display: 'table-cell',
                    whiteSpace: 'pre',
                    wordBreak: 'normal',
                  }}
                >
                  {line || '\n'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <code style={{ fontFamily: 'inherit', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {code}
          </code>
        )}
      </pre>
    </div>
  );
}
