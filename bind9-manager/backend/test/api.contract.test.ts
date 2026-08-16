import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';

// Converts a Fastify url to its OpenAPI path key (mirrors openapi.ts).
function toOpenApiPath(url: string): string {
  return url.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

describe('OpenAPI contract (integration)', () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    db = openDb(':memory:');
    app = buildApp(db);
  });

  it('serves /api/openapi.json 200 WITHOUT auth and produces a valid OpenAPI 3 doc', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');

    const doc = JSON.parse(res.body);
    expect(String(doc.openapi).startsWith('3.')).toBe(true);
    expect(doc.info.title).toBe('Bind9-Manager API');
    expect(doc.info.version).toBeTruthy();
    expect(Object.keys(doc.paths).length).toBeGreaterThan(0);
  });

  it('serves /api-docs 200 text/html WITHOUT auth, pointing at openapi.json', async () => {
    const res = await app.inject({ method: 'GET', url: '/api-docs' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('openapi.json');
  });

  it('documents every registered /api/v1 route (drift control)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/openapi.json' });
    const doc = JSON.parse(res.body);

    const apiRoutes = app.registeredRoutes.filter(
      (r) => r.url.startsWith('/api/v1') && r.method !== 'HEAD'
    );
    expect(apiRoutes.length).toBeGreaterThan(0);

    for (const route of apiRoutes) {
      const path = toOpenApiPath(route.url);
      const method = route.method.toLowerCase();
      const pathItem = doc.paths[path];
      expect(pathItem, `missing path ${path} in doc`).toBeDefined();
      expect(pathItem[method], `missing ${method} ${path} in doc`).toBeDefined();
    }
  });

  it('contains no leftover Fastify :param syntax in any path', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/openapi.json' });
    const doc = JSON.parse(res.body);
    for (const path of Object.keys(doc.paths)) {
      expect(path).not.toContain(':');
    }
  });
});
