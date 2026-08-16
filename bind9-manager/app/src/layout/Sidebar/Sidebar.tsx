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
  // Config-scoped items resolve to `/config/${configId}/${subpath}`. Items
  // with an absolute `to` (Settings) ignore configId entirely.
  subpath?: string;
  to?: string;
  icon: ReactNode;
}

interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

function icon(children: ReactNode) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: 'none' }}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const dnsViewsIcon = icon(
  <>
    <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" />
    <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
    <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
  </>
);

const networkBlocksIcon = icon(
  <>
    <circle cx="6" cy="6" r="2" />
    <circle cx="6" cy="18" r="2" />
    <circle cx="18" cy="12" r="2" />
    <path d="M6 8v8" />
    <path d="M6 12h8" />
    <path d="M16 12h.01" />
  </>
);

const recordTemplatesIcon = icon(
  <>
    <path d="M8 3h8a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M5 7v13a1 1 0 0 0 1 1h10" />
  </>
);

const aclsIcon = icon(<path d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z" />);

const tsigKeysIcon = icon(
  <>
    <circle cx="8" cy="16" r="3" />
    <path d="M10.5 13.5L19 5" />
    <path d="M15 9l2 2" />
    <path d="M18 6l2 2" />
  </>
);

const rpzIcon = icon(<path d="M3 4h18l-7 8v6l-4 2v-8z" />);

const serversIcon = icon(
  <>
    <rect x="3" y="4" width="18" height="6" rx="1" />
    <rect x="3" y="14" width="18" height="6" rx="1" />
    <path d="M7 7h.01M7 17h.01" />
  </>
);

const serverGroupsIcon = icon(
  <>
    <path d="M12 3l9 5-9 5-9-5z" />
    <path d="M3 13.5l9 5 9-5" />
  </>
);

const labsIcon = icon(
  <>
    <path d="M10 2v7.31L4.15 19.3A2 2 0 0 0 5.86 22h12.28a2 2 0 0 0 1.71-2.7L14 9.31V2" />
    <path d="M8.5 2h7" />
    <path d="M7 16h10" />
  </>
);

const configReviewIcon = icon(
  <>
    <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
    <path d="M14 3v5h5" />
  </>
);

const reviewDeployIcon = icon(
  <>
    <path d="M12 15V3" />
    <path d="M7 8l5-5 5 5" />
    <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
  </>
);

const zoneHealthIcon = icon(<path d="M3 12h4l2 7 4-14 2 7h6" />);

const queryToolIcon = icon(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </>
);

const snapshotsIcon = icon(
  <>
    <path d="M4 8h3l2-2h6l2 2h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="14" r="3.5" />
  </>
);

const deploymentHistoryIcon = icon(
  <>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l3 2" />
    <path d="M9 2h6" />
  </>
);

const apiKeysIcon = icon(
  <>
    <rect x="3" y="6" width="18" height="13" rx="2" />
    <circle cx="8.5" cy="12.5" r="2" />
    <path d="M10.5 12.5H17" />
    <path d="M14 12.5v2.5" />
    <path d="M17 12.5v2.5" />
  </>
);

const usersIcon = icon(
  <>
    <circle cx="9" cy="8" r="3" />
    <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M15.5 14.2c2.4.4 4.5 2.6 4.5 5.8" />
  </>
);

const navGroups: NavGroup[] = [
  {
    id: 'dns',
    label: 'DNS',
    items: [
      { id: 'views', label: 'DNS Views', subpath: 'views', icon: dnsViewsIcon },
      { id: 'blocks', label: 'Network Blocks', subpath: 'blocks', icon: networkBlocksIcon },
      { id: 'templates', label: 'Record Templates', subpath: 'templates', icon: recordTemplatesIcon },
    ],
  },
  {
    id: 'security',
    label: 'Security',
    items: [
      { id: 'acls', label: 'ACLs', subpath: 'acls', icon: aclsIcon },
      { id: 'keys', label: 'TSIG Keys', subpath: 'keys', icon: tsigKeysIcon },
      { id: 'rpz', label: 'Response Policy', subpath: 'rpz', icon: rpzIcon },
    ],
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    items: [
      { id: 'servers', label: 'Servers & Interfaces', subpath: 'servers', icon: serversIcon },
      { id: 'groups', label: 'Server Groups', subpath: 'groups', icon: serverGroupsIcon },
      { id: 'labs', label: 'Labs', subpath: 'labs', icon: labsIcon },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { id: 'config-review', label: 'Config Review', subpath: 'config-review', icon: configReviewIcon },
      { id: 'review-deploy', label: 'Review & Deploy', subpath: 'review-deploy', icon: reviewDeployIcon },
      { id: 'health', label: 'Zone Health', subpath: 'health', icon: zoneHealthIcon },
      { id: 'query', label: 'Query Tool', subpath: 'query', icon: queryToolIcon },
      { id: 'backups', label: 'Snapshots', subpath: 'backups', icon: snapshotsIcon },
      { id: 'history', label: 'Deployment History', subpath: 'history', icon: deploymentHistoryIcon },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [
      { id: 'api-keys', label: 'API Keys', to: '/settings/api-keys', icon: apiKeysIcon },
      { id: 'users', label: 'Users', to: '/settings/users', icon: usersIcon },
    ],
  },
];

export function Sidebar({
  configId = 'dns-lab',
  expanded: controlledExpanded,
  onToggleExpanded,
}: SidebarProps) {
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(true);
  const location = useLocation();

  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : uncontrolledExpanded;
  const toggleExpanded = onToggleExpanded ?? (() => setUncontrolledExpanded(!uncontrolledExpanded));

  const renderItem = (item: NavItem) => {
    const targetPath = item.to ?? `/config/${configId}/${item.subpath}`;
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
  };

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
        }}
      >
        {navGroups.map((group, groupIndex) => (
          <div
            key={group.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              marginTop: groupIndex === 0 ? 0 : '14px',
            }}
          >
            {isExpanded && (
              <div
                style={{
                  margin: '0 16px 4px',
                  fontSize: '11px',
                  fontWeight: 600,
                  letterSpacing: '.08em',
                  textTransform: 'uppercase',
                  color: 'var(--color-text-tertiary)',
                }}
              >
                {group.label}
              </div>
            )}
            {group.items.map(renderItem)}
          </div>
        ))}

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
            margin: '14px 8px 0',
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
        <a
          href="/api-docs"
          target="_blank"
          rel="noreferrer"
          title={isExpanded ? undefined : 'API Docs'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '9px 16px',
            margin: '0 8px',
            color: 'var(--color-text)',
            fontSize: '13px',
            fontWeight: 500,
            textDecoration: 'none',
          }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }} aria-hidden="true">
            <path d="M8 6l-5 6 5 6" />
            <path d="M16 6l5 6-5 6" />
          </svg>
          {isExpanded && (
            <span style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '5px' }}>
              API Docs
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
