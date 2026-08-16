import { describe, it, expect } from 'vitest';
import { buildOpenApiDocument } from '../src/server/openapi';

describe('buildOpenApiDocument', () => {
  it('converts a Fastify :param segment to {param} and emits a path parameter', () => {
    const doc = buildOpenApiDocument(
      [{ method: 'GET', url: '/api/v1/configurations/:configId' }],
      '1.0.0'
    ) as { paths: Record<string, any> };

    expect(doc.paths).toHaveProperty('/api/v1/configurations/{configId}');
    expect(doc.paths).not.toHaveProperty('/api/v1/configurations/:configId');

    const op = doc.paths['/api/v1/configurations/{configId}'].get;
    expect(op.parameters).toEqual([
      { name: 'configId', in: 'path', required: true, schema: { type: 'string' } },
    ]);
  });

  it('excludes /health, the doc routes, and static/wildcard routes', () => {
    const doc = buildOpenApiDocument(
      [
        { method: 'GET', url: '/api/v1/zones' },
        { method: 'GET', url: '/health' },
        { method: 'GET', url: '/api/openapi.json' },
        { method: 'GET', url: '/api-docs' },
        { method: 'GET', url: '/' },
        { method: 'GET', url: '/*' },
      ],
      '1.0.0'
    ) as { paths: Record<string, any> };

    expect(Object.keys(doc.paths)).toEqual(['/api/v1/zones']);
  });

  it('dedups method+path pairs', () => {
    const doc = buildOpenApiDocument(
      [
        { method: 'GET', url: '/api/v1/zones' },
        { method: 'GET', url: '/api/v1/zones' },
        { method: 'POST', url: '/api/v1/zones' },
      ],
      '1.0.0'
    ) as { paths: Record<string, any> };

    const pathItem = doc.paths['/api/v1/zones'];
    expect(Object.keys(pathItem).sort()).toEqual(['get', 'post']);
  });

  it('tags a nested resource route with the deepest non-param segment', () => {
    const doc = buildOpenApiDocument(
      [{ method: 'GET', url: '/api/v1/configurations/:configId/zones' }],
      '1.0.0'
    ) as { paths: Record<string, any> };

    expect(doc.paths['/api/v1/configurations/{configId}/zones'].get.tags).toEqual(['zones']);
  });
});
