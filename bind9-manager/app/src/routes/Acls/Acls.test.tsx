import { render, screen, fireEvent } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../data/store';
import { AuthProvider } from '../../auth/AuthProvider';
import { seedUsers } from '../../data/users.seed';
import type { User } from '../../types/entities';
import * as apiAdapter from '../../data/apiAdapter';
import { Acls } from './Acls';

vi.mock('../../data/apiAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/apiAdapter')>();
  return {
    ...actual,
    listAcls: vi.fn(async () => [
      {
        id: 'acl-1',
        configurationId: 'dns-lab',
        name: 'internal-clients',
        entries: [
          { id: 'e1', order: 0, type: 'CIDR', value: '10.0.0.0/8', negated: false },
        ],
        usedByCount: 2,
      },
      {
        id: 'acl-2',
        configurationId: 'dns-lab',
        name: 'edge-any',
        entries: [],
        usedByCount: 0,
      },
    ]),
    createAcl: vi.fn(async () => ({
      id: 'acl-3',
      configurationId: 'dns-lab',
      name: 'newacl',
      entries: [],
      usedByCount: 0,
    })),
    deleteAcl: vi.fn(async () => ({ deleted: true })),
  };
});

const createAclMock = vi.mocked(apiAdapter.createAcl);
const deleteAclMock = vi.mocked(apiAdapter.deleteAcl);

function renderAcls(userToLogin?: User) {
  const defaultUser = seedUsers.find((u) => u.username === 'admin')!;
  const user = userToLogin !== undefined ? userToLogin : defaultUser;
  if (user) {
    localStorage.setItem('bnd_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('bnd_user');
  }

  const router = createMemoryRouter(
    [{ path: '/config/:configId/acls', element: <Acls /> }],
    { initialEntries: ['/config/dns-lab/acls'] }
  );

  return render(
    <StoreProvider>
      <AuthProvider initialUser={user}>
        <RouterProvider router={router} />
      </AuthProvider>
    </StoreProvider>
  );
}

describe('Acls', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  test('renders one row per ACL with name, entry count and used-by count', async () => {
    renderAcls();

    expect(await screen.findByText('internal-clients')).toBeInTheDocument();
    expect(screen.getByText('edge-any')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  test('opens Add ACL modal and submits createAcl with the name', async () => {
    renderAcls();

    fireEvent.click(await screen.findByRole('button', { name: 'Add ACL' }));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'newacl' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create ACL' }));

    expect(createAclMock).toHaveBeenCalledWith(
      expect.any(Object),
      'dns-lab',
      expect.objectContaining({ name: 'newacl' })
    );
  });

  test('deleting a row confirms and calls deleteAcl with the acl id', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAcls();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete ACL internal-clients' }));

    expect(deleteAclMock).toHaveBeenCalledWith(expect.any(Object), 'dns-lab', 'acl-1');
    confirmSpy.mockRestore();
  });

  test('a non-edit user sees no Add or Delete controls', async () => {
    const viewer = seedUsers.find((u) => u.username === 'viewer')!;
    renderAcls(viewer);

    await screen.findByText('internal-clients');

    expect(screen.queryByRole('button', { name: 'Add ACL' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete ACL internal-clients' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });
});
