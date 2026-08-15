import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { StoreProvider, makeStore, type StoreData } from '../../data/store';
import { AuthProvider } from '../../auth/AuthProvider';
import { seedUsers } from '../../data/users.seed';
import { Users } from './Users';
import type { User } from '../../types/entities';

function renderUsers(options?: { initialStore?: Partial<StoreData>; initialUser?: User | null }) {
  const defaultAdmin = seedUsers.find((u) => u.username === 'admin')!;
  const userToLog = options?.initialUser !== undefined ? options.initialUser : defaultAdmin;

  if (userToLog) {
    localStorage.setItem('bnd_user', JSON.stringify(userToLog));
  } else {
    localStorage.removeItem('bnd_user');
  }

  const router = createMemoryRouter(
    [
      {
        path: '/settings/users',
        element: <Users />,
      },
    ],
    {
      initialEntries: ['/settings/users'],
    }
  );

  return render(
    <StoreProvider initialStore={makeStore(options?.initialStore)}>
      <AuthProvider initialUser={userToLog}>
        <RouterProvider router={router} />
      </AuthProvider>
    </StoreProvider>
  );
}

describe('Settings → Users admin screen', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('renders user list with display names and usernames', async () => {
    renderUsers();

    expect(await screen.findByText('Admin User')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('Editor User')).toBeInTheDocument();
    expect(screen.getByText('editor')).toBeInTheDocument();
    expect(screen.getByText('Viewer User')).toBeInTheDocument();
    expect(screen.getByText('viewer')).toBeInTheDocument();
  });

  test('changing a user\'s role for a config updates that row', async () => {
    const user = userEvent.setup();
    renderUsers();

    expect(await screen.findByText('Viewer User')).toBeInTheDocument();

    const viewerRoleSelect = screen.getByLabelText(/role for viewer user on dns-lab/i);
    expect(viewerRoleSelect).toHaveValue('viewer');

    await user.selectOptions(viewerRoleSelect, 'editor');
    expect(viewerRoleSelect).toHaveValue('editor');

    await user.selectOptions(viewerRoleSelect, 'admin');
    expect(viewerRoleSelect).toHaveValue('admin');
  });

  test('toggling a user\'s active state flips it', async () => {
    const user = userEvent.setup();
    renderUsers();

    expect(await screen.findByText('Viewer User')).toBeInTheDocument();

    const viewerActiveCheckbox = screen.getByLabelText(/active status for viewer user/i);
    expect(viewerActiveCheckbox).toBeChecked();

    await user.click(viewerActiveCheckbox);
    expect(viewerActiveCheckbox).not.toBeChecked();

    await user.click(viewerActiveCheckbox);
    expect(viewerActiveCheckbox).toBeChecked();
  });

  test('as a non-admin, controls are read-only (disabled)', async () => {
    const viewerUser = seedUsers.find((u) => u.username === 'viewer')!;
    renderUsers({ initialUser: viewerUser });

    expect(await screen.findByText('Viewer User')).toBeInTheDocument();

    const selects = screen.getAllByRole('combobox');
    for (const select of selects) {
      expect(select).toBeDisabled();
    }

    const checkboxes = screen.getAllByRole('checkbox');
    for (const checkbox of checkboxes) {
      expect(checkbox).toBeDisabled();
    }
  });
});
