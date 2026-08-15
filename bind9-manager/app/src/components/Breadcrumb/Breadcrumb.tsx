import { Fragment } from 'react';
import { Link } from 'react-router-dom';

export interface BreadcrumbItem {
  label: string;
  href?: string;
  isMono?: boolean;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <div
      style={{
        height: 'var(--chrome-breadcrumb-h, 34px)',
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '0 20px',
        borderBottom: '1px solid var(--color-divider)',
        fontSize: '12px',
        color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
      }}
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const isMono = item.isMono ?? (item.label.includes('.') || item.label.includes(':'));

        const labelContent = (
          <span
            style={{
              fontFamily: isMono ? 'var(--font-mono)' : undefined,
              color: isLast ? 'var(--color-text)' : 'inherit',
              fontWeight: isLast ? 600 : 400,
            }}
          >
            {item.label}
          </span>
        );

        return (
          <Fragment key={index}>
            {index > 0 && (
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            )}
            {isLast || !item.href ? (
              labelContent
            ) : item.href.startsWith('/') ? (
              <Link to={item.href} style={{ color: 'inherit', textDecoration: 'none' }}>
                {labelContent}
              </Link>
            ) : (
              <a href={item.href} style={{ color: 'inherit', textDecoration: 'none' }}>
                {labelContent}
              </a>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
