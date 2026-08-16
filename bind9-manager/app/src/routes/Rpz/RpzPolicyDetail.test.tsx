import { render, screen, fireEvent } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../data/store';
import { AuthProvider } from '../../auth/AuthProvider';
import { seedUsers } from '../../data/users.seed';
import type { User } from '../../types/entities';
import * as apiAdapter from '../../data/apiAdapter';
import { RpzPolicyDetail } from './RpzPolicyDetail';

vi.mock('../../data/apiAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/apiAdapter')>();
  return {
    ...actual,
    getRpzPolicy: vi.fn(async () => ({
      id: 'rpz-1',
      configurationId: 'dns-lab',
      viewId: 'view-1',
      name: 'malware-block',
      order: 0,
      defaultPolicy: 'NXDOMAIN',
    })),
    listRpzRules: vi.fn(async () => [
      { id: 'rpzr-1', policyId: 'rpz-1', trigger: 'QNAME', value: 'evil.example.com', action: 'NXDOMAIN', order: 0 },
    ]),
    listViews: vi.fn(async () => [
      { id: 'view-1', configurationId: 'dns-lab', name: 'internal', order: 0, matchClients: [], zoneCount: 0 },
    ]),
    createRpzRule: vi.fn(async () => ({
      id: 'rpzr-2',
      policyId: 'rpz-1',
      trigger: 'QNAME',
      value: 'phish.example.com',
      action: 'NXDOMAIN',
      order: 1,
    })),
    deleteRpzRule: vi.fn(async () => ({ deleted: true })),
  };
});

const createRpzRuleMock = vi.mocked(apiAdapter.createRpzRule);
const deleteRpzRuleMock = vi.mocked(apiAdapter.deleteRpzRule);

function renderRpzPolicyDetail(userToLogin?: User) {
  const defaultUser = seedUsers.find((u) => u.username === 'admin')!;
  const user = userToLogin !== undefined ? userToLogin : defaultUser;
  if (user) {
    localStorage.setItem('bnd_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('bnd_user');
  }

  const router = createMemoryRouter(
    [{ path: '/config/:configId/rpz/:policyId', element: <RpzPolicyDetail /> }],
    { initialEntries: ['/config/dns-lab/rpz/rpz-1'] }
  );

  return render(
    <StoreProvider>
      <AuthProvider initialUser={user}>
        <RouterProvider router={router} />
      </AuthProvider>
    </StoreProvider>
  );
}

describe('RpzPolicyDetail', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  test('renders the policy name, view and one row per rule', async () => {
    renderRpzPolicyDetail();

    expect(await screen.findByRole('heading', { name: 'malware-block' })).toBeInTheDocument();
    expect(screen.getByText(/internal/)).toBeInTheDocument();
    expect(screen.getByText('evil.example.com')).toBeInTheDocument();
  });

  test('opens Add rule modal and submits createRpzRule with trigger, value and action', async () => {
    renderRpzPolicyDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Add rule' }));
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'phish.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }));

    expect(createRpzRuleMock).toHaveBeenCalledWith(
      expect.any(Object),
      'dns-lab',
      'rpz-1',
      expect.objectContaining({ trigger: 'QNAME', value: 'phish.example.com', action: 'NXDOMAIN' })
    );
  });

  test('a server validation error on add rule is shown via InlineAlert', async () => {
    createRpzRuleMock.mockRejectedValueOnce(new Error('value must be a valid domain name'));
    renderRpzPolicyDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Add rule' }));
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'not a domain' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }));

    expect(await screen.findByText('value must be a valid domain name')).toBeInTheDocument();
  });

  test('deleting a rule confirms and calls deleteRpzRule with the rule id', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderRpzPolicyDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete rule evil.example.com' }));

    expect(deleteRpzRuleMock).toHaveBeenCalledWith(expect.any(Object), 'dns-lab', 'rpzr-1');
    confirmSpy.mockRestore();
  });

  test('a non-edit user sees no Add rule, Edit or Delete controls', async () => {
    const viewer = seedUsers.find((u) => u.username === 'viewer')!;
    renderRpzPolicyDetail(viewer);

    await screen.findByText('evil.example.com');

    expect(screen.queryByRole('button', { name: 'Add rule' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete rule evil.example.com' })).toBeNull();
  });
});
