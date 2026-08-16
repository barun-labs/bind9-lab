import { render, screen, fireEvent } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../data/store';
import { AuthProvider } from '../../auth/AuthProvider';
import { seedUsers } from '../../data/users.seed';
import * as apiAdapter from '../../data/apiAdapter';
import { BlockDetail } from './BlockDetail';

vi.mock('../../data/apiAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/apiAdapter')>();
  return {
    ...actual,
    getBlock: vi.fn(async () => ({
      id: 'blk-24',
      configurationId: 'dns-lab',
      name: '10.20.30.0/24 pop1',
      cidr: '10.20.30.0/24',
      parentBlockId: null,
      kind: 'NETWORK',
      viewId: 'view-internal',
    })),
    listBlocks: vi.fn(async () => [
      { id: 'blk-24', configurationId: 'dns-lab', name: '10.20.30.0/24 pop1', cidr: '10.20.30.0/24', parentBlockId: null, kind: 'NETWORK', viewId: 'view-internal' },
      { id: 'blk-27', configurationId: 'dns-lab', name: '10.20.30.0/27 mgmt', cidr: '10.20.30.0/27', parentBlockId: 'blk-24', kind: 'NETWORK', viewId: 'view-internal' },
    ]),
    reconcileBlock: vi.fn(async () => ({ created: 3 })),
  };
});

const reconcileBlockMock = vi.mocked(apiAdapter.reconcileBlock);

function renderBlockDetail() {
  const admin = seedUsers.find((u) => u.username === 'admin')!;
  localStorage.setItem('bnd_user', JSON.stringify(admin));

  const router = createMemoryRouter([{ path: '/config/:configId/blocks/:blockId', element: <BlockDetail /> }], {
    initialEntries: ['/config/dns-lab/blocks/blk-24'],
  });

  return render(
    <StoreProvider>
      <AuthProvider initialUser={admin}>
        <RouterProvider router={router} />
      </AuthProvider>
    </StoreProvider>
  );
}

describe('BlockDetail', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  test('shows the block, its child, and reconciling reports the created count', async () => {
    renderBlockDetail();

    expect(await screen.findByText('10.20.30.0/27 mgmt')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reconcile reverse PTRs' }));

    expect(reconcileBlockMock).toHaveBeenCalledWith(expect.any(Object), 'dns-lab', 'blk-24');
    expect(await screen.findByText('Created 3 reverse PTR records.')).toBeInTheDocument();
  });
});
