import { render, screen, fireEvent } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../data/store';
import { AuthProvider } from '../../auth/AuthProvider';
import { seedUsers } from '../../data/users.seed';
import type { User } from '../../types/entities';
import * as apiAdapter from '../../data/apiAdapter';
import { TsigKeys } from './TsigKeys';

vi.mock('../../data/apiAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/apiAdapter')>();
  return {
    ...actual,
    listTsigKeys: vi.fn(async () => [
      {
        id: 'tsig-1',
        configurationId: 'dns-lab',
        name: 'transfer-key',
        algorithm: 'hmac-sha256',
        usedByCount: 1,
      },
      {
        id: 'tsig-2',
        configurationId: 'dns-lab',
        name: 'update-key',
        algorithm: 'hmac-sha512',
        usedByCount: 0,
      },
    ]),
    createTsigKey: vi.fn(async () => ({
      id: 'tsig-3',
      configurationId: 'dns-lab',
      name: 'newkey',
      algorithm: 'hmac-sha256',
      secret: 'aGVsbG8td29ybGQtc2VjcmV0LWJhc2U2NA==',
      usedByCount: 0,
    })),
    deleteTsigKey: vi.fn(async () => ({ deleted: true })),
  };
});

const createTsigKeyMock = vi.mocked(apiAdapter.createTsigKey);
const deleteTsigKeyMock = vi.mocked(apiAdapter.deleteTsigKey);

function renderTsigKeys(userToLogin?: User) {
  const defaultUser = seedUsers.find((u) => u.username === 'admin')!;
  const user = userToLogin !== undefined ? userToLogin : defaultUser;
  if (user) {
    localStorage.setItem('bnd_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('bnd_user');
  }

  const router = createMemoryRouter(
    [{ path: '/config/:configId/keys', element: <TsigKeys /> }],
    { initialEntries: ['/config/dns-lab/keys'] }
  );

  return render(
    <StoreProvider>
      <AuthProvider initialUser={user}>
        <RouterProvider router={router} />
      </AuthProvider>
    </StoreProvider>
  );
}

describe('TsigKeys', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  test('renders one row per TSIG key with name, algorithm and used-by count', async () => {
    renderTsigKeys();

    expect(await screen.findByText('transfer-key')).toBeInTheDocument();
    expect(screen.getByText('update-key')).toBeInTheDocument();
    expect(screen.getByText('hmac-sha256')).toBeInTheDocument();
  });

  test('opens Add TSIG key modal, creates a key, and shows the secret once', async () => {
    renderTsigKeys();

    fireEvent.click(await screen.findByRole('button', { name: 'Add TSIG key' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'newkey' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create TSIG key' }));

    expect(createTsigKeyMock).toHaveBeenCalledWith(
      expect.any(Object),
      'dns-lab',
      expect.objectContaining({ name: 'newkey' })
    );
    expect(await screen.findByText('aGVsbG8td29ybGQtc2VjcmV0LWJhc2U2NA==')).toBeInTheDocument();
    expect(screen.getByText(/won't be shown again/)).toBeInTheDocument();
  });

  test('deleting a row confirms and calls deleteTsigKey with the key id', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderTsigKeys();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete TSIG key transfer-key' }));

    expect(deleteTsigKeyMock).toHaveBeenCalledWith(expect.any(Object), 'dns-lab', 'tsig-1');
    confirmSpy.mockRestore();
  });

  test('a non-edit user sees no Add or Delete controls', async () => {
    const viewer = seedUsers.find((u) => u.username === 'viewer')!;
    renderTsigKeys(viewer);

    await screen.findByText('transfer-key');

    expect(screen.queryByRole('button', { name: 'Add TSIG key' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete TSIG key transfer-key' })).toBeNull();
  });
});
