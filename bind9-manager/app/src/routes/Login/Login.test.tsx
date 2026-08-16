import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { routes } from '../../router';
import { StoreProvider } from '../../data/store';
import { AuthProvider } from '../../auth/AuthProvider';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { seedUsers } from '../../data/users.seed';

// Chrome always renders <ThemeSwitcher/>, which needs a ThemeProvider ancestor
// (normally supplied by main.tsx, not by App.tsx itself).
function renderWithProviders(initialPath: string, initialUser?: any) {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  return {
    ...render(
      <ThemeProvider>
        <StoreProvider>
          <AuthProvider initialUser={initialUser}>
            <RouterProvider router={router} />
          </AuthProvider>
        </StoreProvider>
      </ThemeProvider>
    ),
    router,
  };
}

describe('Login & Route Guard', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('memory router at protected path with no user lands on /login (shows Sign in)', () => {
    renderWithProviders('/config/dns-lab/zones/zone-lab/records', null);

    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  test('after logging in as a seed user, the route shows the records screen "Add record"', async () => {
    const adminUser = seedUsers.find((u) => u.username === 'admin')!;
    renderWithProviders('/config/dns-lab/zones/zone-lab/records', adminUser);

    expect(await screen.findByRole('button', { name: /add record/i })).toBeInTheDocument();
    expect(screen.getByText(adminUser.displayName)).toBeInTheDocument();
  });

  test('submitting login form with valid seed user logs in and redirects', async () => {
    const user = userEvent.setup();
    renderWithProviders('/login', null);

    const usernameInput = screen.getByLabelText(/username/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitBtn = screen.getByRole('button', { name: /sign in/i });

    await user.type(usernameInput, 'admin');
    await user.type(passwordInput, 'secret');
    await user.click(submitBtn);

    expect(await screen.findByRole('heading', { name: /^configurations$/i })).toBeInTheDocument();
    expect(screen.getByText('Admin User')).toBeInTheDocument();
  });

  test('submitting login form with invalid username shows inline error', async () => {
    const user = userEvent.setup();
    renderWithProviders('/login', null);

    const usernameInput = screen.getByLabelText(/username/i);
    const submitBtn = screen.getByRole('button', { name: /sign in/i });

    await user.type(usernameInput, 'nonexistent');
    await user.click(submitBtn);

    expect(await screen.findByText(/user "nonexistent" not found/i)).toBeInTheDocument();
  });

  test('clicking logout in topbar clears auth and redirects back to /login', async () => {
    const user = userEvent.setup();
    const adminUser = seedUsers.find((u) => u.username === 'admin')!;
    renderWithProviders('/config/dns-lab/zones/zone-lab/records', adminUser);

    expect(await screen.findByText(adminUser.displayName)).toBeInTheDocument();

    const logoutBtn = screen.getByRole('button', { name: /log out/i });
    await user.click(logoutBtn);

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });
});
