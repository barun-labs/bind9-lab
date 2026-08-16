import { render, screen, fireEvent } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../data/store';
import { AuthProvider } from '../../auth/AuthProvider';
import { seedUsers } from '../../data/users.seed';
import type { User } from '../../types/entities';
import * as apiAdapter from '../../data/apiAdapter';
import { ServerGroups } from './ServerGroups';

vi.mock('../../data/apiAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/apiAdapter')>();
  return {
    ...actual,
    listServerGroups: vi.fn(async () => [
      {
        id: 'grp-1',
        configurationId: 'dns-lab',
        name: 'edge-pop-1',
        description: 'Edge secondaries in POP1',
        memberCount: 2,
      },
      {
        id: 'grp-2',
        configurationId: 'dns-lab',
        name: 'core',
        memberCount: 0,
      },
    ]),
    createServerGroup: vi.fn(async () => ({
      id: 'grp-3',
      configurationId: 'dns-lab',
      name: 'newgroup',
      memberCount: 0,
    })),
    deleteServerGroup: vi.fn(async () => ({ deleted: true })),
  };
});

const createServerGroupMock = vi.mocked(apiAdapter.createServerGroup);
const deleteServerGroupMock = vi.mocked(apiAdapter.deleteServerGroup);

function renderServerGroups(userToLogin?: User) {
  const defaultUser = seedUsers.find((u) => u.username === 'admin')!;
  const user = userToLogin !== undefined ? userToLogin : defaultUser;
  if (user) {
    localStorage.setItem('bnd_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('bnd_user');
  }

  const router = createMemoryRouter(
    [{ path: '/config/:configId/groups', element: <ServerGroups /> }],
    { initialEntries: ['/config/dns-lab/groups'] }
  );

  return render(
    <StoreProvider>
      <AuthProvider initialUser={user}>
        <RouterProvider router={router} />
      </AuthProvider>
    </StoreProvider>
  );
}

describe('ServerGroups', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  test('renders one row per server group with name, description and member count', async () => {
    renderServerGroups();

    expect(await screen.findByText('edge-pop-1')).toBeInTheDocument();
    expect(screen.getByText('core')).toBeInTheDocument();
    expect(screen.getByText('Edge secondaries in POP1')).toBeInTheDocument();
  });

  test('opens Add server group modal and submits createServerGroup with the name', async () => {
    renderServerGroups();

    fireEvent.click(await screen.findByRole('button', { name: 'Add server group' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'newgroup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create server group' }));

    expect(createServerGroupMock).toHaveBeenCalledWith(
      expect.any(Object),
      'dns-lab',
      expect.objectContaining({ name: 'newgroup' })
    );
  });

  test('deleting a row confirms and calls deleteServerGroup with the group id', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderServerGroups();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete server group edge-pop-1' }));

    expect(deleteServerGroupMock).toHaveBeenCalledWith(expect.any(Object), 'dns-lab', 'grp-1');
    confirmSpy.mockRestore();
  });

  test('a non-edit user sees no Add or Delete controls', async () => {
    const viewer = seedUsers.find((u) => u.username === 'viewer')!;
    renderServerGroups(viewer);

    await screen.findByText('edge-pop-1');

    expect(screen.queryByRole('button', { name: 'Add server group' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete server group edge-pop-1' })).toBeNull();
  });
});
