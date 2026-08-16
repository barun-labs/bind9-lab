import { render, screen, fireEvent } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../data/store';
import { AuthProvider } from '../../auth/AuthProvider';
import { seedUsers } from '../../data/users.seed';
import type { User } from '../../types/entities';
import * as apiAdapter from '../../data/apiAdapter';
import { Blocks } from './Blocks';

vi.mock('../../data/apiAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/apiAdapter')>();
  return {
    ...actual,
    listViews: vi.fn(async () => [{ id: 'view-internal', configurationId: 'dns-lab', name: 'internal', order: 0, matchClients: [], zoneCount: 0 }]),
    listBlocks: vi.fn(async () => [
      { id: 'blk-8', configurationId: 'dns-lab', name: '10.0.0.0/8 aggregate', cidr: '10.0.0.0/8', parentBlockId: null, kind: 'BLOCK' },
      { id: 'blk-24', configurationId: 'dns-lab', name: '10.20.30.0/24 pop1', cidr: '10.20.30.0/24', parentBlockId: 'blk-8', kind: 'NETWORK', viewId: 'view-internal' },
    ]),
    createBlock: vi.fn(async () => ({
      id: 'blk-new',
      configurationId: 'dns-lab',
      name: 'newblock',
      cidr: '10.30.0.0/24',
      parentBlockId: null,
      kind: 'BLOCK',
    })),
    deleteBlock: vi.fn(async () => ({ deleted: true })),
  };
});

const createBlockMock = vi.mocked(apiAdapter.createBlock);
const deleteBlockMock = vi.mocked(apiAdapter.deleteBlock);

function renderBlocks(userToLogin?: User) {
  const defaultUser = seedUsers.find((u) => u.username === 'admin')!;
  const user = userToLogin !== undefined ? userToLogin : defaultUser;
  if (user) {
    localStorage.setItem('bnd_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('bnd_user');
  }

  const router = createMemoryRouter([{ path: '/config/:configId/blocks', element: <Blocks /> }], {
    initialEntries: ['/config/dns-lab/blocks'],
  });

  return render(
    <StoreProvider>
      <AuthProvider initialUser={user}>
        <RouterProvider router={router} />
      </AuthProvider>
    </StoreProvider>
  );
}

describe('Blocks', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  test('renders one row per block, name and CIDR, with the child indented under its parent', async () => {
    renderBlocks();

    const rootButton = await screen.findByRole('button', { name: '10.0.0.0/8 aggregate' });
    const childButton = screen.getByRole('button', { name: '10.20.30.0/24 pop1' });
    expect(rootButton).toBeInTheDocument();
    expect(screen.getByText('10.0.0.0/8')).toBeInTheDocument();
    expect(screen.getByText('10.20.30.0/24')).toBeInTheDocument();

    const childIndent = parseFloat(childButton.style.paddingLeft || '0');
    const rootIndent = parseFloat(rootButton.style.paddingLeft || '0');
    expect(childIndent).toBeGreaterThan(rootIndent);
  });

  test('opens Add block modal and submits createBlock with the name, cidr and kind', async () => {
    renderBlocks();

    fireEvent.click(await screen.findByRole('button', { name: 'Add block' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'newblock' } });
    fireEvent.change(screen.getByLabelText('CIDR'), { target: { value: '10.30.0.0/24' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create block' }));

    expect(createBlockMock).toHaveBeenCalledWith(
      expect.any(Object),
      'dns-lab',
      expect.objectContaining({ name: 'newblock', cidr: '10.30.0.0/24', kind: 'BLOCK' })
    );
  });

  test('a rejected create surfaces the server validation error in an InlineAlert', async () => {
    createBlockMock.mockRejectedValueOnce(new Error('Block violates the hierarchy rules'));
    renderBlocks();

    fireEvent.click(await screen.findByRole('button', { name: 'Add block' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'overlap' } });
    fireEvent.change(screen.getByLabelText('CIDR'), { target: { value: '10.0.0.0/8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create block' }));

    expect(await screen.findByText('Block violates the hierarchy rules')).toBeInTheDocument();
  });

  test('deleting a row confirms and calls deleteBlock with the block id', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderBlocks();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete block 10.0.0.0/8 aggregate' }));

    expect(deleteBlockMock).toHaveBeenCalledWith(expect.any(Object), 'dns-lab', 'blk-8');
    confirmSpy.mockRestore();
  });

  test('a non-edit user sees no Add or Delete controls', async () => {
    const viewer = seedUsers.find((u) => u.username === 'viewer')!;
    renderBlocks(viewer);

    await screen.findByRole('button', { name: '10.0.0.0/8 aggregate' });

    expect(screen.queryByRole('button', { name: 'Add block' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete block 10.0.0.0/8 aggregate' })).toBeNull();
  });
});
