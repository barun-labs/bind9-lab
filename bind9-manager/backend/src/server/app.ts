import fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type Database from 'better-sqlite3';
import {
  login,
  resolveSession,
  revokeSession,
  createApiKey,
  resolveApiKey,
  listApiKeys,
  deleteApiKey,
} from './authStore';
import { authorize, type Actor } from './authorize';

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor;
    token?: string;
  }
}

export function buildApp(db: Database.Database, opts: FastifyServerOptions = {}): FastifyInstance {
  const app = fastify(opts);

  app.decorateRequest('actor', null as unknown as Actor);
  app.decorateRequest('token', undefined);

  // Authentication hook for all routes except POST /api/v1/sessions
  app.addHook('onRequest', async (req, reply) => {
    const urlPath = req.url.split('?')[0];
    if (req.method === 'POST' && (urlPath === '/api/v1/sessions' || urlPath === '/api/v1/sessions/')) {
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || typeof authHeader !== 'string') {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Missing Authorization header' },
      });
    }

    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match || !match[1].trim()) {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Invalid Authorization header format' },
      });
    }

    const token = match[1].trim();

    const sessionUser = resolveSession(db, token);
    if (sessionUser) {
      req.actor = { user: sessionUser };
      req.token = token;
      return;
    }

    const resolvedKey = resolveApiKey(db, token);
    if (resolvedKey) {
      req.actor = { user: resolvedKey.user, viaApiKey: resolvedKey.key };
      req.token = token;
      return;
    }

    return reply.status(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' },
    });
  });

  // POST /api/v1/sessions - Login (NO auth hook)
  app.post('/api/v1/sessions', async (req, reply) => {
    const body = req.body as any;
    if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' },
      });
    }

    const result = login(db, body.username, body.password);
    if (!result) {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' },
      });
    }

    return reply.status(200).send(result);
  });

  // DELETE /api/v1/sessions/current - Revoke presenting session token
  app.delete('/api/v1/sessions/current', async (req, reply) => {
    if (req.token) {
      revokeSession(db, req.token);
    }
    return reply.status(204).send();
  });

  // GET /api/v1/me - Return current actor info
  app.get('/api/v1/me', async (req, reply) => {
    return reply.status(200).send({
      id: req.actor.user.id,
      username: req.actor.user.username,
      displayName: req.actor.user.displayName,
      roles: req.actor.user.roles,
      viaApiKey: Boolean(req.actor.viaApiKey),
    });
  });

  // POST /api/v1/api-keys - Create API key (requires real user session)
  app.post('/api/v1/api-keys', async (req, reply) => {
    if (req.actor.viaApiKey) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'API keys cannot create API keys' },
      });
    }

    const body = req.body as any;
    if (!body || typeof body.name !== 'string' || !Array.isArray(body.scopes)) {
      return reply.status(400).send({
        error: { code: 'BAD_REQUEST', message: 'Invalid request body' },
      });
    }

    const { id, token } = createApiKey(db, req.actor.user.id, {
      name: body.name,
      scopes: body.scopes,
      readOnly: Boolean(body.readOnly),
      expiresAt: body.expiresAt ?? null,
    });

    const row = db
      .prepare(
        'SELECT id, name, ownerUserId, scopes, readOnly, expiresAt, lastUsedAt, createdAt FROM api_keys WHERE id = ?'
      )
      .get(id) as any;

    return reply.status(201).send({
      id: row.id,
      name: row.name,
      ownerUserId: row.ownerUserId,
      token,
      scopes: JSON.parse(row.scopes),
      readOnly: Boolean(row.readOnly),
      expiresAt: row.expiresAt,
      lastUsedAt: row.lastUsedAt,
      createdAt: row.createdAt,
    });
  });

  // GET /api/v1/api-keys - List current user's API keys (never leaks token/keyHash)
  app.get('/api/v1/api-keys', async (req, reply) => {
    const keys = listApiKeys(db, req.actor.user.id);
    return reply.status(200).send(keys);
  });

  // DELETE /api/v1/api-keys/:id - Delete API key (owner or admin)
  app.delete('/api/v1/api-keys/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db
      .prepare('SELECT id, ownerUserId FROM api_keys WHERE id = ?')
      .get(id) as { id: string; ownerUserId: string } | undefined;

    if (!row) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'API key not found' },
      });
    }

    // Read-only API key cannot perform deletions
    if (req.actor.viaApiKey && req.actor.viaApiKey.readOnly) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Read-only API key cannot delete' },
      });
    }

    const isOwner = row.ownerUserId === req.actor.user.id;
    const isAdmin = req.actor.user.roles.some((r) =>
      authorize(req.actor, 'admin', r.configurationId)
    );

    if (!isOwner && !isAdmin) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Forbidden' },
      });
    }

    deleteApiKey(db, id);
    return reply.status(204).send();
  });

  return app;
}
