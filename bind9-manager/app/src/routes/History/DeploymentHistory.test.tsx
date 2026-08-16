import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../data/store';
import { AuthProvider } from '../../auth/AuthProvider';
import { seedUsers } from '../../data/users.seed';
import { DeploymentHistory } from './DeploymentHistory';

vi.mock('../../data/apiAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/apiAdapter')>();
  return {
    ...actual,
    listChangeSetDeployJobs: vi.fn(async () => [
      {
        id: 'job-2',
        configurationId: 'dns-lab',
        changeSetItemIds: ['ci-1', 'ci-2'],
        targetServerIds: ['srv-1', 'srv-2'],
        status: 'SUCCEEDED',
        serverResults: [
          { serverId: 'srv-1', outcome: 'SUCCEEDED', startedAt: '2026-08-15T09:00:00Z' },
          { serverId: 'srv-2', outcome: 'SUCCEEDED', startedAt: '2026-08-15T09:00:00Z' },
        ],
        createdAt: '2026-08-15T09:00:00Z',
      },
      {
        id: 'job-1',
        configurationId: 'dns-lab',
        changeSetItemIds: ['ci-3'],
        targetServerIds: ['srv-1'],
        status: 'FAILED',
        serverResults: [{ serverId: 'srv-1', outcome: 'FAILED', startedAt: '2026-08-14T09:00:00Z' }],
        createdAt: '2026-08-14T09:00:00Z',
      },
    ]),
  };
});

function renderDeploymentHistory() {
  const admin = seedUsers.find((u) => u.username === 'admin')!;
  localStorage.setItem('bnd_user', JSON.stringify(admin));

  const router = createMemoryRouter(
    [{ path: '/config/:configId/history', element: <DeploymentHistory /> }],
    { initialEntries: ['/config/dns-lab/history'] }
  );

  return render(
    <StoreProvider>
      <AuthProvider initialUser={admin}>
        <RouterProvider router={router} />
      </AuthProvider>
    </StoreProvider>
  );
}

describe('DeploymentHistory', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  test('renders one row per deploy job with its status', async () => {
    renderDeploymentHistory();

    expect(await screen.findByText('SUCCEEDED')).toBeInTheDocument();
    expect(screen.getByText('FAILED')).toBeInTheDocument();
    expect(screen.getByText('2/2 ok')).toBeInTheDocument();
    expect(screen.getByText('0/1 ok')).toBeInTheDocument();
  });
});
