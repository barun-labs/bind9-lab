import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../data/store';
import * as apiAdapter from '../../data/apiAdapter';
import { AclEvaluator } from './AclEvaluator';

vi.mock('../../data/apiAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/apiAdapter')>();
  return {
    ...actual,
    listAcls: vi.fn(async () => [
      {
        id: 'acl-1',
        configurationId: 'dns-lab',
        name: 'internal-clients',
        entries: [],
        usedByCount: 1,
      },
    ]),
    evaluateAcl: vi.fn(async () => ({
      matched: true,
      decision: 'ALLOW',
      trace: [
        {
          entryId: 'e1',
          type: 'CIDR',
          value: '10.0.0.0/8',
          negated: false,
          matched: true,
        },
      ],
    })),
  };
});

const evaluateAclMock = vi.mocked(apiAdapter.evaluateAcl);

function renderEvaluator() {
  const router = createMemoryRouter(
    [{ path: '/config/:configId/acls/evaluate', element: <AclEvaluator /> }],
    { initialEntries: ['/config/dns-lab/acls/evaluate'] }
  );

  return render(
    <StoreProvider>
      <RouterProvider router={router} />
    </StoreProvider>
  );
}

describe('AclEvaluator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('evaluates the target ACL and renders decision and trace', async () => {
    renderEvaluator();

    // Wait for the ACL list to load and default the target select.
    await screen.findByDisplayValue('internal-clients');

    fireEvent.change(screen.getByLabelText('Client IP'), {
      target: { value: '10.0.0.11' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Evaluate' }));

    await waitFor(() => expect(evaluateAclMock).toHaveBeenCalled());
    expect(evaluateAclMock).toHaveBeenCalledWith(expect.any(Object), 'dns-lab', {
      target: 'internal-clients',
      clientIp: '10.0.0.11',
    });

    expect(await screen.findByText('ALLOW')).toBeInTheDocument();
    expect(screen.getByText('CIDR')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.0/8')).toBeInTheDocument();
  });

  test('shows a 422 error inline', async () => {
    evaluateAclMock.mockRejectedValueOnce(new Error('INVALID_IP: clientIp must be a valid IP'));
    renderEvaluator();

    await screen.findByDisplayValue('internal-clients');

    fireEvent.change(screen.getByLabelText('Client IP'), {
      target: { value: 'not-an-ip' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Evaluate' }));

    expect(await screen.findByText(/INVALID_IP/)).toBeInTheDocument();
  });
});
