import { render, screen, fireEvent } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../data/store';
import { AuthProvider } from '../../auth/AuthProvider';
import { seedUsers } from '../../data/users.seed';
import type { User } from '../../types/entities';
import * as apiAdapter from '../../data/apiAdapter';
import { Configurations } from './Configurations';

vi.mock('../../data/apiAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/apiAdapter')>();
  return {
    ...actual,
    listConfigurations: vi.fn(async () => ({
      data: [
        {
          id: 'dns-lab',
          name: 'dns-lab-scenario-1',
          description: 'Primary lab',
          isActive: true,
          createdFromTemplateId: null,
          createdAt: '2026-08-01T09:00:00Z',
          updatedAt: '2026-08-15T10:04:00Z',
          counts: { views: 3, zones: 8, records: 200, servers: 3 },
        },
        {
          id: 'split-horizon',
          name: 'split-horizon-test',
          description: 'Experimental variant',
          isActive: true,
          createdFromTemplateId: null,
          createdAt: '2026-08-02T09:00:00Z',
          updatedAt: '2026-08-15T10:04:00Z',
          counts: { views: 1, zones: 2, records: 10, servers: 1 },
        },
      ],
      page: 1,
      size: 50,
      total: 2,
    })),
    createConfiguration: vi.fn(async () => ({
      id: 'cfg-new',
      name: 'newconfig',
      isActive: true,
      createdFromTemplateId: null,
      createdAt: '2026-08-16T00:00:00Z',
      updatedAt: '2026-08-16T00:00:00Z',
      counts: { views: 0, zones: 0, records: 0, servers: 0 },
    })),
    updateConfiguration: vi.fn(async () => ({
      id: 'dns-lab',
      name: 'renamed-lab',
      isActive: true,
      createdFromTemplateId: null,
      createdAt: '2026-08-01T09:00:00Z',
      updatedAt: '2026-08-16T00:00:00Z',
      counts: { views: 3, zones: 8, records: 200, servers: 3 },
    })),
    cloneConfiguration: vi.fn(async () => ({
      id: 'cfg-clone',
      name: 'dns-lab-copy',
      isActive: true,
      createdFromTemplateId: null,
      createdAt: '2026-08-16T00:00:00Z',
      updatedAt: '2026-08-16T00:00:00Z',
      counts: { views: 3, zones: 8, records: 200, servers: 3 },
    })),
    deleteConfiguration: vi.fn(async () => ({ deleted: true })),
  };
});

const createConfigurationMock = vi.mocked(apiAdapter.createConfiguration);
const updateConfigurationMock = vi.mocked(apiAdapter.updateConfiguration);
const cloneConfigurationMock = vi.mocked(apiAdapter.cloneConfiguration);
const deleteConfigurationMock = vi.mocked(apiAdapter.deleteConfiguration);

function renderConfigurations(userToLogin?: User) {
  const defaultUser = seedUsers.find((u) => u.username === 'admin')!;
  const user = userToLogin !== undefined ? userToLogin : defaultUser;
  if (user) {
    localStorage.setItem('bnd_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('bnd_user');
  }

  const router = createMemoryRouter(
    [{ path: '/configurations', element: <Configurations /> }],
    { initialEntries: ['/configurations'] }
  );

  return render(
    <StoreProvider>
      <AuthProvider initialUser={user}>
        <RouterProvider router={router} />
      </AuthProvider>
    </StoreProvider>
  );
}

describe('Configurations', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  test('renders one row per configuration with name and description', async () => {
    renderConfigurations();

    expect(await screen.findByText('dns-lab-scenario-1')).toBeInTheDocument();
    expect(screen.getByText('split-horizon-test')).toBeInTheDocument();
    expect(screen.getByText('Primary lab')).toBeInTheDocument();
  });

  test('opens Create configuration modal and submits createConfiguration with the name', async () => {
    renderConfigurations();

    fireEvent.click(await screen.findByRole('button', { name: 'Create configuration' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'newconfig' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Create configuration' })[1]);

    expect(createConfigurationMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ name: 'newconfig' })
    );
  });

  test('opens Rename modal on a row and submits updateConfiguration with the new name', async () => {
    renderConfigurations();

    fireEvent.click(await screen.findByRole('button', { name: 'Rename configuration dns-lab-scenario-1' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'renamed-lab' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

    expect(updateConfigurationMock).toHaveBeenCalledWith(
      expect.any(Object),
      'dns-lab',
      expect.objectContaining({ name: 'renamed-lab' })
    );
  });

  test('opens Clone modal asking the new name and submits cloneConfiguration', async () => {
    renderConfigurations();

    fireEvent.click(await screen.findByRole('button', { name: 'Clone configuration dns-lab-scenario-1' }));
    expect(screen.getByLabelText('New configuration name')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('New configuration name'), { target: { value: 'dns-lab-copy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clone configuration' }));

    expect(cloneConfigurationMock).toHaveBeenCalledWith(
      expect.any(Object),
      'dns-lab',
      expect.objectContaining({ name: 'dns-lab-copy' })
    );
  });

  test('deleting a row opens a confirm modal and calls deleteConfiguration on confirm', async () => {
    renderConfigurations();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete configuration dns-lab-scenario-1' }));
    expect(screen.getByText('Delete configuration?')).toBeInTheDocument();
    expect(deleteConfigurationMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(deleteConfigurationMock).toHaveBeenCalledWith(expect.any(Object), 'dns-lab');
  });

  test('a non-permitted user sees no Create, Rename, Clone or Delete controls', async () => {
    const viewer = seedUsers.find((u) => u.username === 'viewer')!;
    renderConfigurations(viewer);

    await screen.findByText('dns-lab-scenario-1');

    expect(screen.queryByRole('button', { name: 'Create configuration' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename configuration dns-lab-scenario-1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clone configuration dns-lab-scenario-1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete configuration dns-lab-scenario-1' })).toBeNull();
  });
});
