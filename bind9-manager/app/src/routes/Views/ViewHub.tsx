import { Link, Outlet, useLocation, useParams } from 'react-router-dom';
import { useStore } from '../../data/store';

interface HubTab {
  id: string;
  label: string;
  to: string;
  isActive: (pathname: string) => boolean;
}

export function ViewHub() {
  const { configId = 'dns-lab', viewId = '' } = useParams();
  const store = useStore();
  const location = useLocation();

  const view = store.views.find((v) => v.id === viewId && v.configurationId === configId);

  const tabs: HubTab[] = [
    { id: 'zones', label: 'Zones', to: 'zones', isActive: (p) => p.includes('/zones') },
    { id: 'external-hosts', label: 'External Hosts', to: 'external-hosts', isActive: (p) => p.endsWith('/external-hosts') },
    { id: 'options', label: 'Deployment Options', to: 'options', isActive: (p) => p.endsWith('/options') },
    { id: 'roles', label: 'Deployment Roles', to: 'roles', isActive: (p) => p.endsWith('/roles') },
  ];

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        width: '100%',
      }}
    >
      <div
        style={{
          padding: '24px 32px 0',
          maxWidth: 'var(--chrome-max-content-w, 1040px)',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <h1
          style={{
            fontSize: '22px',
            fontWeight: 600,
            margin: '0 0 16px 0',
            fontFamily: 'var(--font-heading)',
          }}
        >
          {view?.name ?? viewId}
        </h1>

        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--color-divider)',
            gap: '4px',
          }}
        >
          {tabs.map((tab) => {
            const isActive = tab.isActive(location.pathname);
            return (
              <Link
                key={tab.id}
                to={tab.to}
                className="btn btn-ghost"
                style={{
                  borderRadius: 0,
                  borderBottom: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
                  color: isActive ? 'var(--color-accent-800)' : 'var(--color-text)',
                  fontWeight: isActive ? 600 : 400,
                  padding: '8px 16px',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </div>
    </div>
  );
}

export default ViewHub;
