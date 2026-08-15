import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { routes } from './router';
import { StoreProvider } from './data/store';
import { AuthProvider } from './auth/AuthProvider';
import { seedUsers } from './data/users.seed';

test('an unbuilt route renders chrome + placeholder', () => {
  const r = createMemoryRouter(routes, { initialEntries: ['/config/dns-lab/blocks'] });
  render(
    <StoreProvider>
      <AuthProvider initialUser={seedUsers[0]}>
        <RouterProvider router={r} />
      </AuthProvider>
    </StoreProvider>
  );
  expect(screen.getByText(/Bind9-Manager/i)).toBeInTheDocument(); // sidebar brand in chrome
  expect(screen.getByRole('heading', { name: /Network Blocks & Reverse Zones/i })).toBeInTheDocument();
});
