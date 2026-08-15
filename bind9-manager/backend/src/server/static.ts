import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

// bind9-manager/backend/src/server/static.ts -> bind9-manager/app/dist
const DEFAULT_FRONTEND_DIST = path.resolve(
  fileURLToPath(new URL('../../../app/dist', import.meta.url))
);

/**
 * Serves the built React frontend (bind9-manager/app/dist) from the same
 * Fastify instance that serves /api/v1/*. Static files and the SPA
 * fallback are never subject to the API auth hook (see app.ts), so the
 * app shell always loads and lets client-side routing handle auth.
 */
export function registerFrontendStatic(
  app: FastifyInstance,
  distDir: string = process.env.BIND9_FRONTEND_DIST ?? DEFAULT_FRONTEND_DIST
): void {
  app.register(fastifyStatic, {
    root: distDir,
    prefix: '/',
    index: ['index.html'],
  });

  // SPA fallback: any GET that isn't under /api/ and doesn't match a static
  // file (e.g. /login, /config/dns-lab on a hard refresh) gets index.html
  // so client-side routing can take over. Unmatched /api/ requests keep the
  // normal JSON 404.
  app.setNotFoundHandler((req, reply) => {
    const urlPath = req.url.split('?')[0];
    if (req.method === 'GET' && !urlPath.startsWith('/api/')) {
      return reply.status(200).sendFile('index.html', distDir);
    }
    return reply.status(404).send({
      error: { code: 'NOT_FOUND', message: 'Not Found' },
    });
  });
}
