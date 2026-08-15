import React, { useState, useId } from 'react';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  placement?: TooltipPlacement;
  className?: string;
  style?: React.CSSProperties;
}

export function Tooltip({
  content,
  children,
  placement = 'top',
  className = '',
  style,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const tooltipId = useId();

  if (!content) {
    return <>{children}</>;
  }

  const placementStyles: Record<TooltipPlacement, React.CSSProperties> = {
    top: {
      bottom: '100%',
      left: '50%',
      transform: 'translateX(-50%)',
      marginBottom: '6px',
    },
    bottom: {
      top: '100%',
      left: '50%',
      transform: 'translateX(-50%)',
      marginTop: '6px',
    },
    left: {
      right: '100%',
      top: '50%',
      transform: 'translateY(-50%)',
      marginRight: '6px',
    },
    right: {
      left: '100%',
      top: '50%',
      transform: 'translateY(-50%)',
      marginLeft: '6px',
    },
  };

  return (
    <span
      className={`tooltip-wrapper ${className}`.trim()}
      style={{ position: 'relative', display: 'inline-flex', ...style }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
      aria-describedby={visible ? tooltipId : undefined}
    >
      {children}
      {visible && (
        <span
          id={tooltipId}
          role="tooltip"
          style={{
            position: 'absolute',
            zIndex: 50,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            background: 'var(--color-neutral-900)',
            color: 'var(--color-text-inverse)',
            padding: '4px 8px',
            fontSize: '11px',
            lineHeight: 1.3,
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-md)',
            ...placementStyles[placement],
          }}
        >
          {content}
        </span>
      )}
    </span>
  );
}
