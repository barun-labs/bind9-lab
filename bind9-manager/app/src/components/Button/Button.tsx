import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  icon?: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children?: React.ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  iconOnly = false,
  icon,
  disabled = false,
  loading = false,
  onClick,
  children,
  className = '',
  style,
  type = 'button',
  ...rest
}: ButtonProps) {
  const isPrimary = variant === 'primary';
  const isSecondary = variant === 'secondary';
  const isDestructive = variant === 'destructive';
  const isGhost = variant === 'ghost';

  const hasCorners = isPrimary || isSecondary || isDestructive;

  let variantClass = 'btn-secondary blueprint';
  if (isPrimary) {
    variantClass = 'btn-primary blueprint';
  } else if (isGhost) {
    variantClass = 'btn-ghost';
  } else if (isDestructive) {
    variantClass = 'btn-secondary blueprint';
  }

  const iconOnlyClass = iconOnly ? 'btn-icon' : '';

  const sizeStyle: React.CSSProperties =
    size === 'sm'
      ? {
          height: '28px',
          padding: iconOnly ? '0' : '0 10px',
          fontSize: '12px',
        }
      : {
          height: '32px',
          padding: iconOnly ? '0' : undefined,
        };

  const destructiveStyle: React.CSSProperties = isDestructive
    ? {
        borderColor: 'var(--state-error)',
        color: 'var(--state-error)',
      }
    : {};

  const spinner = (
    <svg
      width={size === 'sm' ? 12 : 14}
      height={size === 'sm' ? 12 : 14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ animation: 'button-spin 1s linear infinite' }}
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );

  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={`btn ${variantClass} ${iconOnlyClass} ${className}`.trim()}
      style={{
        ...sizeStyle,
        ...destructiveStyle,
        ...style,
      }}
      {...rest}
    >
      <style>
        {`@keyframes button-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}
      </style>
      {hasCorners && (
        <>
          <i className="corner tl" aria-hidden="true" />
          <i className="corner tr" aria-hidden="true" />
          <i className="corner bl" aria-hidden="true" />
          <i className="corner br" aria-hidden="true" />
        </>
      )}
      {loading ? spinner : icon}
      {children}
    </button>
  );
}
