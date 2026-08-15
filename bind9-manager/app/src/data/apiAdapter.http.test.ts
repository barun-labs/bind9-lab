import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as api from './apiAdapter';
import { makeStore } from './store';
import { setApiEnabled, setApiBase, setAuthToken } from './http';

describe('apiAdapter HTTP real-backend path', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    setApiEnabled(true);
    setApiBase('/api');
    setAuthToken('token-abc-123');
    mockFetch.mockReset();
  });

  afterEach(() => {
    setApiEnabled(null);
    setApiBase(null);
    setAuthToken(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('listZones issues GET with bearer token and returns response data', async () => {
    const fakeZonesEnvelope = {
      data: [
        {
          id: 'zone-lab',
          configurationId: 'cfg-lab',
          viewId: 'default',
          name: 'lab.internal',
          type: 'PRIMARY',
          soa: {
            primaryNs: 'ns1.lab.internal',
            adminEmail: 'admin.lab.internal',
            serial: 1,
            refresh: 3600,
            retry: 600,
            expire: 604800,
            minimum: 86400,
          },
          recordCount: 5,
          syncState: 'SYNCED',
        },
      ],
      page: 1,
      size: 10,
      total: 1,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => fakeZonesEnvelope,
    });

    const store = makeStore();
    const result = await api.listZones(store, 'cfg-lab', {
      view: 'default',
      type: 'PRIMARY',
      page: 1,
      size: 10,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOpts] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe('/api/v1/configurations/cfg-lab/zones?view=default&type=PRIMARY&page=1&size=10');
    expect(calledOpts.headers.get('Authorization')).toBe('Bearer token-abc-123');
    expect(calledOpts.headers.get('Accept')).toBe('application/json');
    expect(result).toEqual(fakeZonesEnvelope);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('lab.internal');
  });

  test('non-2xx response throws HttpError with error payload', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions to view zones',
        },
      }),
    });

    const store = makeStore();
    await expect(api.listZones(store, 'cfg-forbidden')).rejects.toThrow(
      'Insufficient permissions to view zones'
    );
  });

  test('listConfigurations issues GET /api/v1/configurations with query parameters', async () => {
    const fakeConfigsEnvelope = {
      data: [{ id: 'cfg-1', name: 'Config 1', isActive: true, createdAt: '', updatedAt: '', counts: { views: 1, zones: 1, records: 1, servers: 1 }, createdFromTemplateId: null }],
      page: 1,
      size: 50,
      total: 1,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => fakeConfigsEnvelope,
    });

    const store = makeStore();
    const result = await api.listConfigurations(store, { q: 'cfg', page: 1, size: 50, sort: 'name:asc' });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/configurations?q=cfg&page=1&size=50&sort=name%3Aasc',
      expect.objectContaining({
        headers: expect.any(Headers),
      })
    );
    expect(result).toEqual(fakeConfigsEnvelope);
  });

  test('getZone returns zone or null on 404', async () => {
    const fakeZone = { id: 'zone-1', name: 'example.com' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => fakeZone,
    });

    const store = makeStore();
    const found = await api.getZone(store, 'zone-1');
    expect(found).toEqual(fakeZone);

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: { code: 'NOT_FOUND', message: 'Zone not found' } }),
    });

    const notFound = await api.getZone(store, 'zone-unknown');
    expect(notFound).toBeNull();
  });

  test('listRecords issues GET to /api/v1/zones/:zoneId/records', async () => {
    const fakeRecords = {
      data: [{ id: 'rec-1', name: 'www', type: 'A', ttl: 300, rdata: { address: '1.2.3.4' } }],
      page: 1,
      size: 20,
      total: 1,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => fakeRecords,
    });

    const store = makeStore();
    const result = await api.listRecords(store, 'zone-1', { type: 'A', status: 'SYNCED', page: 1, size: 20 });

    const [calledUrl] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe('/api/v1/zones/zone-1/records?type=A&status=SYNCED&page=1&size=20');
    expect(result).toEqual(fakeRecords);
  });

  test('createRecord issues POST with JSON body', async () => {
    const fakeRecord = { id: 'rec-new', name: 'mail', type: 'A', ttl: 300, rdata: { address: '1.2.3.4' } };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => fakeRecord,
    });

    const store = makeStore();
    const result = await api.createRecord(store, 'zone-1', {
      name: 'mail',
      type: 'A',
      ttl: 300,
      rdata: { address: '1.2.3.4' },
    });

    const [calledUrl, calledOpts] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe('/api/v1/zones/zone-1/records');
    expect(calledOpts.method).toBe('POST');
    expect(JSON.parse(calledOpts.body)).toEqual({
      name: 'mail',
      type: 'A',
      ttl: 300,
      rdata: { address: '1.2.3.4' },
    });
    expect(result).toEqual(fakeRecord);
  });

  test('updateRecord and setRecordDisabled issue PATCH', async () => {
    const fakeUpdated = { id: 'rec-1', name: 'www', ttl: 600, disabled: true };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => fakeUpdated,
    });

    const store = makeStore();
    const result1 = await api.updateRecord(store, 'rec-1', { ttl: 600 });
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/records/rec-1');
    expect(mockFetch.mock.calls[0][1].method).toBe('PATCH');
    expect(result1).toEqual(fakeUpdated);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => fakeUpdated,
    });

    const result2 = await api.setRecordDisabled(store, 'rec-1', true);
    expect(mockFetch.mock.calls[1][0]).toBe('/api/v1/records/rec-1');
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({ disabled: true });
    expect(result2).toEqual(fakeUpdated);
  });

  test('deleteRecord issues DELETE', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ deleted: true }),
    });

    const store = makeStore();
    const result = await api.deleteRecord(store, 'rec-1');
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/records/rec-1');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    expect(result).toEqual({ deleted: true });
  });

  test('listExternalHosts issues GET /api/v1/configurations/:id/external-hosts', async () => {
    const fakeHosts = {
      data: [{ id: 'host-1', configurationId: 'cfg-1', fqdn: 'gw.internal', referenceCount: 2 }],
      page: 1,
      size: 50,
      total: 1,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => fakeHosts,
    });

    const store = makeStore();
    const result = await api.listExternalHosts(store, 'cfg-1');
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/configurations/cfg-1/external-hosts');
    expect(result).toEqual(fakeHosts);
  });

  test('API keys CRUD over HTTP', async () => {
    // List
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => [{ id: 'key-1', name: 'ci' }],
    });

    const store = makeStore();
    const listRes = await api.listApiKeys(store);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/api-keys');
    expect(listRes.data).toHaveLength(1);

    // Create
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ id: 'key-2', name: 'deploy', token: 'bnd_secret' }),
    });

    const createRes = await api.createApiKey(store, { name: 'deploy', scopes: ['read', 'deploy'] });
    expect(mockFetch.mock.calls[1][0]).toBe('/api/v1/api-keys');
    expect(mockFetch.mock.calls[1][1].method).toBe('POST');
    expect(createRes.token).toBe('bnd_secret');

    // Delete
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
      headers: new Headers(),
    });

    await api.deleteApiKey(store, 'key-2');
    expect(mockFetch.mock.calls[2][0]).toBe('/api/v1/api-keys/key-2');
    expect(mockFetch.mock.calls[2][1].method).toBe('DELETE');
  });
});

