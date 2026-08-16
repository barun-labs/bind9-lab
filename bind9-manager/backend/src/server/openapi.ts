// Build an OpenAPI 3.0 document from Fastify's route table. The routes here
// are hand-written without JSON schemas, so @fastify/swagger would emit almost
// nothing; instead we render a browsable, categorized reference (endpoints,
// methods, path params, tags) straight from the registered routes.

export interface RouteRef {
  method: string;
  url: string;
}

// Routes that are part of the API surface but not of the documented /api/v1
// contract: the docs themselves and the health probe (if one exists).
const EXCLUDED_URLS = new Set(['/health', '/api/openapi.json', '/api-docs']);

// Static-file mounts (@fastify/static) register `/` and `/*`; those serve the
// frontend, not the API.
function isStaticRoute(url: string): boolean {
  return url === '/' || url.includes('*');
}

// Fastify `:param` segments -> OpenAPI `{param}` segments.
function toOpenApiPath(url: string): string {
  return url.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

// The deepest non-parameter path segment names the resource, e.g.
// /api/v1/configurations/{configId}/zones -> "zones". This is what groups the
// endpoints in Scalar's sidebar.
function resourceTag(url: string): string {
  const segments = toOpenApiPath(url)
    .split('/')
    .filter((segment) => segment !== '' && !/^\{[^}]+\}$/.test(segment));
  return segments[segments.length - 1] ?? 'api';
}

export function buildOpenApiDocument(routes: RouteRef[], version: string): object {
  const paths: Record<string, Record<string, unknown>> = {};
  const seen = new Set<string>();

  for (const route of routes) {
    const method = route.method.toLowerCase();
    // HEAD is auto-registered for every GET by Fastify; it is not part of the
    // documented surface.
    if (method === 'head') continue;
    if (EXCLUDED_URLS.has(route.url) || isStaticRoute(route.url)) continue;

    const path = toOpenApiPath(route.url);
    const key = `${method} ${path}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const parameters = Array.from(path.matchAll(/\{([^}]+)\}/g)).map((match) => ({
      name: match[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));

    const pathItem = paths[path] ?? {};
    pathItem[method] = {
      tags: [resourceTag(route.url)],
      ...(parameters.length > 0 ? { parameters } : {}),
      responses: { '200': { description: 'Success' } },
    };
    paths[path] = pathItem;
  }

  return {
    openapi: '3.0.3',
    info: { title: 'Bind9-Manager API', version },
    paths,
  };
}
