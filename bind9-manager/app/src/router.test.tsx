import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { routes } from './router';
import { StoreProvider } from './data/store';
import { AuthProvider } from './auth/AuthProvider';
import { ThemeProvider } from './theme/ThemeProvider';
import { seedUsers } from './data/users.seed';

// Chrome always renders <ThemeSwitcher/>, which needs a ThemeProvider ancestor
// (normally supplied by main.tsx, not by App.tsx itself).
function renderRoute(initialPath: string) {
  const r = createMemoryRouter(routes, { initialEntries: [initialPath] });
  render(
    <ThemeProvider>
      <StoreProvider>
        <AuthProvider initialUser={seedUsers[0]}>
          <RouterProvider router={r} />
        </AuthProvider>
      </StoreProvider>
    </ThemeProvider>
  );
  return r;
}

test('an unbuilt route renders chrome + placeholder', () => {
  renderRoute('/config/dns-lab/blocks');
  expect(screen.getByText(/Bind9-Manager/i)).toBeInTheDocument(); // sidebar brand in chrome
  expect(screen.getByRole('heading', { name: /Network Blocks & Reverse Zones/i })).toBeInTheDocument();
});

test('the view hub renders its four tabs', async () => {
  renderRoute('/config/dns-lab/views/view-internal');
  expect(await screen.findByRole('link', { name: 'Zones' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'External Hosts' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Deployment Options' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Deployment Roles' })).toBeInTheDocument();
});

// Must-fail control: view-internal owns zone-lab (lab.lun.net); view-external owns
// zone-lun (lun.net). If the viewId filter in ZonesInView were dropped, both would
// show up here and this assertion on lun.net's ABSENCE would fail.
test('the Zones tab lists only the current view\'s zones, not another view\'s', async () => {
  renderRoute('/config/dns-lab/views/view-internal/zones');
  expect(await screen.findByText('lab.lun.net')).toBeInTheDocument();
  expect(screen.queryByText('lun.net')).not.toBeInTheDocument();
});

test('an old flat external-hosts path redirects to the nested view hub', async () => {
  renderRoute('/config/dns-lab/external-hosts');
  expect(await screen.findByRole('heading', { name: /external hosts/i })).toBeInTheDocument();
});
