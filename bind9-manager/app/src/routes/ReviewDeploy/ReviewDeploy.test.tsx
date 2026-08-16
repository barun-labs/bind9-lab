import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../data/store';
import { AuthProvider } from '../../auth/AuthProvider';
import { seedUsers } from '../../data/users.seed';
import * as apiAdapter from '../../data/apiAdapter';
import { ReviewDeploy } from './ReviewDeploy';

vi.mock('../../data/apiAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/apiAdapter')>();
  const items = [
    {
      id: 'cs-1',
      configurationId: 'dns-lab',
      objectType: 'RECORD',
      objectId: 'rec-1',
      objectLabel: 'www.lab.lun.net A',
      groupKey: 'lab.lun.net',
      action: 'CREATE',
      diff: { before: null, after: {} },
      createdBy: 'user',
    },
    {
      id: 'cs-2',
      configurationId: 'dns-lab',
      objectType: 'RECORD',
      objectId: 'rec-2',
      objectLabel: 'mail.lab.lun.net A',
      groupKey: 'lab.lun.net',
      action: 'UPDATE',
      diff: { before: {}, after: {} },
      createdBy: 'user',
    },
  ];
  return {
    ...actual,
    getChangeSet: vi.fn(async () => ({
      items,
      groups: [{ groupKey: 'lab.lun.net', objectType: 'RECORD', items }],
    })),
    getChangeSetDiff: vi.fn(async () => ({
      mode: 'unified',
      lines: [{ kind: 'add', text: 'www 300 IN A 10.0.0.1' }],
    })),
    listServers: vi.fn(async () => [
      { id: 'srv-pri', configurationId: 'dns-lab', hostname: 'bind-pri-01', nodeName: 'node-pri', mgmtAddress: '172.20.20.11', syncState: 'SYNCED' },
      { id: 'srv-sec', configurationId: 'dns-lab', hostname: 'bind-sec-01', nodeName: 'node-sec', mgmtAddress: '172.20.20.12', syncState: 'SYNCED' },
    ]),
    createDeployJob: vi.fn(async () => ({ jobId: 'job-1' })),
    getChangeSetDeployJob: vi.fn(async () => ({
      id: 'job-1',
      configurationId: 'dns-lab',
      changeSetItemIds: ['cs-1', 'cs-2'],
      targetServerIds: ['srv-pri', 'srv-sec'],
      status: 'SUCCEEDED',
      serverResults: [
        { serverId: 'srv-pri', outcome: 'SUCCEEDED', startedAt: '2026-08-16T00:00:00Z', finishedAt: '2026-08-16T00:00:01Z' },
        { serverId: 'srv-sec', outcome: 'SUCCEEDED', startedAt: '2026-08-16T00:00:00Z', finishedAt: '2026-08-16T00:00:01Z' },
      ],
      createdAt: '2026-08-16T00:00:00Z',
    })),
    retryDeployJob: vi.fn(async () => ({ jobId: 'job-2' })),
  };
});

const createDeployJobMock = vi.mocked(apiAdapter.createDeployJob);
const getChangeSetDeployJobMock = vi.mocked(apiAdapter.getChangeSetDeployJob);

function renderReviewDeploy() {
  const user = seedUsers.find((u) => u.username === 'admin')!;
  const router = createMemoryRouter(
    [{ path: '/config/:configId/review-deploy', element: <ReviewDeploy /> }],
    { initialEntries: ['/config/dns-lab/review-deploy'] }
  );

  return render(
    <StoreProvider>
      <AuthProvider initialUser={user}>
        <RouterProvider router={router} />
      </AuthProvider>
    </StoreProvider>
  );
}

describe('ReviewDeploy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders change-set groups from a mocked getChangeSet', async () => {
    renderReviewDeploy();

    expect(await screen.findByText('lab.lun.net')).toBeInTheDocument();
    expect(screen.getByText('RECORD · 2 changes')).toBeInTheDocument();
    expect(screen.getByText(/2 pending changes/)).toBeInTheDocument();
  });

  test('clicking Deploy with targets selected calls createDeployJob', async () => {
    renderReviewDeploy();

    await screen.findByText('lab.lun.net');
    fireEvent.click(screen.getByRole('button', { name: 'Deploy to 2 servers' }));

    await waitFor(() => expect(createDeployJobMock).toHaveBeenCalled());
    expect(createDeployJobMock).toHaveBeenCalledWith(expect.any(Object), 'dns-lab', {
      changeSetItemIds: ['cs-1', 'cs-2'],
      targetServerIds: ['srv-pri', 'srv-sec'],
    });
  });

  test('a mocked SUCCEEDED job renders the result panel with a success row', async () => {
    renderReviewDeploy();

    await screen.findByText('lab.lun.net');
    fireEvent.click(screen.getByRole('button', { name: 'Deploy to 2 servers' }));

    expect(await screen.findByText('Deploy result')).toBeInTheDocument();
    expect(screen.getAllByText('Deployed').length).toBe(2);
    expect(screen.getByText('2 of 2 servers deployed successfully')).toBeInTheDocument();
    expect(getChangeSetDeployJobMock).toHaveBeenCalled();
  });

  test('a mocked 422 PREFLIGHT_WARNING_UNACK reveals ack checkbox and re-enables Deploy once checked', async () => {
    createDeployJobMock.mockRejectedValueOnce({
      code: 'PREFLIGHT_WARNING_UNACK',
      message: 'pre-flight warning requires acknowledgement',
      preflight: {
        checkconf: [{ serverId: 'srv-pri', result: 'OK', detail: 'named-checkconf: OK' }],
        checkzone: [{ zoneName: 'lab.lun.net', result: 'WARN', detail: 'dangling CNAME reference' }],
      },
    });

    renderReviewDeploy();

    await screen.findByText('lab.lun.net');
    fireEvent.click(screen.getByRole('button', { name: 'Deploy to 2 servers' }));

    const ack = await screen.findByLabelText(/reviewed the pre-flight warnings/);
    expect(ack).toBeInTheDocument();

    const deployButton = screen.getByRole('button', { name: 'Deploy to 2 servers' });
    expect(deployButton).toBeDisabled();

    fireEvent.click(ack);
    await waitFor(() => expect(deployButton).toBeEnabled());

    fireEvent.click(deployButton);
    await waitFor(() =>
      expect(createDeployJobMock).toHaveBeenLastCalledWith(
        expect.any(Object),
        'dns-lab',
        expect.objectContaining({ warningAck: true })
      )
    );
  });
});
