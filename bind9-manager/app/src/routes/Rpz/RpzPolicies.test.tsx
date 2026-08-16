import { render, screen, fireEvent } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../data/store';
import { AuthProvider } from '../../auth/AuthProvider';
import { seedUsers } from '../../data/users.seed';
import type { User } from '../../types/entities';
import * as apiAdapter from '../../data/apiAdapter';
import { RpzPolicies } from './RpzPolicies';

vi.mock('../../data/apiAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/apiAdapter')>();
  return {
    ...actual,
    listRpzPolicies: vi.fn(async () => [
      {
        id: 'rpz-1',
        configurationId: 'dns-lab',
        viewId: 'view-1',
        name: 'malware-block',
        order: 0,
        defaultPolicy: 'NXDOMAIN',
      },
      {
        id: 'rpz-2',
        configurationId: 'dns-lab',
        viewId: 'view-2',
        name: 'allowlist-only',
        order: 1,
      },
    ]),
    listViews: vi.fn(async () => [
      { id: 'view-1', configurationId: 'dns-lab', name: 'internal', order: 0, matchClients: [], zoneCount: 0 },
      { id: 'view-2', configurationId: 'dns-lab', name: 'external', order: 1, matchClients: [], zoneCount: 0 },
    ]),
    createRpzPolicy: vi.fn(async () => ({
      id: 'rpz-3',
      configurationId: 'dns-lab',
      viewId: 'view-1',
      name: 'newpolicy',
      order: 2,
    })),
    deleteRpzPolicy: vi.fn(async () => ({ deleted: true })),
  };
});

const createRpzPolicyMock = vi.mocked(apiAdapter.createRpzPolicy);
const deleteRpzPolicyMock = vi.mocked(apiAdapter.deleteRpzPolicy);

function renderRpzPolicies(userToLogin?: User) {
  const defaultUser = seedUsers.find((u) => u.username === 'admin')!;
  const user = userToLogin !== undefined ? userToLogin : defaultUser;
  if (user) {
    localStorage.setItem('bnd_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('bnd_user');
  }

  const router = createMemoryRouter(
    [{ path: '/config/:configId/rpz', element: <RpzPolicies /> }],
    { initialEntries: ['/config/dns-lab/rpz'] }
  );

  return render(
    <StoreProvider>
      <AuthProvider initialUser={user}>
        <RouterProvider router={router} />
      </AuthProvider>
    </StoreProvider>
  );
}

describe('RpzPolicies', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  test('renders one row per policy with name, view and default policy', async () => {
    renderRpzPolicies();

    expect(await screen.findByText('malware-block')).toBeInTheDocument();
    expect(screen.getByText('allowlist-only')).toBeInTheDocument();
    expect(screen.getByText('internal')).toBeInTheDocument();
    expect(screen.getByText('NXDOMAIN')).toBeInTheDocument();
  });

  test('opens Add RPZ policy modal and submits createRpzPolicy with the name and view', async () => {
    renderRpzPolicies();

    fireEvent.click(await screen.findByRole('button', { name: 'Add RPZ policy' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'newpolicy' } });
    fireEvent.change(screen.getByLabelText('View'), { target: { value: 'view-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create RPZ policy' }));

    expect(createRpzPolicyMock).toHaveBeenCalledWith(
      expect.any(Object),
      'dns-lab',
      expect.objectContaining({ name: 'newpolicy', viewId: 'view-1' })
    );
  });

  test('deleting a row confirms and calls deleteRpzPolicy with the policy id', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderRpzPolicies();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete RPZ policy malware-block' }));

    expect(deleteRpzPolicyMock).toHaveBeenCalledWith(expect.any(Object), 'dns-lab', 'rpz-1');
    confirmSpy.mockRestore();
  });

  test('a non-edit user sees no Add or Delete controls', async () => {
    const viewer = seedUsers.find((u) => u.username === 'viewer')!;
    renderRpzPolicies(viewer);

    await screen.findByText('malware-block');

    expect(screen.queryByRole('button', { name: 'Add RPZ policy' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete RPZ policy malware-block' })).toBeNull();
  });
});
