import { render, screen, fireEvent } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../data/store';
import { AuthProvider } from '../../auth/AuthProvider';
import { seedUsers } from '../../data/users.seed';
import * as apiAdapter from '../../data/apiAdapter';
import { ConfigReview } from './ConfigReview';

vi.mock('../../data/apiAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/apiAdapter')>();
  return {
    ...actual,
    getRenderedConfig: vi.fn(async () => [
      { serverId: 'srv-1', hostname: 'ns1.example.com', text: '# ---- /etc/named.conf ----\noptions { };' },
      { serverId: 'srv-2', hostname: 'ns2.example.com', text: '# ---- /etc/named.conf ----\nzone "example.com" { };' },
    ]),
  };
});

function renderConfigReview() {
  const admin = seedUsers.find((u) => u.username === 'admin')!;
  localStorage.setItem('bnd_user', JSON.stringify(admin));

  const router = createMemoryRouter(
    [{ path: '/config/:configId/config-review', element: <ConfigReview /> }],
    { initialEntries: ['/config/dns-lab/config-review'] }
  );

  return render(
    <StoreProvider>
      <AuthProvider initialUser={admin}>
        <RouterProvider router={router} />
      </AuthProvider>
    </StoreProvider>
  );
}

describe('ConfigReview', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  test('shows the first server config, and switching the picker shows the second', async () => {
    renderConfigReview();

    expect(await screen.findByText(/options { };/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Server'), { target: { value: 'srv-2' } });

    expect(await screen.findByText(/zone "example.com" { };/)).toBeInTheDocument();
    expect(screen.queryByText(/options { };/)).not.toBeInTheDocument();
  });

  test('shows an empty state when the configuration has no servers', async () => {
    vi.mocked(apiAdapter.getRenderedConfig).mockResolvedValueOnce([]);

    renderConfigReview();

    expect(await screen.findByText('No servers in this configuration yet.')).toBeInTheDocument();
  });
});
