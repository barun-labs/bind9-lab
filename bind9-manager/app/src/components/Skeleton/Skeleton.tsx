import React from 'react';

export type SkeletonVariant = 'table' | 'card' | 'line';

export interface SkeletonProps {
  rows?: number;
  variant?: SkeletonVariant;
  className?: string;
  style?: React.CSSProperties;
}

export function Skeleton({
  rows = 1,
  variant = 'line',
  className = '',
  style,
}: SkeletonProps) {
  const barStyle: React.CSSProperties = {
    background: 'color-mix(in srgb, var(--color-text) 8%, transparent)',
    borderRadius: 'var(--radius-sm)',
    animation: 'skeleton-pulse 1.5s ease-in-out infinite',
  };

  const count = rows > 0 ? rows : 1;

  if (variant === 'table') {
    return (
      <div
        className={`skeleton skeleton-table ${className}`.trim()}
        style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', ...style }}
        aria-busy="true"
        aria-live="polite"
      >
        <style>
          {`@keyframes skeleton-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.85; } }`}
        </style>
        {Array.from({ length: count }).map((_, idx) => (
          <div
            key={idx}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '8px 12px',
              borderBottom: '1px solid var(--color-divider)',
            }}
          >
            <div style={{ ...barStyle, width: '16px', height: '16px' }} />
            <div style={{ ...barStyle, width: '120px', height: '14px' }} />
            <div style={{ ...barStyle, width: '60px', height: '14px' }} />
            <div style={{ ...barStyle, width: '40px', height: '14px' }} />
            <div style={{ ...barStyle, flex: 1, height: '14px' }} />
            <div style={{ ...barStyle, width: '80px', height: '14px' }} />
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <div
        className={`card skeleton skeleton-card ${className}`.trim()}
        style={{
          border: '1px solid var(--color-divider)',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          ...style,
        }}
        aria-busy="true"
        aria-live="polite"
      >
        <style>
          {`@keyframes skeleton-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.85; } }`}
        </style>
        <div style={{ ...barStyle, width: '35%', height: '18px' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ ...barStyle, width: '100%', height: '14px' }} />
          <div style={{ ...barStyle, width: '85%', height: '14px' }} />
        </div>
      </div>
    );
  }

  // line variant
  return (
    <div
      className={`skeleton skeleton-line ${className}`.trim()}
      style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', ...style }}
      aria-busy="true"
      aria-live="polite"
    >
      <style>
        {`@keyframes skeleton-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.85; } }`}
      </style>
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          style={{
            ...barStyle,
            width: idx === count - 1 && count > 1 ? '70%' : '100%',
            height: '14px',
          }}
        />
      ))}
    </div>
  );
}
