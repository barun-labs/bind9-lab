import React from 'react';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  mono?: boolean;
  error?: string;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}

export function Textarea({
  value,
  onChange,
  mono = false,
  error,
  placeholder,
  rows = 3,
  disabled = false,
  className = '',
  style,
  ...rest
}: TextareaProps) {
  return (
    <textarea
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
      disabled={disabled}
      aria-invalid={!!error}
      className={`input ${className}`.trim()}
      style={{
        fontFamily: mono ? 'var(--font-mono)' : undefined,
        borderColor: error ? 'var(--state-error)' : undefined,
        cursor: disabled ? 'not-allowed' : undefined,
        opacity: disabled ? 0.5 : undefined,
        ...style,
      }}
      {...rest}
    />
  );
}
