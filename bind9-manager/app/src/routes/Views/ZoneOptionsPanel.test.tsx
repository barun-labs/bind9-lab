import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../data/store';
import { AuthProvider } from '../../auth/AuthProvider';
import { seedUsers } from '../../data/users.seed';
import * as apiAdapter from '../../data/apiAdapter';
import { ZoneOptionsPanel } from './ZoneOptionsPanel';

// A minimal in-memory "ZONE options" table the mocked fetchers read/write,
// standing in for the real fixture store / backend.
let zoneRows: any[] = [];
const INHERITED_ALLOW_TRANSFER = ['10.20.30.11'];

vi.mock('../../data/apiAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/apiAdapter')>();
  return {
    ...actual,
    getEffectiveZoneOptions: vi.fn(async () => {
      const row = zoneRows.find((r) => r.key === 'allow-transfer');
      if (row?.disabled) {
        return [{ key: 'allow-transfer', mode: 'DISABLE', effectiveValue: null, inheritedValue: INHERITED_ALLOW_TRANSFER }];
      }
      if (row) {
        return [{ key: 'allow-transfer', mode: 'OVERRIDE', effectiveValue: row.value, inheritedValue: INHERITED_ALLOW_TRANSFER }];
      }
      return [{ key: 'allow-transfer', mode: 'INHERIT', effectiveValue: INHERITED_ALLOW_TRANSFER, inheritedValue: INHERITED_ALLOW_TRANSFER }];
    }),
    listDeploymentOptions: vi.fn(async () => zoneRows),
    // useApi() always calls these as api.xxx(store, ...args) — the mocks must
    // accept the leading store arg even though these fixtures ignore it.
    createDeploymentOption: vi.fn(async (_store: any, configId: string, input: any) => {
      const row = { id: 'opt-test-1', configurationId: configId, disabled: false, ...input };
      zoneRows.push(row);
      return row;
    }),
    updateDeploymentOption: vi.fn(async (_store: any, _configId: string, optionId: string, patch: any) => {
      const row = zoneRows.find((r) => r.id === optionId);
      Object.assign(row, patch);
      return row;
    }),
    deleteDeploymentOption: vi.fn(async (_store: any, _configId: string, optionId: string) => {
      zoneRows = zoneRows.filter((r) => r.id !== optionId);
      return { deleted: true };
    }),
  };
});

const createMock = vi.mocked(apiAdapter.createDeploymentOption);
const updateMock = vi.mocked(apiAdapter.updateDeploymentOption);
const deleteMock = vi.mocked(apiAdapter.deleteDeploymentOption);

function renderPanel() {
  const router = createMemoryRouter(
    [{ path: '/config/:configId/views/:viewId/zones/:zoneId/options', element: <ZoneOptionsPanel /> }],
    { initialEntries: ['/config/dns-lab/views/view-internal/zones/zone-lab/options'] }
  );
  return render(
    <StoreProvider>
      <AuthProvider initialUser={seedUsers.find((u) => u.username === 'admin')!}>
        <RouterProvider router={router} />
      </AuthProvider>
    </StoreProvider>
  );
}

describe('ZoneOptionsPanel', () => {
  beforeEach(() => {
    zoneRows = [];
    vi.clearAllMocks();
  });

  // Must-fail control: an INHERIT key must display the value inherited from
  // the view. If the effective-options wiring drops inheritedValue, or the
  // panel stops rendering it, this assertion fails.
  test('an INHERIT key shows the inherited view value', async () => {
    renderPanel();
    const row = await screen.findByTestId('zone-option-allow-transfer');
    expect(within(row).getByText('10.20.30.11')).toBeInTheDocument();
  });

  test('Override creates a ZONE row seeded from the inherited value, editing PATCHes it, Inherit DELETEs it', async () => {
    renderPanel();
    const row = await screen.findByTestId('zone-option-allow-transfer');
    within(row).getByText('10.20.30.11');

    fireEvent.click(within(row).getByRole('radio', { name: 'Override' }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith(
      expect.any(Object),
      'dns-lab',
      expect.objectContaining({ scope: 'ZONE', scopeId: 'zone-lab', key: 'allow-transfer', value: INHERITED_ALLOW_TRANSFER })
    );

    const valueInput = await within(row).findByLabelText('allow-transfer value');
    fireEvent.change(valueInput, { target: { value: '10.20.30.99' } });

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock).toHaveBeenCalledWith(expect.any(Object), 'dns-lab', 'opt-test-1', { value: ['10.20.30.99'] });

    fireEvent.click(within(row).getByRole('radio', { name: 'Inherit' }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1));
    expect(deleteMock).toHaveBeenCalledWith(expect.any(Object), 'dns-lab', 'opt-test-1');
  });
});
