import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { StoreProvider, makeStore, type StoreData } from '../../data/store';
import { ApiKeys } from './ApiKeys';

function renderApiKeys(initialStore?: Partial<StoreData>) {
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
      <RouterProvider router={router} />
    </StoreProvider>
  );
}

describe('Settings → API Keys', () => {
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
});
