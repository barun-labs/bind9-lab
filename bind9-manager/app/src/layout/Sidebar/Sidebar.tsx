import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

export interface SidebarProps {
  configId?: string;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}

interface NavItem {
  id: string;
  label: string;
  subpath: string;
  icon: ReactNode;
}

export function Sidebar({
  configId = 'dns-lab',
  expanded: controlledExpanded,
  onToggleExpanded,
}: SidebarProps) {
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(true);
  const location = useLocation();

  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : uncontrolledExpanded;
  const toggleExpanded = onToggleExpanded ?? (() => setUncontrolledExpanded(!uncontrolledExpanded));

  const navItems: NavItem[] = [
    {
      id: 'views',
      label: 'Views',
      subpath: 'views',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }} aria-hidden="true">
          <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" />
          <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
          <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
        </svg>
      ),
    },
    {
      id: 'zones',
      label: 'Zones',
      subpath: 'zones',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }} aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3c2.5 2.7 4 6 4 9s-1.5 6.3-4 9c-2.5-2.7-4-6-4-9s1.5-6.3 4-9z" />
        </svg>
      ),
    },
    {
      id: 'external-hosts',
      label: 'External Hosts',
      subpath: 'external-hosts',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }} aria-hidden="true">
          <path d="M14 5h5v5" />
          <path d="M19 5l-9 9" />
          <path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
        </svg>
      ),
    },
    {
      id: 'blocks',
      label: 'Network Blocks',
      subpath: 'blocks',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }} aria-hidden="true">
          <circle cx="6" cy="6" r="2" />
          <circle cx="6" cy="18" r="2" />
          <circle cx="18" cy="12" r="2" />
          <path d="M6 8v8" />
          <path d="M6 12h8" />
          <path d="M16 12h.01" />
        </svg>
      ),
    },
    {
      id: 'roles',
      label: 'Deployment Roles',
      subpath: 'roles',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }} aria-hidden="true">
          <path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" />
        </svg>
      ),
    },
    {
      id: 'options',
      label: 'Deployment Options',
      subpath: 'options',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }} aria-hidden="true">
          <path d="M4 7h10" />
          <path d="M4 12h16" />
          <path d="M4 17h10" />
          <circle cx="17" cy="7" r="2" />
          <circle cx="8" cy="17" r="2" />
        </svg>
      ),
    },
    {
      id: 'servers',
      label: 'Servers & Interfaces',
      subpath: 'servers',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }} aria-hidden="true">
          <rect x="3" y="4" width="18" height="6" rx="1" />
          <rect x="3" y="14" width="18" height="6" rx="1" />
          <path d="M7 7h.01M7 17h.01" />
        </svg>
      ),
    },
    {
      id: 'labs',
      label: 'Labs',
      subpath: 'labs',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }} aria-hidden="true">
          <path d="M10 2v7.31L4.15 19.3A2 2 0 0 0 5.86 22h12.28a2 2 0 0 0 1.71-2.7L14 9.31V2" />
          <path d="M8.5 2h7" />
          <path d="M7 16h10" />
        </svg>
      ),
    },
    {
      id: 'config-review',
      label: 'Config Review',
      subpath: 'config-review',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }} aria-hidden="true">
          <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
          <path d="M14 3v5h5" />
        </svg>
      ),
    },
  ];

  return (
    <aside
      style={{
        width: isExpanded ? 'var(--chrome-sidebar-w, 212px)' : 'var(--chrome-sidebar-w-collapsed, 60px)',
        flex: 'none',
        background: 'var(--color-surface)',
        borderRight: '1px solid var(--color-divider)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'width 0.18s cubic-bezier(0.32, 0.72, 0, 1)',
      }}
    >
      <div
        style={{
          height: 'var(--chrome-topbar-h, 56px)',
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '0 16px',
          borderBottom: '1px solid var(--color-divider)',
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flex: 'none' }}
          aria-hidden="true"
        >
          <ellipse cx="12" cy="5" rx="8" ry="3" />
          <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
          <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
        </svg>
        {isExpanded && (
          <span
            style={{
              fontFamily: 'var(--font-heading)',
              fontWeight: 600,
              fontSize: '16px',
              letterSpacing: '-0.01em',
              whiteSpace: 'nowrap',
            }}
          >
            Bind9-Manager
          </span>
        )}
      </div>

      <nav
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
        }}
      >
        {navItems.map((item) => {
          const targetPath = `/config/${configId}/${item.subpath}`;
          const isActive = location.pathname.startsWith(targetPath);

          return (
            <Link
              key={item.id}
              to={targetPath}
              title={isExpanded ? undefined : item.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '9px 16px',
                margin: '0 8px',
                borderRadius: 'var(--radius-md, 4px)',
                background: isActive
                  ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)'
                  : 'transparent',
                color: isActive ? 'var(--color-accent-800)' : 'var(--color-text)',
                fontSize: '13px',
                fontWeight: isActive ? 600 : 500,
                textDecoration: 'none',
              }}
            >
              {item.icon}
              {isExpanded && <span style={{ whiteSpace: 'nowrap' }}>{item.label}</span>}
            </Link>
          );
        })}

        {/* The docs are a separate static site served at /docs, so this is a
            plain anchor (new tab), not a client-side route. */}
        <a
          href="/docs/"
          target="_blank"
          rel="noreferrer"
          title={isExpanded ? undefined : 'Docs'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '9px 16px',
            margin: '8px 8px 0',
            borderTop: '1px solid var(--color-divider)',
            paddingTop: '13px',
            color: 'var(--color-text)',
            fontSize: '13px',
            fontWeight: 500,
            textDecoration: 'none',
          }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }} aria-hidden="true">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          {isExpanded && (
            <span style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '5px' }}>
              Docs
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', opacity: 0.6 }} aria-hidden="true">
                <path d="M7 17L17 7" />
                <path d="M7 7h10v10" />
              </svg>
            </span>
          )}
        </a>
      </nav>

      <button
        type="button"
        onClick={toggleExpanded}
        aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
        style={{
          flex: 'none',
          height: '44px',
          border: 0,
          borderTop: '1px solid var(--color-divider)',
          background: 'transparent',
          color: 'var(--color-text)',
          opacity: 0.6,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="16" rx="1" />
          <path d="M9 4v16" />
        </svg>
      </button>
    </aside>
  );
}
