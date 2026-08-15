import React from 'react';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  value?: string | number;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  mono?: boolean;
  error?: string;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}

export function Input({
  value,
  onChange,
  mono = false,
  error,
  placeholder,
  type = 'text',
  disabled = false,
  className = '',
  style,
  ...rest
}: InputProps) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
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
