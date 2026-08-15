import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { StoreProvider, makeStore, type StoreData } from '../../data/store';
import { AuthProvider } from '../../auth/AuthProvider';
import { seedUsers } from '../../data/users.seed';
import type { User, ApiKey } from '../../types/entities';
import { ApiKeys } from './ApiKeys';

function renderApiKeys(initialStore?: Partial<StoreData>, userToLogin?: User) {
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
        path: '/settings/api-keys',
        element: <ApiKeys />,
      },
    ],
    {
      initialEntries: ['/settings/api-keys'],
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

describe('Settings → API Keys', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('creating a key shows the token once', async () => {
    const user = userEvent.setup();
    renderApiKeys();

    // Open modal
    const newKeyButton = screen.getByRole('button', { name: /^new api key$/i });
    await user.click(newKeyButton);

    // Modal is open
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('New API key')).toBeInTheDocument();

    // Type 'ci' into name input
    const input = within(dialog).getByLabelText(/name/i);
    await user.type(input, 'ci');

    // Submit form
    const submitButton = within(dialog).getByRole('button', { name: /create key/i });
    await user.click(submitButton);

    // A token string is visible with a copy button
    const tokenElement = await screen.findByText(/^bnd_[a-f0-9]+/i);
    expect(tokenElement).toBeInTheDocument();

    const copyButton = within(dialog).getByRole('button', { name: /copy/i });
    expect(copyButton).toBeInTheDocument();

    expect(within(dialog).getByText("Copy it now — it won't be shown again.")).toBeInTheDocument();
  });

  test('after closing, the list row shows no secret', async () => {
    const user = userEvent.setup();
    renderApiKeys();

    // Open modal and create key 'ci'
    await user.click(screen.getByRole('button', { name: /^new api key$/i }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/name/i), 'ci');
    await user.click(within(dialog).getByRole('button', { name: /create key/i }));

    // Wait for token to appear
    const tokenElement = await screen.findByText(/^bnd_[a-f0-9]+/i);
    const tokenText = tokenElement.textContent!;
    expect(tokenText).toBeTruthy();

    // Close the modal
    const doneButton = screen.getByRole('button', { name: /done/i });
    await user.click(doneButton);

    // Modal is closed
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Row 'ci' is present
    expect(screen.getByText('ci')).toBeInTheDocument();

    // No token text anywhere in the DOM
    expect(screen.queryByText(tokenText)).not.toBeInTheDocument();
    expect(screen.queryByText(/^bnd_/i)).not.toBeInTheDocument();
  });

  test('delete removes the row', async () => {
    const user = userEvent.setup();
    renderApiKeys();

    // Open modal and create key 'ci'
    await user.click(screen.getByRole('button', { name: /^new api key$/i }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/name/i), 'ci');
    await user.click(within(dialog).getByRole('button', { name: /create key/i }));

    // Wait for token and close modal
    await screen.findByText(/^bnd_[a-f0-9]+/i);
    await user.click(screen.getByRole('button', { name: /done/i }));

    // Verify row 'ci' is in table
    expect(screen.getByText('ci')).toBeInTheDocument();

    // Click delete on 'ci' row
    const deleteButton = screen.getByRole('button', { name: /delete api key ci/i });
    await user.click(deleteButton);

    // Row is gone
    await waitFor(() => {
      expect(screen.queryByText('ci')).not.toBeInTheDocument();
    });
  });

  test('logged in as a user, create a key with scopes [read] -> the new row shows that user as owner and reflects the scope', async () => {
    const user = userEvent.setup();
    const editorUser = seedUsers.find((u) => u.username === 'editor')!;
    renderApiKeys(undefined, editorUser);

    // Open modal
    await user.click(screen.getByRole('button', { name: /^new api key$/i }));
    const dialog = screen.getByRole('dialog');

    // Enter name
    const nameInput = within(dialog).getByLabelText(/name/i);
    await user.type(nameInput, 'editor-read-key');

    // Scopes: default is read and write; uncheck write so only read remains
    const writeCheckbox = within(dialog).getByRole('checkbox', { name: /^write$/i });
    await user.click(writeCheckbox);

    // Toggle read-only
    const readOnlyCheckbox = within(dialog).getByRole('checkbox', { name: /read-only/i });
    await user.click(readOnlyCheckbox);

    // Submit
    const createButton = within(dialog).getByRole('button', { name: /create key/i });
    await user.click(createButton);

    // Done on modal
    const doneButton = await screen.findByRole('button', { name: /done/i });
    await user.click(doneButton);

    // Row 'editor-read-key' is in table
    const row = screen.getByText('editor-read-key').closest('tr');
    expect(row).toBeInTheDocument();

    // Shows Editor User as owner
    expect(within(row!).getByText('Editor User')).toBeInTheDocument();

    // Shows 'read' and 'read-only' tag, but not 'write' or 'deploy'
    expect(within(row!).getByText('read')).toBeInTheDocument();
    expect(within(row!).getByText('read-only')).toBeInTheDocument();
    expect(within(row!).queryByText('write')).not.toBeInTheDocument();
    expect(within(row!).queryByText('deploy')).not.toBeInTheDocument();
  });

  test('delete button renders for owner or admin, but not for non-admin non-owner', async () => {
    const initialKey: ApiKey = {
      id: 'key-editor-1',
      name: 'editor-key',
      ownerUserId: 'usr-editor',
      scopes: ['read'],
      readOnly: true,
      expiresAt: null,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };

    // 1. Logged in as viewer (not owner, not admin): no delete button
    const viewerUser = seedUsers.find((u) => u.username === 'viewer')!;
    const { unmount } = renderApiKeys({ apiKeys: [initialKey] }, viewerUser);
    expect(await screen.findByText('editor-key')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /delete api key editor-key/i })
    ).not.toBeInTheDocument();
    unmount();

    // 2. Logged in as owner (editor): delete button is present
    const editorUser = seedUsers.find((u) => u.username === 'editor')!;
    const { unmount: unmount2 } = renderApiKeys({ apiKeys: [initialKey] }, editorUser);
    expect(await screen.findByText('editor-key')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /delete api key editor-key/i })
    ).toBeInTheDocument();
    unmount2();

    // 3. Logged in as admin: delete button is present
    const adminUser = seedUsers.find((u) => u.username === 'admin')!;
    renderApiKeys({ apiKeys: [initialKey] }, adminUser);
    expect(await screen.findByText('editor-key')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /delete api key editor-key/i })
    ).toBeInTheDocument();
  });
});
