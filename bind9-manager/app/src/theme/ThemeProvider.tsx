import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  applyTheme,
  loadAccent,
  loadMode,
  saveAccent,
  saveMode,
  type Accent,
  type ThemeMode,
} from './theme';

interface ThemeContextValue {
  mode: ThemeMode;
  accent: Accent;
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: Accent) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(loadMode);
  const [accent, setAccentState] = useState<Accent>(loadAccent);

  // Apply on every change, and keep following the OS while mode is "auto".
  useEffect(() => {
    applyTheme(mode, accent, prefersDark());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme(mode, accent, mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode, accent]);

  const setMode = (next: ThemeMode) => {
    saveMode(next);
    setModeState(next);
  };
  const setAccent = (next: Accent) => {
    saveAccent(next);
    setAccentState(next);
  };

  return (
    <ThemeContext.Provider value={{ mode, accent, setMode, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
