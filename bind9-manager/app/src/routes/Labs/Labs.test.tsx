import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { StoreProvider, makeStore, type StoreData } from '../../data/store';
import { AuthProvider } from '../../auth/AuthProvider';
import { seedUsers } from '../../data/users.seed';
import type { User, Lab } from '../../types/entities';
import { Labs } from './Labs';

const deployedLab: Lab = {
  id: 'lab-deployed',
  name: 'deployed-lab',
  configurationId: 'dns-lab',
  topology: { name: 'deployed-lab', mgmtNetwork: 'clab-mgmt', mgmtSubnet: '10.70.0.0/24', nodes: [], links: [] },
  createdAt: '2026-08-15T10:00:00Z',
  updatedAt: '2026-08-15T10:00:00Z',
  lifecycleState: 'DEPLOYED',
};

const destroyedLab: Lab = {
  ...deployedLab,
  id: 'lab-destroyed',
  name: 'destroyed-lab',
  lifecycleState: 'DESTROYED',
};

function renderLabs(initialStore?: Partial<StoreData>, userToLogin?: User, configId = 'dns-lab') {
  const defaultUser = seedUsers.find((u) => u.username === 'admin')!;
  const user = userToLogin !== undefined ? userToLogin : defaultUser;
  if (user) {
    localStorage.setItem('bnd_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('bnd_user');
  }

  const router = createMemoryRouter(
    [
      {
        path: '/config/:configId/labs',
        element: <Labs />,
      },
      {
        path: '/config/:configId/labs/:labId',
        element: <div>Lab Editor Page</div>,
      },
    ],
    {
      initialEntries: [`/config/${configId}/labs`],
    }
  );

  return render(
    <StoreProvider initialStore={makeStore(initialStore)}>
      <AuthProvider initialUser={user}>
        <RouterProvider router={router} />
      </AuthProvider>
    </StoreProvider>
  );
}

describe('Declarative Labs List', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('the Labs list renders labs for a config', async () => {
    renderLabs();

    expect(screen.getByRole('heading', { name: /Declarative Labs/i })).toBeInTheDocument();
    expect(await screen.findByText('dns-lab-topo')).toBeInTheDocument();
    expect(screen.getByText(/3 nodes/i)).toBeInTheDocument();
    expect(screen.getByText(/2 links/i)).toBeInTheDocument();
  });

  test('creates a new lab without YAML', async () => {
    const user = userEvent.setup();
    renderLabs();

    // Click "New Lab"
    const newLabBtn = screen.getByRole('button', { name: /^new lab$/i });
    await user.click(newLabBtn);

    // Modal is open
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('New Lab')).toBeInTheDocument();

    // Fill lab name
    const input = within(dialog).getByLabelText(/lab name/i);
    await user.type(input, 'my-test-lab');

    // Submit
    const submitBtn = within(dialog).getByRole('button', { name: /create lab/i });
    await user.click(submitBtn);

    // Navigates to Lab Editor page
    expect(await screen.findByText('Lab Editor Page')).toBeInTheDocument();
  });

  test('creates a new lab with pasted YAML import', async () => {
    const user = userEvent.setup();
    renderLabs();

    await user.click(screen.getByRole('button', { name: /^new lab$/i }));
    const dialog = screen.getByRole('dialog');

    await user.type(within(dialog).getByLabelText(/lab name/i), 'imported-lab');
    const yamlInput = within(dialog).getByLabelText(/import from clab.yml/i);
    await user.clear(yamlInput);
    await user.paste(
      `
name: imported-lab
topology:
  nodes:
    ns-custom:
      kind: linux
      image: dnsnode:1.0
  links: []
`
    );

    const submitBtn = within(dialog).getByRole('button', { name: /create lab/i });
    await user.click(submitBtn);

    expect(await screen.findByText('Lab Editor Page')).toBeInTheDocument();

  });

  test('renders a lifecycle pill per lab', async () => {
    renderLabs({ labs: [deployedLab, destroyedLab] });

    expect(await screen.findByText('deployed-lab')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Running' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Not deployed' })).toBeInTheDocument();
  });

  test('delete a lab removes it from the table', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockImplementation(() => true);

    renderLabs();

    expect(await screen.findByText('dns-lab-topo')).toBeInTheDocument();
    const deleteBtn = screen.getByRole('button', { name: /delete lab dns-lab-topo/i });
    await user.click(deleteBtn);

    await waitFor(() => {
      expect(screen.queryByText('dns-lab-topo')).not.toBeInTheDocument();
    });
  });
});
