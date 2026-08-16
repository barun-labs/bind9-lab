import { render, screen } from '@testing-library/react';
import { vi, describe, test, expect, beforeEach } from 'vitest';
import { StoreProvider } from '../../data/store';
import { AuthProvider } from '../../auth/AuthProvider';
import { seedUsers } from '../../data/users.seed';
import { StatisticsPanel } from './StatisticsPanel';
import type { StatisticsSnapshot } from '../../types/entities';

// vi.hoisted so these exist before the (hoisted) vi.mock factory references them.
const { getLabStatistics } = vi.hoisted(() => {
  const snap: StatisticsSnapshot = {
    at: '2026-08-16T10:00:00Z',
    servers: [
      {
        serverId: 'srv-lab-dns-1-ns1',
        nodeName: 'ns1',
        containerName: 'clab-dns-lab-topo-ns1',
        present: true,
        totalQueries: 4242,
        responseCodes: { NOERROR: 4000, NXDOMAIN: 200, SERVFAIL: 40, REFUSED: 2 },
        cacheHits: 1000,
        cacheMisses: 3242,
        cacheHitRatio: 0.2357,
        recursionCount: 12,
      },
    ],
  };
  return {
    getLabStatistics: vi.fn(async () => snap),
  };
});

// Mock the adapter module (not the store) — mirrors TelemetryPanel.test.tsx.
// useApi() (real) calls these adapter fns with the store bound.
vi.mock('../../data/apiAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/apiAdapter')>();
  return { ...actual, getLabStatistics };
});

function renderPanel(active = true) {
  const user = seedUsers.find((u) => u.username === 'admin')!;
  return render(
    <StoreProvider>
      <AuthProvider initialUser={user}>
        <StatisticsPanel labId="lab-dns-1" active={active} />
      </AuthProvider>
    </StoreProvider>,
  );
}

describe('StatisticsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('fetches statistics and renders total queries and cache hit ratio', async () => {
    renderPanel();

    expect(await screen.findByText('4242')).toBeInTheDocument();
    expect(screen.getByText('23.6%')).toBeInTheDocument();
    expect(getLabStatistics).toHaveBeenCalledWith(expect.anything(), 'lab-dns-1');
  });

  test('shows empty state when no servers report statistics', async () => {
    getLabStatistics.mockResolvedValueOnce({ servers: [], at: '2026-08-16T10:00:00Z' });

    renderPanel();

    expect(await screen.findByText(/No BIND servers/)).toBeInTheDocument();
  });

  test('does not fetch when inactive', () => {
    renderPanel(false);

    expect(getLabStatistics).not.toHaveBeenCalled();
  });
});
