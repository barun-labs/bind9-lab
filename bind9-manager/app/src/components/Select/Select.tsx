import React from 'react';

export interface SelectOption {
  label: string;
  value: string | number;
  disabled?: boolean;
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  value?: string | number;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: SelectOption[];
  disabled?: boolean;
  mono?: boolean;
  error?: string;
  placeholder?: string;
}

export function Select({
  value,
  onChange,
  options = [],
  disabled = false,
  mono = false,
  error,
  placeholder,
  className = '',
  style,
  children,
  ...rest
}: SelectProps) {
  return (
    <select
      value={value}
      onChange={onChange}
      disabled={disabled}
      aria-invalid={!!error}
      className={`input ${className}`.trim()}
      style={{
        fontFamily: mono ? 'var(--font-mono)' : undefined,
        borderColor: error ? 'var(--state-error)' : undefined,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : undefined,
        ...style,
      }}
      {...rest}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((opt) => (
        <option key={String(opt.value)} value={opt.value} disabled={opt.disabled}>
          {opt.label}
        </option>
      ))}
      {children}
    </select>
  );
}
