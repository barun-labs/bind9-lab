import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import * as api from './apiAdapter';
import { makeStore } from './store';
import {
  HttpError,
  setApiEnabled,
  setApiBase,
  setAuthToken,
  getAuthToken,
} from './http';
import { AuthProvider, useAuth } from '../auth/AuthProvider';

/**
 * Adversarial pass over the real-backend path. Unlike apiAdapter.http.test.ts
 * (happy-path shapes), this file checks the boundaries: the fixture default,
 * full-base URL resolution, the /api dedup edge, error mapping, network
 * rejection, and the token lifecycle across the http module boundary.
 */
describe('apiAdapter HTTP adversarial', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    // Force default fixture mode until a test opts in.
    setApiEnabled(null);
    setApiBase(null);
    setAuthToken(null);
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
    mockFetch.mockReset();
  });

  afterEach(() => {
    setApiEnabled(null);
    setApiBase(null);
    setAuthToken(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('default fixture mode', () => {
    test('no adapter call touches fetch when VITE_API_BASE is unset', async () => {
      // Both the base and the enabled flag resolve to their unset defaults.
      expect(setApiBase(null)).toBeUndefined();
      expect(setApiEnabled(null)).toBeUndefined();
      setApiBase(null);
      setApiEnabled(null);

      const store = makeStore();

      const zones = await api.listZones(store, 'dns-lab');
      expect(mockFetch).not.toHaveBeenCalled();
      expect(zones.data.length).toBeGreaterThan(0);

      const configs = await api.listConfigurations(store, { page: 1, size: 50 });
      expect(mockFetch).not.toHaveBeenCalled();
      expect(configs.data.length).toBeGreaterThan(0);

      // Writes stay local in fixture mode.
      const record = await api.createRecord(store, 'zone-lab', {
        name: 'adversarial',
        type: 'A',
        ttl: 300,
        rdata: { address: '10.0.0.1' },
      });
      expect(mockFetch).not.toHaveBeenCalled();
      expect(record.id).toBeTruthy();
      expect(store.records.some((r) => r.name === 'adversarial')).toBe(true);
    });
  });

  describe('enabled path request shape', () => {
    beforeEach(() => {
      setApiEnabled(true);
      setAuthToken('token-abc-123');
    });

    test('listZones resolves a full absolute base and unwraps the envelope data', async () => {
      setApiBase('http://localhost:8080');

      const fakeZones = {
        data: [{ id: 'zone-lab', configurationId: 'dns-lab', name: 'lab.internal' }],
        page: 1,
        size: 50,
        total: 1,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => fakeZones,
      });

      const store = makeStore();
      const result = await api.listZones(store, 'dns-lab');

      const [calledUrl, calledOpts] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe('http://localhost:8080/api/v1/configurations/dns-lab/zones');
      expect(calledOpts.headers.get('Authorization')).toBe('Bearer token-abc-123');
      // The envelope is returned intact; the list lives in .data.
      expect(result.data).toEqual(fakeZones.data);
      expect(result.page).toBe(1);
      expect(result.total).toBe(1);
    });

    test('base ending in /api does not double up the /api segment', async () => {
      setApiBase('http://localhost:8080/api');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: [], page: 1, size: 50, total: 0 }),
      });

      await api.listZones(makeStore(), 'dns-lab');

      const [calledUrl] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe('http://localhost:8080/api/v1/configurations/dns-lab/zones');
    });

    test('createRecord POSTs to the right URL with a JSON body and auto content-type', async () => {
      setApiBase('http://localhost:8080');
      const fakeRecord = { id: 'rec-new', zoneId: 'zone-lab', name: 'mail', type: 'A' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => fakeRecord,
      });

      const result = await api.createRecord(makeStore(), 'zone-lab', {
        name: 'mail',
        type: 'A',
        ttl: 300,
        rdata: { address: '1.2.3.4' },
      });

      const [calledUrl, calledOpts] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe('http://localhost:8080/api/v1/zones/zone-lab/records');
      expect(calledOpts.method).toBe('POST');
      expect(calledOpts.headers.get('Content-Type')).toBe('application/json');
      expect(calledOpts.headers.get('Authorization')).toBe('Bearer token-abc-123');
      expect(JSON.parse(calledOpts.body)).toEqual({
        name: 'mail',
        type: 'A',
        ttl: 300,
        rdata: { address: '1.2.3.4' },
      });
      expect(result).toEqual(fakeRecord);
    });
  });

  describe('error mapping', () => {
    beforeEach(() => {
      setApiEnabled(true);
      setApiBase('http://localhost:8080');
      setAuthToken('token-abc-123');
    });

    test('non-2xx with {error:{message}} throws HttpError carrying status and payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          error: { code: 'FORBIDDEN', message: 'Insufficient permissions to view zones' },
        }),
      });

      const attempt = api.listZones(makeStore(), 'dns-lab');

      await expect(attempt).rejects.toBeInstanceOf(HttpError);
      await expect(attempt).rejects.toMatchObject({
        status: 403,
        error: { code: 'FORBIDDEN' },
      });
      await expect(attempt).rejects.toThrow('Insufficient permissions to view zones');
    });

    test('network rejection propagates as a rejection, never undefined', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await expect(api.listZones(makeStore(), 'dns-lab')).rejects.toThrow('Failed to fetch');
    });
  });

  describe('auth token lifecycle across the http boundary', () => {
    function AuthProbe({ probe }: { probe: Record<string, any> }) {
      const { currentUser, login, logout } = useAuth();
      probe.currentUser = currentUser;
      probe.login = login;
      probe.logout = logout;
      return null;
    }

    beforeEach(() => {
      setApiEnabled(true);
      setApiBase('http://localhost:8080');
      setAuthToken(null);
    });

    test('login stores the token and later adapter calls carry the bearer; logout clears it', async () => {
      // POST /sessions
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ token: 'session-token-xyz', expiresAt: '2026-08-16T00:00:00Z' }),
      });
      // GET /me
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          id: 'usr-admin',
          username: 'admin',
          displayName: 'Admin User',
          roles: [],
        }),
      });
      // listZones after login
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: [], page: 1, size: 50, total: 0 }),
      });
      // DELETE /sessions/current on logout
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers(),
      });
      // listZones after logout
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: [], page: 1, size: 50, total: 0 }),
      });

      const probe: Record<string, any> = {};
      render(React.createElement(AuthProvider, null, React.createElement(AuthProbe, { probe })));

      await act(async () => {
        await probe.login('admin', 'secret123');
      });

      // login POSTs /sessions then GETs /me with the new token.
      expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:8080/api/v1/sessions');
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
        username: 'admin',
        password: 'secret123',
      });
      expect(mockFetch.mock.calls[1][0]).toBe('http://localhost:8080/api/v1/me');
      expect(mockFetch.mock.calls[1][1].headers.get('Authorization')).toBe(
        'Bearer session-token-xyz'
      );
      expect(getAuthToken()).toBe('session-token-xyz');

      // A subsequent adapter call carries the token.
      await api.listZones(makeStore(), 'dns-lab');
      expect(mockFetch.mock.calls[2][1].headers.get('Authorization')).toBe(
        'Bearer session-token-xyz'
      );

      // logout revokes the session and drops the token.
      act(() => {
        probe.logout();
      });
      expect(getAuthToken()).toBeNull();
      expect(mockFetch.mock.calls[3][0]).toBe('http://localhost:8080/api/v1/sessions/current');
      expect(mockFetch.mock.calls[3][1].method).toBe('DELETE');

      // The next call carries no bearer.
      await api.listZones(makeStore(), 'dns-lab');
      expect(mockFetch.mock.calls[4][1].headers.get('Authorization')).toBeNull();
    });
  });
});
