import React from 'react';
import type { RecordType } from '../../types/entities';

export interface RecordTypeChipProps {
  type: RecordType | string;
  className?: string;
  style?: React.CSSProperties;
}

export function RecordTypeChip({
  type,
  className = '',
  style,
}: RecordTypeChipProps) {
  return (
    <span
      className={`tag tag-neutral ${className}`.trim()}
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
        ...style,
      }}
    >
      {type}
    </span>
  );
}
