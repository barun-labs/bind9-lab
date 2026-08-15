import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import type { User, Permission } from '../types/entities';
import { seedUsers } from '../data/users.seed';
import { can as checkCan } from './can';
import { apiFetch, isApiEnabled, setAuthToken } from '../data/http';

export interface AuthContextValue {
  currentUser: User | null;
  login: (username: string, password?: string) => Promise<User>;
  logout: () => void;
  can: (permission: Permission, configId: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  children: ReactNode;
  initialUser?: User | null;
}

export function AuthProvider({ children, initialUser }: AuthProviderProps) {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    if (initialUser !== undefined) {
      return initialUser;
    }
    try {
      const storedToken = localStorage.getItem('bnd_token');
      if (storedToken) {
        setAuthToken(storedToken);
      }
      const stored = localStorage.getItem('bnd_user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const login = useCallback(async (username: string, password?: string): Promise<User> => {
    if (isApiEnabled()) {
      const trimmedUsername = username.trim();
      const session = await apiFetch<{ token: string; expiresAt: string }>('/api/v1/sessions', {
        method: 'POST',
        body: JSON.stringify({ username: trimmedUsername, password: password ?? '' }),
      });

      const token = session.token;
      setAuthToken(token);
      try {
        localStorage.setItem('bnd_token', token);
      } catch {
        // ignore
      }

      const me = await apiFetch<any>('/api/v1/me');
      const user: User = {
        id: me.id,
        username: me.username,
        displayName: me.displayName,
        isActive: me.isActive ?? true,
        roles: me.roles ?? [],
      };

      try {
        localStorage.setItem('bnd_user', JSON.stringify(user));
      } catch {
        // ignore
      }

      setCurrentUser(user);
      return user;
    }

    // mock: real password check is the backend's job
    const user = seedUsers.find(
      (u) => u.username.toLowerCase() === username.trim().toLowerCase()
    );
    if (!user) {
      throw new Error(`User "${username}" not found`);
    }

    try {
      localStorage.setItem('bnd_user', JSON.stringify(user));
    } catch {
      // ignore
    }
    setCurrentUser(user);
    return user;
  }, []);

  const logout = useCallback(() => {
    if (isApiEnabled()) {
      apiFetch('/api/v1/sessions/current', { method: 'DELETE' }).catch(() => {});
    }
    setAuthToken(null);
    try {
      localStorage.removeItem('bnd_token');
      localStorage.removeItem('bnd_user');
    } catch {
      // ignore
    }
    setCurrentUser(null);
  }, []);

  const can = useCallback(
    (permission: Permission, configId: string): boolean => {
      if (!currentUser) return false;
      return checkCan(currentUser, permission, configId);
    },
    [currentUser]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      currentUser,
      login,
      logout,
      can,
    }),
    [currentUser, login, logout, can]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
