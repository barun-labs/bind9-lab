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
      const stored = localStorage.getItem('bnd_user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const login = useCallback(async (username: string, _password?: string): Promise<User> => {
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
    try {
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
