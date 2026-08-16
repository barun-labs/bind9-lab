import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../data/store';
import { ExternalHosts } from './ExternalHosts';

vi.mock('../../data/apiAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/apiAdapter')>();
  return {
    ...actual,
    listExternalHosts: vi.fn(async () => ({
      data: [
        { id: 'eh-1', configurationId: 'dns-lab', fqdn: 'edge.lab.lun.net', referenceCount: 1 },
        { id: 'eh-2', configurationId: 'dns-lab', fqdn: 'mx1.lab.lun.net', referenceCount: 2 },
      ],
      page: 1,
      size: 50,
      total: 2,
    })),
  };
});

function renderExternalHosts() {
  const router = createMemoryRouter(
    [{ path: '/config/:configId/external-hosts', element: <ExternalHosts /> }],
    { initialEntries: ['/config/dns-lab/external-hosts'] }
  );

  return render(
    <StoreProvider>
      <RouterProvider router={router} />
    </StoreProvider>
  );
}

describe('ExternalHosts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders the fetched hosts with fqdn and reference count', async () => {
    renderExternalHosts();

    expect(await screen.findByText('edge.lab.lun.net')).toBeInTheDocument();
    expect(screen.getByText('mx1.lab.lun.net')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
