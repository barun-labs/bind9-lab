import { render, screen } from '@testing-library/react';
import { vi, describe, test, expect, beforeEach } from 'vitest';
import { StoreProvider } from '../../data/store';
import { AuthProvider } from '../../auth/AuthProvider';
import { seedUsers } from '../../data/users.seed';
import { TelemetryPanel } from './TelemetryPanel';
import type { TelemetrySnapshot } from '../../types/entities';

// vi.hoisted so these exist before the (hoisted) vi.mock factory references them.
const { openTelemetryStream, getNodeLogs, closeSpy } = vi.hoisted(() => {
  const closeSpy = vi.fn();
  const snap: TelemetrySnapshot = {
    at: '2026-08-15T10:00:00Z',
    nodes: [
      {
        nodeName: 'ns1',
        containerName: 'clab-lab-dns-1-ns1',
        state: 'running',
        cpuPerc: '0.15%',
        memUsage: '12MiB / 2GiB',
        present: true,
      },
      { nodeName: 'ns2', containerName: 'clab-lab-dns-1-ns2', present: false },
    ],
  };
  return {
    closeSpy,
    openTelemetryStream: vi.fn(
      (_store: unknown, _labId: string, onFrame: (s: TelemetrySnapshot) => void) => {
        onFrame(snap);
        return closeSpy;
      },
    ),
    getNodeLogs: vi.fn(async () => 'named[1]: zone example.com/IN loaded'),
  };
});

// Mock the adapter module (not the store) — mirrors the working Servers.test.tsx.
// useApi() (real) calls these adapter fns with the store bound.
vi.mock('../../data/apiAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/apiAdapter')>();
  return { ...actual, openTelemetryStream, getNodeLogs };
});

function renderPanel() {
  const user = seedUsers.find((u) => u.username === 'admin')!;
  return render(
    <StoreProvider>
      <AuthProvider initialUser={user}>
        <TelemetryPanel labId="lab-dns-1" open onClose={vi.fn()} />
      </AuthProvider>
    </StoreProvider>,
  );
}

describe('TelemetryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders running node cpuPerc, memUsage and state from a snapshot frame', () => {
    renderPanel();

    expect(screen.getByText('0.15%')).toBeInTheDocument();
    expect(screen.getByText('12MiB / 2GiB')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('NODE_ABSENT')).toBeInTheDocument();
  });

  test('clicking a node Logs button shows fetched text in a CodeBlock', async () => {
    renderPanel();

    const logsButtons = screen.getAllByRole('button', { name: 'Logs' });
    logsButtons[0].click();

    expect(
      await screen.findByText('named[1]: zone example.com/IN loaded'),
    ).toBeInTheDocument();
    expect(getNodeLogs).toHaveBeenCalledWith(expect.anything(), 'lab-dns-1', 'ns1', undefined);
  });

  test('calls the stream close fn on unmount', () => {
    const { unmount } = renderPanel();
    unmount();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
