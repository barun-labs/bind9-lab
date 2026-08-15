import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, test, expect, afterEach } from 'vitest';
import { StoreProvider, makeStore } from '../../data/store';
import { AuthProvider } from '../../auth/AuthProvider';
import { DeployProgress } from './DeployProgress';
import type { DeployJob } from '../../types/entities';
import * as api from '../../data/apiAdapter';

describe('DeployProgress', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('polls getDeployJob from RUNNING to SUCCEEDED and displays per-server results and dig output', async () => {
    const runningJob: DeployJob = {
      id: 'job-test-1',
      labId: 'lab-1',
      status: 'RUNNING',
      createdAt: '2026-08-15T10:00:00Z',
    };

    const succeededJob: DeployJob = {
      id: 'job-test-1',
      labId: 'lab-1',
      status: 'SUCCEEDED',
      createdAt: '2026-08-15T10:00:00Z',
      result: {
        validated: [{ serverId: 'srv-lab-1-ns1', ok: true, errors: [] }],
        deployed: [
          {
            serverId: 'srv-lab-1-ns1',
            ok: true,
            output: 'dig @10.70.0.11 example.com. SOA -> OK (flags: qr aa; 0 errors)',
          },
        ],
      },
    };

    const getDeployJobSpy = vi
      .spyOn(api, 'getDeployJob')
      .mockResolvedValueOnce(runningJob)
      .mockResolvedValueOnce(succeededJob);

    const onComplete = vi.fn();

    render(
      <StoreProvider initialStore={makeStore()}>
        <AuthProvider>
          <DeployProgress jobId="job-test-1" onComplete={onComplete} pollIntervalMs={30} />
        </AuthProvider>
      </StoreProvider>
    );

    // Initial render displays RUNNING
    expect(await screen.findByText('RUNNING')).toBeInTheDocument();
    expect(screen.getByText('(job-test-1)')).toBeInTheDocument();

    // Polls and transitions to SUCCEEDED
    await waitFor(() => {
      expect(getDeployJobSpy).toHaveBeenCalledTimes(2);
    });

    const succeededElements = await screen.findAllByText('SUCCEEDED');
    expect(succeededElements.length).toBeGreaterThan(0);
    expect(screen.getByText('srv-lab-1-ns1')).toBeInTheDocument();
    expect(screen.getByText(/dig @10\.70\.0\.11 example\.com\./i)).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledWith(succeededJob);
  });

  test('displays FAILED status and error alert when deploy job fails', async () => {
    const failedJob: DeployJob = {
      id: 'job-test-fail',
      labId: 'lab-1',
      status: 'FAILED',
      error: 'Pre-flight validation failed: Containerlab bridge not ready',
      createdAt: '2026-08-15T10:00:00Z',
      result: {
        validated: [{ serverId: 'srv-ns1', ok: false, errors: ['Zone syntax error'] }],
        aborted: 'Pre-flight validation failed: Containerlab bridge not ready',
      },
    };

    vi.spyOn(api, 'getDeployJob').mockResolvedValueOnce(failedJob);

    const onComplete = vi.fn();

    render(
      <StoreProvider initialStore={makeStore()}>
        <AuthProvider>
          <DeployProgress jobId="job-test-fail" onComplete={onComplete} />
        </AuthProvider>
      </StoreProvider>
    );

    const failedElements = await screen.findAllByText('FAILED');
    expect(failedElements.length).toBeGreaterThan(0);
    expect(screen.getByText(/Containerlab bridge not ready/i)).toBeInTheDocument();
    expect(screen.getByText('Zone syntax error')).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledWith(failedJob);
  });

  test('handles prefers-reduced-motion when active', async () => {
    const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal('matchMedia', matchMediaMock);

    const runningJob: DeployJob = {
      id: 'job-test-motion',
      labId: 'lab-1',
      status: 'RUNNING',
      createdAt: '2026-08-15T10:00:00Z',
    };

    vi.spyOn(api, 'getDeployJob').mockResolvedValueOnce(runningJob);

    const { container } = render(
      <StoreProvider initialStore={makeStore()}>
        <AuthProvider>
          <DeployProgress jobId="job-test-motion" />
        </AuthProvider>
      </StoreProvider>
    );

    expect(await screen.findByText('RUNNING')).toBeInTheDocument();
    const animatedSpinners = container.querySelectorAll('svg[style*="deploy-spin"]');
    expect(animatedSpinners.length).toBe(0);
  });
});
