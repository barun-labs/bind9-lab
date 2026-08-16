import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../data/store';
import * as apiAdapter from '../../data/apiAdapter';
import { QueryTool } from './QueryTool';

vi.mock('../../data/apiAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/apiAdapter')>();
  return {
    ...actual,
    listLabs: vi.fn(async () => ({
      data: [
        {
          id: 'lab-1',
          name: 'dns-lab-topo',
          configurationId: 'dns-lab',
          topology: {
            name: 'dns-lab-topo',
            nodes: [
              { name: 'ns1', kind: 'linux', intent: 'bind' },
              { name: 'r1', kind: 'linux', intent: 'router' },
            ],
            links: [],
          },
          createdAt: '2026-08-15T10:00:00Z',
          updatedAt: '2026-08-15T10:00:00Z',
        },
      ],
      page: 1,
      size: 50,
      total: 1,
    })),
    runQuery: vi.fn(async () => ({
      node: 'ns1',
      containerName: 'clab-lab-ns1',
      qname: 'example.com.',
      qtype: 'A',
      output: ';; ANSWER SECTION:\nexample.com. 3600 IN A 10.70.0.11',
      exitCode: 0,
    })),
  };
});

const runQueryMock = vi.mocked(apiAdapter.runQuery);

function renderQueryTool() {
  const router = createMemoryRouter(
    [{ path: '/config/:configId/query', element: <QueryTool /> }],
    { initialEntries: ['/config/dns-lab/query'] }
  );

  return render(
    <StoreProvider>
      <RouterProvider router={router} />
    </StoreProvider>
  );
}

describe('QueryTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('runs a query and renders the output', async () => {
    renderQueryTool();

    // Wait for the lab to load and the source node to default to ns1.
    await screen.findByDisplayValue('ns1');

    fireEvent.change(screen.getByLabelText('Query name'), {
      target: { value: 'example.com.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(runQueryMock).toHaveBeenCalled());
    expect(runQueryMock).toHaveBeenCalledWith(expect.any(Object), 'lab-1', {
      node: 'ns1',
      qname: 'example.com.',
      qtype: 'A',
      server: undefined,
    });

    expect(await screen.findByText(/ANSWER SECTION/)).toBeInTheDocument();
  });

  test('shows a 422 error inline', async () => {
    runQueryMock.mockRejectedValueOnce(
      new Error('INVALID_NAME: qname must be a valid domain name')
    );
    renderQueryTool();

    await screen.findByDisplayValue('ns1');

    fireEvent.change(screen.getByLabelText('Query name'), {
      target: { value: 'not a name' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(await screen.findByText(/INVALID_NAME/)).toBeInTheDocument();
  });
});
