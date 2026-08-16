import { render, screen, fireEvent, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../data/store';
import { AuthProvider } from '../../auth/AuthProvider';
import { seedUsers } from '../../data/users.seed';
import type { User } from '../../types/entities';
import * as apiAdapter from '../../data/apiAdapter';
import { SnapshotDetail } from './SnapshotDetail';

vi.mock('../../data/apiAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/apiAdapter')>();
  return {
    ...actual,
    getSnapshot: vi.fn(async () => ({
      id: 'snap-1',
      configurationId: 'dns-lab',
      label: 'before breaking split-horizon ACL',
      createdAt: '2026-08-13T14:20:00Z',
      source: 'CURRENT',
      counts: { views: 3, zones: 12, records: 88 },
    })),
    restoreSnapshot: vi.fn(async () => ({ restored: true })),
    deleteSnapshot: vi.fn(async () => ({ deleted: true })),
  };
});

const restoreSnapshotMock = vi.mocked(apiAdapter.restoreSnapshot);
const deleteSnapshotMock = vi.mocked(apiAdapter.deleteSnapshot);

function renderSnapshotDetail(userToLogin?: User) {
  const defaultUser = seedUsers.find((u) => u.username === 'admin')!;
  const user = userToLogin !== undefined ? userToLogin : defaultUser;
  if (user) {
    localStorage.setItem('bnd_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('bnd_user');
  }

  const router = createMemoryRouter(
    [{ path: '/config/:configId/backups/:snapshotId', element: <SnapshotDetail /> }],
    { initialEntries: ['/config/dns-lab/backups/snap-1'] }
  );

  return render(
    <StoreProvider>
      <AuthProvider initialUser={user}>
        <RouterProvider router={router} />
      </AuthProvider>
    </StoreProvider>
  );
}

describe('SnapshotDetail', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  test('renders the label, source, createdAt and per-table counts', async () => {
    renderSnapshotDetail();

    expect(await screen.findByRole('heading', { name: 'before breaking split-horizon ACL' })).toBeInTheDocument();
    expect(screen.getByText(/CURRENT/)).toBeInTheDocument();
    expect(screen.getByText('zones')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('records')).toBeInTheDocument();
    expect(screen.getByText('88')).toBeInTheDocument();
  });

  test('restore opens a confirm modal naming the consequence and only calls restoreSnapshot after confirming', async () => {
    renderSnapshotDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));

    expect(await screen.findByText('Restore snapshot?')).toBeInTheDocument();
    expect(screen.getByText(/replaces the current configuration's views\/zones\/records/)).toBeInTheDocument();
    expect(restoreSnapshotMock).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));

    expect(restoreSnapshotMock).toHaveBeenCalledWith(expect.any(Object), 'dns-lab', 'snap-1');
  });

  test('delete confirms and calls deleteSnapshot with the snapshot id', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderSnapshotDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(deleteSnapshotMock).toHaveBeenCalledWith(expect.any(Object), 'dns-lab', 'snap-1');
    confirmSpy.mockRestore();
  });

  test('a non-edit user sees no Restore or Delete controls', async () => {
    const viewer = seedUsers.find((u) => u.username === 'viewer')!;
    renderSnapshotDetail(viewer);

    await screen.findByRole('heading', { name: 'before breaking split-horizon ACL' });

    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });
});
