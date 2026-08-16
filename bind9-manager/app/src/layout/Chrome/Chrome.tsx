import { useState, useEffect } from 'react';
import { Outlet, useParams, useLocation, useNavigate } from 'react-router-dom';
import { ConfigurationSwitcher } from '../../components/ConfigurationSwitcher/ConfigurationSwitcher';
import { ViewSwitcher } from '../../components/ViewSwitcher/ViewSwitcher';
import { PendingChangesPill } from '../../components/PendingChangesPill/PendingChangesPill';
import { Breadcrumb, type BreadcrumbItem } from '../../components/Breadcrumb/Breadcrumb';
import { Button } from '../../components/Button/Button';
import { Sidebar } from '../Sidebar/Sidebar';
import { ThemeSwitcher } from '../../theme/ThemeSwitcher';
import { useStore, useApi } from '../../data/store';
import { useAuth } from '../../auth/AuthProvider';
import type { Configuration, View, Zone } from '../../types/entities';

export function Chrome() {
  const { configId, zoneId, viewId, blockId, groupId, aclId, snapshotId, policyId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const { currentUser, logout } = useAuth();
  const store = useStore();
  const currentConfigId = configId ?? 'dns-lab';

  const api = useApi();
  const [configs, setConfigs] = useState<Configuration[]>(store.configurations);
  useEffect(() => {
    let cancelled = false;
    api
      .listConfigurations()
      .then((res) => {
        if (!cancelled) setConfigs(res.data);
      })
      .catch(() => {
        // keep the seeded list if the fetch fails
      });
    return () => {
      cancelled = true;
    };
  }, [api]);
  // ponytail: one-shot fetch on mount. The switcher won't live-refresh after a create/rename/delete
  // on the Configurations screen until the next full load; acceptable for now, add a refetch trigger
  // if that becomes annoying.
  const currentConfig = configs.find((c) => c.id === currentConfigId) ?? configs[0];

  const [views, setViews] = useState<View[]>(
    store.views.filter((v) => v.configurationId === currentConfigId)
  );
  const [zones, setZones] = useState<Zone[]>(store.zones);
  useEffect(() => {
    let cancelled = false;
    api
      .listViews(currentConfigId)
      .then((v) => {
        if (!cancelled) setViews(v);
      })
      .catch(() => {
        // keep the seeded list on failure
      });
    api
      .listZones(currentConfigId)
      .then((res) => {
        if (!cancelled) setZones(res.data);
      })
      .catch(() => {
        // keep the seeded list on failure
      });
    return () => {
      cancelled = true;
    };
  }, [api, currentConfigId]);
  // ponytail: one-shot fetch per config; no live-refresh after an inline view/zone create until the
  // next config switch or reload — acceptable, matches the configs behavior in this file.
  const currentView = views.find((v) => v.id === viewId) ?? views[0];
  const currentViewId = currentView?.id ?? 'internal';

  const handleSelectConfig = (newConfigId: string) => {
    navigate(`/config/${newConfigId}/views`);
  };

  const handleManageConfigs = () => {
    navigate('/configurations');
  };

  const handleSelectView = (newViewId: string) => {
    navigate(`/config/${currentConfigId}/views/${newViewId}/zones`);
  };

  // Compute breadcrumbs
  const pathname = location.pathname;
  let breadcrumbs: BreadcrumbItem[] = [];

  if (pathname === '/configurations') {
    breadcrumbs = [{ label: 'Configurations' }];
  } else if (pathname === '/settings/api-keys') {
    breadcrumbs = [{ label: 'Settings' }, { label: 'API Keys' }];
  } else if (pathname.includes('/views/') && viewId && zoneId && pathname.endsWith('/records')) {
    const view = views.find((v) => v.id === viewId);
    const zone = zones.find((z) => z.id === zoneId);
    breadcrumbs = [
      { label: 'DNS Views', href: `/config/${currentConfigId}/views` },
      { label: view?.name ?? viewId, href: `/config/${currentConfigId}/views/${viewId}/zones` },
      {
        label: zone?.name ?? zoneId,
        isMono: true,
        href: `/config/${currentConfigId}/views/${viewId}/zones/${zoneId}/records`,
      },
      { label: 'Records' },
    ];
  } else if (pathname.includes('/views/') && viewId && pathname.endsWith('/zones')) {
    const view = views.find((v) => v.id === viewId);
    breadcrumbs = [
      { label: 'DNS Views', href: `/config/${currentConfigId}/views` },
      { label: view?.name ?? viewId },
      { label: 'Zones' },
    ];
  } else if (pathname.includes('/views/') && viewId && pathname.endsWith('/external-hosts')) {
    const view = views.find((v) => v.id === viewId);
    breadcrumbs = [
      { label: 'DNS Views', href: `/config/${currentConfigId}/views` },
      { label: view?.name ?? viewId },
      { label: 'External Hosts' },
    ];
  } else if (pathname.includes('/views/') && viewId && pathname.endsWith('/options')) {
    const view = views.find((v) => v.id === viewId);
    breadcrumbs = [
      { label: 'DNS Views', href: `/config/${currentConfigId}/views` },
      { label: view?.name ?? viewId },
      { label: 'Deployment Options' },
    ];
  } else if (pathname.includes('/views/') && viewId && pathname.endsWith('/roles')) {
    const view = views.find((v) => v.id === viewId);
    breadcrumbs = [
      { label: 'DNS Views', href: `/config/${currentConfigId}/views` },
      { label: view?.name ?? viewId },
      { label: 'Deployment Roles' },
    ];
  } else if (pathname.includes('/views/') && viewId) {
    const view = views.find((v) => v.id === viewId);
    breadcrumbs = [
      { label: 'DNS Views', href: `/config/${currentConfigId}/views` },
      { label: view?.name ?? viewId },
    ];
  } else if (pathname.endsWith('/views')) {
    breadcrumbs = [
      { label: 'Configuration', href: '/configurations' },
      { label: currentConfig?.name ?? currentConfigId },
      { label: 'DNS Views' },
    ];
  } else if (pathname.endsWith('/servers')) {
    breadcrumbs = [
      { label: 'Configuration', href: '/configurations' },
      { label: currentConfig?.name ?? currentConfigId },
      { label: 'Servers & Interfaces' },
    ];
  } else if (pathname.includes('/blocks/') && blockId) {
    breadcrumbs = [
      { label: 'Network Blocks', href: `/config/${currentConfigId}/blocks` },
      { label: blockId, isMono: true },
    ];
  } else if (pathname.endsWith('/blocks')) {
    breadcrumbs = [
      { label: 'Configuration', href: '/configurations' },
      { label: currentConfig?.name ?? currentConfigId },
      { label: 'Network Blocks' },
    ];
  } else if (pathname.endsWith('/config-review')) {
    breadcrumbs = [
      { label: 'Configuration', href: '/configurations' },
      { label: currentConfig?.name ?? currentConfigId },
      { label: 'Config Review' },
    ];
  } else if (pathname.endsWith('/review-deploy')) {
    breadcrumbs = [
      { label: 'Configuration', href: '/configurations' },
      { label: currentConfig?.name ?? currentConfigId },
      { label: 'Review & Deploy' },
    ];
  } else if (pathname.endsWith('/history')) {
    breadcrumbs = [
      { label: 'Configuration', href: '/configurations' },
      { label: currentConfig?.name ?? currentConfigId },
      { label: 'Deployment History' },
    ];
  } else if (pathname.endsWith('/backups')) {
    breadcrumbs = [
      { label: 'Configuration', href: '/configurations' },
      { label: currentConfig?.name ?? currentConfigId },
      { label: 'Snapshots' },
    ];
  } else if (pathname.includes('/backups/') && snapshotId) {
    breadcrumbs = [
      { label: 'Snapshots', href: `/config/${currentConfigId}/backups` },
      { label: snapshotId },
    ];
  } else if (pathname.includes('/groups/') && groupId) {
    breadcrumbs = [
      { label: 'Server Groups', href: `/config/${currentConfigId}/groups` },
      { label: groupId },
    ];
  } else if (pathname.endsWith('/groups')) {
    breadcrumbs = [
      { label: 'Configuration', href: '/configurations' },
      { label: currentConfig?.name ?? currentConfigId },
      { label: 'Server Groups' },
    ];
  } else if (pathname.endsWith('/acls/evaluate')) {
    breadcrumbs = [
      { label: 'ACLs', href: `/config/${currentConfigId}/acls` },
      { label: 'ACL Evaluator' },
    ];
  } else if (pathname.includes('/acls/') && aclId) {
    breadcrumbs = [
      { label: 'ACLs', href: `/config/${currentConfigId}/acls` },
      { label: aclId },
    ];
  } else if (pathname.endsWith('/acls')) {
    breadcrumbs = [
      { label: 'Configuration', href: '/configurations' },
      { label: currentConfig?.name ?? currentConfigId },
      { label: 'ACLs' },
    ];
  } else if (pathname.endsWith('/keys')) {
    breadcrumbs = [
      { label: 'Configuration', href: '/configurations' },
      { label: currentConfig?.name ?? currentConfigId },
      { label: 'TSIG Keys' },
    ];
  } else if (pathname.endsWith('/templates')) {
    breadcrumbs = [
      { label: 'Configuration', href: '/configurations' },
      { label: currentConfig?.name ?? currentConfigId },
      { label: 'Record Templates' },
    ];
  } else if (pathname.endsWith('/health')) {
    breadcrumbs = [
      { label: 'Configuration', href: '/configurations' },
      { label: currentConfig?.name ?? currentConfigId },
      { label: 'Zone Health' },
    ];
  } else if (pathname.endsWith('/query')) {
    breadcrumbs = [
      { label: 'Configuration', href: '/configurations' },
      { label: currentConfig?.name ?? currentConfigId },
      { label: 'Query Tool' },
    ];
  } else if (pathname.includes('/rpz/') && policyId) {
    breadcrumbs = [
      { label: 'RPZ', href: `/config/${currentConfigId}/rpz` },
      { label: policyId, isMono: true },
    ];
  } else if (pathname.endsWith('/rpz')) {
    breadcrumbs = [
      { label: 'Configuration', href: '/configurations' },
      { label: currentConfig?.name ?? currentConfigId },
      { label: 'RPZ' },
    ];
  } else {
    // General fallback
    const segments = pathname.split('/').filter(Boolean);
    breadcrumbs = segments.map((seg, i) => ({
      label: seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' '),
      href: i < segments.length - 1 ? '/' + segments.slice(0, i + 1).join('/') : undefined,
    }));
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100%',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        fontFamily: 'var(--font-body)',
        fontSize: '14px',
        overflow: 'hidden',
      }}
    >
      {/* Layer 1: Config Strip */}
      <ConfigurationSwitcher
        configs={configs}
        activeId={currentConfigId}
        onSelect={handleSelectConfig}
        onManage={handleManageConfigs}
      />

      {/* Main horizontal area */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Sidebar Left Nav */}
        <Sidebar configId={currentConfigId} />

        {/* Right Content Area */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            height: 'calc(100vh - var(--chrome-config-strip-h, 30px))',
            overflow: 'hidden',
          }}
        >
          {/* Layer 2: Topbar */}
          <header
            style={{
              height: 'var(--chrome-topbar-h, 56px)',
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              padding: '0 20px',
              borderBottom: '1px solid var(--color-divider)',
              position: 'relative',
            }}
          >
            <ViewSwitcher
              views={views}
              activeId={currentViewId}
              onSelect={handleSelectView}
            />

            <div style={{ flex: 1, maxWidth: '440px', position: 'relative' }}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  position: 'absolute',
                  left: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  opacity: 0.5,
                }}
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              <input
                className="input"
                placeholder="Search zones, records, servers, IPs…"
                style={{
                  paddingLeft: '30px',
                  paddingRight: '44px',
                  fontSize: '13px',
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  color: 'var(--color-neutral-600)',
                  border: '1px solid var(--color-divider)',
                  padding: '2px 6px',
                  borderRadius: 'var(--radius-sm, 2px)',
                }}
              >
                ⌘K
              </span>
            </div>

            <div style={{ flex: 1 }} />

            <ThemeSwitcher />

            <PendingChangesPill
              count={0}
              href={`/config/${currentConfigId}/review-deploy`}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/config/${currentConfigId}/review-deploy`);
              }}
            />

            {currentUser && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  paddingLeft: '12px',
                  borderLeft: '1px solid var(--color-divider)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    lineHeight: 1.2,
                  }}
                >
                  <span
                    style={{
                      fontSize: '13px',
                      fontWeight: 500,
                      color: 'var(--color-text)',
                    }}
                  >
                    {currentUser.displayName}
                  </span>
                  <span
                    style={{
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--color-text-tertiary)',
                      textTransform: 'uppercase',
                    }}
                  >
                    {currentUser.roles.find((r) => r.configurationId === currentConfigId)?.role ??
                      currentUser.username}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    logout();
                    navigate('/login');
                  }}
                  aria-label="Log out"
                >
                  Log out
                </Button>
              </div>
            )}
          </header>

          {/* Layer 3: Breadcrumb */}
          <Breadcrumb items={breadcrumbs} />

          {/* Router Outlet / Page Content */}
          <div
            style={{
              flex: 1,
              overflow: 'auto',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
