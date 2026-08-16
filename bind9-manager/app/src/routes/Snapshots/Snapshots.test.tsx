import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../data/store';
import { AuthProvider } from '../../auth/AuthProvider';
import { seedUsers } from '../../data/users.seed';
import type { User } from '../../types/entities';
import * as apiAdapter from '../../data/apiAdapter';
import { Snapshots } from './Snapshots';

vi.mock('../../data/apiAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/apiAdapter')>();
  return {
    ...actual,
    listSnapshots: vi.fn(async () => [
      {
        id: 'snap-1',
        configurationId: 'dns-lab',
        label: 'before breaking split-horizon ACL',
        createdAt: '2026-08-13T14:20:00Z',
        source: 'CURRENT',
        counts: { views: 3, zones: 12, records: 88 },
      },
      {
        id: 'snap-2',
        configurationId: 'dns-lab',
        label: 'adopted from last deploy',
        createdAt: '2026-08-13T02:00:00Z',
        source: 'BASELINE',
        counts: { views: 3, zones: 8, records: 60 },
      },
    ]),
    captureSnapshot: vi.fn(async () => ({
      id: 'snap-3',
      configurationId: 'dns-lab',
      label: 'newsnap',
      createdAt: '2026-08-15T00:00:00Z',
      source: 'CURRENT',
      counts: { views: 3, zones: 12, records: 88 },
    })),
    adoptSnapshot: vi.fn(async () => ({
      id: 'snap-4',
      configurationId: 'dns-lab',
      label: 'adopted from last deploy',
      createdAt: '2026-08-15T00:00:00Z',
      source: 'BASELINE',
      counts: { views: 3, zones: 8, records: 60 },
    })),
    restoreSnapshot: vi.fn(async () => ({ restored: true })),
    deleteSnapshot: vi.fn(async () => ({ deleted: true })),
  };
});

const captureSnapshotMock = vi.mocked(apiAdapter.captureSnapshot);
const adoptSnapshotMock = vi.mocked(apiAdapter.adoptSnapshot);
const restoreSnapshotMock = vi.mocked(apiAdapter.restoreSnapshot);
const deleteSnapshotMock = vi.mocked(apiAdapter.deleteSnapshot);

function renderSnapshots(userToLogin?: User) {
  const defaultUser = seedUsers.find((u) => u.username === 'admin')!;
  const user = userToLogin !== undefined ? userToLogin : defaultUser;
  if (user) {
    localStorage.setItem('bnd_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('bnd_user');
  }

  const router = createMemoryRouter(
    [{ path: '/config/:configId/backups', element: <Snapshots /> }],
    { initialEntries: ['/config/dns-lab/backups'] }
  );

  return render(
    <StoreProvider>
      <AuthProvider initialUser={user}>
        <RouterProvider router={router} />
      </AuthProvider>
    </StoreProvider>
  );
}

describe('Snapshots', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  test('renders one row per snapshot with label, source badge and a counts summary', async () => {
    renderSnapshots();

    expect(await screen.findByText('before breaking split-horizon ACL')).toBeInTheDocument();
    expect(screen.getByText('adopted from last deploy')).toBeInTheDocument();
    expect(screen.getByText('CURRENT')).toBeInTheDocument();
    expect(screen.getByText('BASELINE')).toBeInTheDocument();
    expect(screen.getByText('12 zones, 88 records')).toBeInTheDocument();
  });

  test('opens Capture snapshot modal and submits captureSnapshot with the label and source', async () => {
    renderSnapshots();

    fireEvent.click(await screen.findByRole('button', { name: 'Capture snapshot' }));
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'newsnap' } });
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }));

    expect(captureSnapshotMock).toHaveBeenCalledWith(
      expect.any(Object),
      'dns-lab',
      expect.objectContaining({ label: 'newsnap', source: 'CURRENT' })
    );
  });

  test('Adopt last-deployed baseline calls adoptSnapshot', async () => {
    renderSnapshots();

    fireEvent.click(await screen.findByRole('button', { name: 'Adopt last-deployed baseline' }));

    await waitFor(() => expect(adoptSnapshotMock).toHaveBeenCalledWith(expect.any(Object), 'dns-lab'));
  });

  test('restore opens a confirm modal naming the consequence and only calls restoreSnapshot after confirming', async () => {
    renderSnapshots();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Restore snapshot before breaking split-horizon ACL' })
    );

    expect(await screen.findByText('Restore snapshot?')).toBeInTheDocument();
    expect(screen.getByText(/replaces the current configuration's views\/zones\/records/)).toBeInTheDocument();
    expect(restoreSnapshotMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    expect(restoreSnapshotMock).toHaveBeenCalledWith(expect.any(Object), 'dns-lab', 'snap-1');
  });

  test('deleting a row confirms and calls deleteSnapshot with the snapshot id', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderSnapshots();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete snapshot before breaking split-horizon ACL' })
    );

    expect(deleteSnapshotMock).toHaveBeenCalledWith(expect.any(Object), 'dns-lab', 'snap-1');
    confirmSpy.mockRestore();
  });

  test('a non-edit user sees no Capture, Adopt, Restore or Delete controls', async () => {
    const viewer = seedUsers.find((u) => u.username === 'viewer')!;
    renderSnapshots(viewer);

    await screen.findByText('before breaking split-horizon ACL');

    expect(screen.queryByRole('button', { name: 'Capture snapshot' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Adopt last-deployed baseline' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restore snapshot before breaking split-horizon ACL' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete snapshot before breaking split-horizon ACL' })).toBeNull();
  });
});
