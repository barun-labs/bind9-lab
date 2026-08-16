import { render, screen, fireEvent } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../data/store';
import { AuthProvider } from '../../auth/AuthProvider';
import { seedUsers } from '../../data/users.seed';
import type { User } from '../../types/entities';
import * as apiAdapter from '../../data/apiAdapter';
import { Servers } from './Servers';

vi.mock('../../data/apiAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/apiAdapter')>();
  return {
    ...actual,
    listServers: vi.fn(async () => [
      {
        id: 'srv-1',
        configurationId: 'dns-lab',
        hostname: 'bind-a',
        nodeName: 'node-a',
        mgmtAddress: '10.0.0.1',
        runtimeAddress: '10.20.30.1',
        syncState: 'SYNCED',
      },
      {
        id: 'srv-2',
        configurationId: 'dns-lab',
        hostname: 'bind-b',
        nodeName: 'node-b',
        mgmtAddress: '10.0.0.2',
        syncState: 'NODE_ABSENT',
      },
    ]),
    createServer: vi.fn(async () => ({
      id: 'srv-3',
      configurationId: 'dns-lab',
      hostname: 'bind-c',
      syncState: 'PENDING',
    })),
    updateServer: vi.fn(async (_store, _configId, serverId, patch) => ({
      id: serverId,
      configurationId: 'dns-lab',
      hostname: patch.hostname ?? 'bind-a',
      syncState: 'SYNCED',
    })),
    deleteServer: vi.fn(async () => ({ deleted: true })),
  };
});

const createServerMock = vi.mocked(apiAdapter.createServer);
const updateServerMock = vi.mocked(apiAdapter.updateServer);
const deleteServerMock = vi.mocked(apiAdapter.deleteServer);

function renderServers(userToLogin?: User) {
  const defaultUser = seedUsers.find((u) => u.username === 'admin')!;
  const user = userToLogin !== undefined ? userToLogin : defaultUser;
  if (user) {
    localStorage.setItem('bnd_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('bnd_user');
  }

  const router = createMemoryRouter(
    [{ path: '/config/:configId/servers', element: <Servers /> }],
    { initialEntries: ['/config/dns-lab/servers'] }
  );

  return render(
    <StoreProvider>
      <AuthProvider initialUser={user}>
        <RouterProvider router={router} />
      </AuthProvider>
    </StoreProvider>
  );
}

describe('Servers', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  test('renders one row per server with hostname and node', async () => {
    renderServers();

    expect(await screen.findByText('bind-a')).toBeInTheDocument();
    expect(screen.getByText('node-a')).toBeInTheDocument();
    expect(screen.getByText('bind-b')).toBeInTheDocument();
    expect(screen.getByText('node-b')).toBeInTheDocument();
  });

  test('renders a synced pill and a node_absent pill keyed on syncState', async () => {
    renderServers();

    const syncedPill = await screen.findByRole('img', { name: 'SYNCED' });
    expect(syncedPill).toHaveClass('status-pill-synced');

    const nodeAbsentPill = screen.getByRole('img', { name: 'NODE_ABSENT' });
    expect(nodeAbsentPill).toHaveClass('status-pill-node-absent');
  });

  test('opens Add Server modal and submits createServer with the hostname', async () => {
    renderServers();

    fireEvent.click(await screen.findByRole('button', { name: 'Add Server' }));

    fireEvent.change(screen.getByLabelText('Hostname'), { target: { value: 'bind-c' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(createServerMock).toHaveBeenCalledWith(
      expect.any(Object),
      'dns-lab',
      expect.objectContaining({ hostname: 'bind-c' })
    );
  });

  test('editing a server submits updateServer with the patched fields', async () => {
    renderServers();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit server bind-a' }));

    const hostnameInput = screen.getByLabelText('Hostname');
    fireEvent.change(hostnameInput, { target: { value: 'bind-a-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateServerMock).toHaveBeenCalledWith(
      expect.any(Object),
      'dns-lab',
      'srv-1',
      expect.objectContaining({ hostname: 'bind-a-2' })
    );
  });

  test('deleting a row confirms and calls deleteServer with the server id', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderServers();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete server bind-a' }));

    expect(deleteServerMock).toHaveBeenCalledWith(expect.any(Object), 'dns-lab', 'srv-1');
    confirmSpy.mockRestore();
  });
});
