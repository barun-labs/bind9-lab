import { render, screen, fireEvent } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../data/store';
import { AuthProvider } from '../../auth/AuthProvider';
import { seedUsers } from '../../data/users.seed';
import type { User } from '../../types/entities';
import * as apiAdapter from '../../data/apiAdapter';
import { Views } from './Views';

vi.mock('../../data/apiAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/apiAdapter')>();
  return {
    ...actual,
    listViews: vi.fn(async () => [
      {
        id: 'view-1',
        configurationId: 'dns-lab',
        name: 'internal',
        order: 1,
        matchClients: ['10.0.0.0/8'],
        zoneCount: 6,
      },
      {
        id: 'view-2',
        configurationId: 'dns-lab',
        name: 'external',
        order: 2,
        matchClients: ['any'],
        zoneCount: 1,
      },
    ]),
    createView: vi.fn(async () => ({
      id: 'view-3',
      configurationId: 'dns-lab',
      name: 'newview',
      order: 0,
      matchClients: [],
      zoneCount: 0,
    })),
    deleteView: vi.fn(async () => ({ deleted: true })),
  };
});

const createViewMock = vi.mocked(apiAdapter.createView);
const deleteViewMock = vi.mocked(apiAdapter.deleteView);

function renderViews(userToLogin?: User) {
  const defaultUser = seedUsers.find((u) => u.username === 'admin')!;
  const user = userToLogin !== undefined ? userToLogin : defaultUser;
  if (user) {
    localStorage.setItem('bnd_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('bnd_user');
  }

  const router = createMemoryRouter(
    [{ path: '/config/:configId/views', element: <Views /> }],
    { initialEntries: ['/config/dns-lab/views'] }
  );

  return render(
    <StoreProvider>
      <AuthProvider initialUser={user}>
        <RouterProvider router={router} />
      </AuthProvider>
    </StoreProvider>
  );
}

describe('Views', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  test('renders one row per view with name, order and zone count', async () => {
    renderViews();

    expect(await screen.findByText('internal')).toBeInTheDocument();
    expect(screen.getByText('external')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  test('renders view name as a link into the view', async () => {
    renderViews();

    const link = await screen.findByRole('link', { name: 'internal' });
    expect(link.getAttribute('href')).toBe('/config/dns-lab/views/view-1');
  });

  test('opens Add View modal and submits createView with the name', async () => {
    renderViews();

    fireEvent.click(await screen.findByRole('button', { name: 'Add View' }));

    expect(screen.queryByLabelText('Match clients')).toBeNull();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'newview' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create View' }));

    expect(createViewMock).toHaveBeenCalledWith(
      expect.any(Object),
      'dns-lab',
      expect.objectContaining({ name: 'newview' })
    );
  });

  test('deleting a row confirms and calls deleteView with the view id', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderViews();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete view internal' }));

    expect(deleteViewMock).toHaveBeenCalledWith(expect.any(Object), 'dns-lab', 'view-1');
    confirmSpy.mockRestore();
  });

  test('a non-edit user sees no Add or Delete controls', async () => {
    const viewer = seedUsers.find((u) => u.username === 'viewer')!;
    renderViews(viewer);

    await screen.findByText('internal');

    expect(screen.queryByRole('button', { name: 'Add View' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete view internal' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });
});
