// Theme model: two independent axes persisted to localStorage and applied as
// attributes on <html>. `data-theme` is always the resolved light|dark (never
// "auto") so tokens.css needs no prefers-color-scheme block; `data-accent`
// selects the accent ramp. The anti-flash script in index.html duplicates the
// keys and resolve logic below because it must run before this module loads.

export type ThemeMode = 'auto' | 'light' | 'dark';
export type Accent = 'steel' | 'green' | 'violet';

export const THEME_MODES: ThemeMode[] = ['auto', 'light', 'dark'];
export const ACCENTS: Accent[] = ['steel', 'green', 'violet'];

const MODE_KEY = 'b9m.theme.mode';
const ACCENT_KEY = 'b9m.theme.accent';

/** Effective theme. Mode wins over the OS; only "auto" defers to prefersDark. */
export function resolveTheme(mode: ThemeMode, prefersDark: boolean): 'light' | 'dark' {
  if (mode === 'auto') return prefersDark ? 'dark' : 'light';
  return mode;
}

export function loadMode(): ThemeMode {
  const v = readStorage(MODE_KEY);
  return v === 'light' || v === 'dark' || v === 'auto' ? v : 'auto';
}

export function loadAccent(): Accent {
  const v = readStorage(ACCENT_KEY);
  return v === 'steel' || v === 'green' || v === 'violet' ? v : 'steel';
}

export function saveMode(mode: ThemeMode): void {
  writeStorage(MODE_KEY, mode);
}

export function saveAccent(accent: Accent): void {
  writeStorage(ACCENT_KEY, accent);
}

/** Write the resolved attributes onto <html>. */
export function applyTheme(mode: ThemeMode, accent: Accent, prefersDark: boolean): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', resolveTheme(mode, prefersDark));
  root.setAttribute('data-accent', accent);
}

// localStorage can throw (private mode, disabled storage). Never let the theme
// crash the app over a preference read.
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ponytail: preference just isn't persisted; the in-memory state still works.
  }
}
