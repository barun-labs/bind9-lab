import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../data/store';
import { ZoneRecords } from './ZoneRecords';

function renderZoneRecords() {
  const router = createMemoryRouter(
    [
      {
        path: '/config/:configId/zones/:zoneId/records',
        element: <ZoneRecords />,
      },
    ],
    {
      initialEntries: ['/config/dns-lab/zones/zone-lab/records'],
    }
  );

  return render(
    <StoreProvider>
      <RouterProvider router={router} />
    </StoreProvider>
  );
}

describe('ZoneRecords', () => {
  test('add an A record via the side panel makes a row appear', async () => {
    const user = userEvent.setup();
    renderZoneRecords();

    // 1. Open Add panel
    const addBtn = screen.getByRole('button', { name: /add record/i });
    await user.click(addBtn);

    // 2. Choose type A (already default, but ensure), name 'smoke', address '10.0.0.7'
    const nameInput = screen.getByLabelText(/^name/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'smoke');

    const addressInput = screen.getByLabelText(/^address/i);
    await user.clear(addressInput);
    await user.type(addressInput, '10.0.0.7');

    // 3. Submit form
    const saveBtn = screen.getByRole('button', { name: /save/i });
    await user.click(saveBtn);

    // 4. Assert a cell with 'smoke' and rdata '10.0.0.7' appear
    expect(await screen.findByText('smoke')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.7')).toBeInTheDocument();
  });

  test('typing an unknown CNAME target shows a dangling-reference warning', async () => {
    const user = userEvent.setup();
    renderZoneRecords();

    // 1. Open Add panel
    const addBtn = screen.getByRole('button', { name: /add record/i });
    await user.click(addBtn);

    // 2. Select CNAME type
    const typeSelect = screen.getByLabelText(/^type/i);
    await user.selectOptions(typeSelect, 'CNAME');

    // 3. Type name 'x' and target 'nope.example.'
    const nameInput = screen.getByLabelText(/^name/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'x');

    const targetInput = screen.getByLabelText(/^target/i);
    await user.clear(targetInput);
    await user.type(targetInput, 'nope.example.');

    // 4. Assert InlineAlert with text matching /dangling/i is shown
    expect(await screen.findByText(/dangling/i)).toBeInTheDocument();
  });

  test('disabling a record dims its row', async () => {
    const user = userEvent.setup();
    renderZoneRecords();

    // Find the first disable button on a row
    const disableButtons = await screen.findAllByRole('button', { name: /^disable/i });
    const targetButton = disableButtons[0];
    const row = targetButton.closest('tr');
    expect(row).toBeInTheDocument();

    // Click disable
    await user.click(targetButton);

    // The row should now be dimmed (opacity or data-disabled)
    await waitFor(() => {
      expect(
        row?.getAttribute('data-disabled') === 'true' ||
          row?.style.opacity === '0.55'
      ).toBe(true);
    });
  });

  test('quick add creates a record and renders it in the table', async () => {
    const user = userEvent.setup();
    renderZoneRecords();

    const nameInput = screen.getByLabelText(/quick add record name/i);
    const valueInput = screen.getByLabelText(/quick add record value/i);
    const submitBtn = screen.getByLabelText(/quick add submit/i);

    await user.type(nameInput, 'quicksmoke');
    await user.type(valueInput, '10.20.30.77');
    await user.click(submitBtn);

    expect(await screen.findByText('quicksmoke')).toBeInTheDocument();
    expect(screen.getByText('10.20.30.77')).toBeInTheDocument();
  });

  test('deleting a record pushes a toast with undo action', async () => {
    const user = userEvent.setup();
    renderZoneRecords();

    const deleteButtons = await screen.findAllByRole('button', { name: /^delete/i });
    const targetDelete = deleteButtons[0];
    await user.click(targetDelete);

    // Toast with Undo appears
    const undoButton = await screen.findByRole('button', { name: /undo/i });
    expect(undoButton).toBeInTheDocument();

    // Click Undo to restore
    await user.click(undoButton);
  });

  test('live preview renders zoneFileLine on keystroke', async () => {
    const user = userEvent.setup();
    renderZoneRecords();

    const addBtn = screen.getByRole('button', { name: /add record/i });
    await user.click(addBtn);

    const nameInput = screen.getByLabelText(/^name/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'previewhost');

    const addressInput = screen.getByLabelText(/^address/i);
    await user.clear(addressInput);
    await user.type(addressInput, '192.168.1.1');

    expect(
      screen.getByText((content) =>
        content.includes('previewhost') && content.includes('192.168.1.1')
      )
    ).toBeInTheDocument();
  });
});
