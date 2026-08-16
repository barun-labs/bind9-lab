import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../data/store';
import * as apiAdapter from '../../data/apiAdapter';
import { ZoneHealth } from './ZoneHealth';

vi.mock('../../data/apiAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/apiAdapter')>();
  return {
    ...actual,
    getConfigHealth: vi.fn(async () => ({
      findings: [
        { severity: 'ERROR', code: 'ZONE_SOA_MISSING', message: 'Zone missing SOA record', subject: 'example.com.' },
        { severity: 'WARNING', code: 'RECORD_TTL_LOW', message: 'TTL below 300', subject: 'www.example.com.' },
        { severity: 'INFO', code: 'ZONE_TRANSFER_OPEN', message: 'Transfer allowed to any', subject: undefined },
      ],
    })),
  };
});

const getConfigHealthMock = vi.mocked(apiAdapter.getConfigHealth);

function renderZoneHealth() {
  const router = createMemoryRouter(
    [{ path: '/config/:configId/health', element: <ZoneHealth /> }],
    { initialEntries: ['/config/dns-lab/health'] }
  );

  return render(
    <StoreProvider>
      <RouterProvider router={router} />
    </StoreProvider>
  );
}

describe('ZoneHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders findings with severity, code, message, and subject', async () => {
    renderZoneHealth();

    expect(await screen.findByRole('img', { name: 'ERROR' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'WARNING' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'INFO' })).toBeInTheDocument();

    expect(screen.getByText('ZONE_SOA_MISSING')).toBeInTheDocument();
    expect(screen.getByText('Zone missing SOA record')).toBeInTheDocument();
    expect(screen.getByText('example.com.')).toBeInTheDocument();
  });

  test('shows the empty state when there are no findings', async () => {
    getConfigHealthMock.mockResolvedValueOnce({ findings: [] });
    renderZoneHealth();

    expect(await screen.findByText('No issues found.')).toBeInTheDocument();
  });
});
