export class HttpError extends Error {
  status: number;
  error?: { code: string; message: string; field?: string; details?: unknown };

  constructor(status: number, message: string, error?: any) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.error = error;
  }
}

let currentToken: string | null = (function () {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem('bnd_token') : null;
  } catch {
    return null;
  }
})();

export function setAuthToken(token: string | null): void {
  currentToken = token;
}

export function getAuthToken(): string | null {
  return currentToken;
}

let customApiBase: string | null = null;
let customApiEnabled: boolean | null = null;

export function getApiBase(): string {
  if (customApiBase !== null) return customApiBase;
  const envBase = import.meta.env.VITE_API_BASE;
  return typeof envBase === 'string' ? envBase.trim().replace(/\/+$/, '') : '';
}

export function setApiBase(base: string | null): void {
  customApiBase = base;
}

export function isApiEnabled(): boolean {
  if (customApiEnabled !== null) return customApiEnabled;
  return Boolean(getApiBase());
}

export function setApiEnabled(enabled: boolean | null): void {
  customApiEnabled = enabled;
}

export const API_ENABLED = Boolean(import.meta.env.VITE_API_BASE);

export function resolveUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const base = getApiBase();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (!base) {
    return cleanPath;
  }
  // Avoid duplicate /api if base ends with /api and path starts with /api/
  if (base.endsWith('/api') && cleanPath.startsWith('/api/')) {
    return `${base.slice(0, -4)}${cleanPath}`;
  }
  return `${base}${cleanPath}`;
}

export async function apiFetch<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const url = resolveUrl(path);
  const headers = new Headers(opts?.headers);

  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  if (opts?.body && !headers.has('Content-Type') && typeof opts.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const token = getAuthToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, {
    ...opts,
    headers,
  });

  if (!res.ok) {
    let errorBody: any = null;
    try {
      errorBody = await res.json();
    } catch {
      // Body is not JSON
    }

    const message =
      errorBody?.error?.message ||
      errorBody?.message ||
      `HTTP error ${res.status}: ${res.statusText}`;

    throw new HttpError(res.status, message, errorBody?.error || errorBody);
  }

  if (res.status === 204) {
    return null as unknown as T;
  }

  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return (await res.json()) as T;
  }

  const text = await res.text();
  if (!text) {
    return null as unknown as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}
