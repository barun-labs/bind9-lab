import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from './AuthProvider';
import { setApiEnabled, setApiBase, setAuthToken, getAuthToken } from '../data/http';

function TestConsumer() {
  const { currentUser, login, logout } = useAuth();
  return (
    <div>
      <span data-testid="user">{currentUser ? currentUser.username : 'anonymous'}</span>
      <button onClick={() => login('admin', 'secret123')}>Log in</button>
      <button onClick={() => logout()}>Log out</button>
    </div>
  );
}

describe('AuthProvider HTTP real-backend path', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    setApiEnabled(true);
    setApiBase('/api');
    setAuthToken(null);
    window.localStorage.clear();
    mockFetch.mockReset();
  });

  afterEach(() => {
    setApiEnabled(null);
    setApiBase(null);
    setAuthToken(null);
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('login calls POST /api/v1/sessions then GET /api/v1/me and stores token', async () => {
    const user = userEvent.setup();

    // Mock POST /api/v1/sessions
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ token: 'session-token-xyz', expiresAt: '2026-08-16T00:00:00Z' }),
    });

    // Mock GET /api/v1/me
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: 'usr-admin',
        username: 'admin',
        displayName: 'Admin User',
        roles: [{ configurationId: 'cfg-lab', role: 'admin', canDeploy: true }],
        viaApiKey: false,
      }),
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    expect(screen.getByTestId('user')).toHaveTextContent('anonymous');

    await user.click(screen.getByRole('button', { name: /log in/i }));

    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify POST /api/v1/sessions call
    const [loginUrl, loginOpts] = mockFetch.mock.calls[0];
    expect(loginUrl).toBe('/api/v1/sessions');
    expect(loginOpts.method).toBe('POST');
    expect(JSON.parse(loginOpts.body)).toEqual({ username: 'admin', password: 'secret123' });

    // Verify GET /api/v1/me call with Authorization header
    const [meUrl, meOpts] = mockFetch.mock.calls[1];
    expect(meUrl).toBe('/api/v1/me');
    expect(meOpts.headers.get('Authorization')).toBe('Bearer session-token-xyz');

    // Verify token stored in localStorage and http client
    expect(window.localStorage.getItem('bnd_token')).toBe('session-token-xyz');
    expect(getAuthToken()).toBe('session-token-xyz');
    expect(screen.getByTestId('user')).toHaveTextContent('admin');
  });

  test('logout revokes session, clears token and user', async () => {
    const user = userEvent.setup();

    // Seed token and user
    window.localStorage.setItem('bnd_token', 'token-to-revoke');
    window.localStorage.setItem(
      'bnd_user',
      JSON.stringify({ id: 'usr-admin', username: 'admin', displayName: 'Admin User', roles: [] })
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
      headers: new Headers(),
    });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    expect(screen.getByTestId('user')).toHaveTextContent('admin');

    await user.click(screen.getByRole('button', { name: /log out/i }));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/sessions/current');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');

    expect(window.localStorage.getItem('bnd_token')).toBeNull();
    expect(window.localStorage.getItem('bnd_user')).toBeNull();
    expect(getAuthToken()).toBeNull();
    expect(screen.getByTestId('user')).toHaveTextContent('anonymous');
  });
});
