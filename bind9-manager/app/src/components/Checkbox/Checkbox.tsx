import React, { useEffect, useRef } from 'react';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  checked?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  indeterminate?: boolean;
  label?: React.ReactNode;
  disabled?: boolean;
}

export function Checkbox({
  checked = false,
  onChange,
  indeterminate = false,
  label,
  disabled = false,
  id,
  name,
  className = '',
  style,
  'aria-label': ariaLabel,
  ...rest
}: CheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = !!indeterminate;
    }
  }, [indeterminate]);

  const inputElement = (
    <input
      ref={inputRef}
      type="checkbox"
      id={id}
      name={name}
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      className={className}
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        accentColor: 'var(--color-accent)',
        ...style,
      }}
      aria-label={ariaLabel || (typeof label === 'string' ? label : undefined)}
      {...rest}
    />
  );

  if (!label) {
    return inputElement;
  }

  return (
    <label
      htmlFor={id}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: '13px',
        color: disabled ? 'var(--color-text-secondary)' : 'var(--color-text)',
        userSelect: 'none',
      }}
    >
      {inputElement}
      <span>{label}</span>
    </label>
  );
}
