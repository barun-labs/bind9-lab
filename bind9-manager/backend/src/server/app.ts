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
  safeParseJson,
} from './authStore';
import { authorize, type Actor } from './authorize';
import {
  listConfigurations,
  getConfiguration,
  listZones,
  getZone,
  updateZone,
  deleteZone,
  listRecords,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,
  listExternalHosts,
  type ZoneFilters,
  type RecordFilters,
} from './entityStore';

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
    if (req.actor.viaApiKey) {
      return reply.status(400).send({
        error: { code: 'NOT_A_SESSION', message: 'API keys cannot be revoked via session logout' },
      });
    }
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
      scopes: safeParseJson<('read' | 'write' | 'deploy')[]>(row.scopes, []),
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

  // --- CRUD ROUTES (SLICE 2b UNIT B) ---

  // GET /api/v1/configurations - List configurations visible to actor
  app.get('/api/v1/configurations', async (req, reply) => {
    const query = (req.query as any) || {};
    const allConfigs = listConfigurations(db);
    let items = allConfigs.filter((c) => authorize(req.actor, 'view', c.id));
    if (query.q) {
      const q = String(query.q).toLowerCase().trim();
      items = items.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q) ||
          (c.description && c.description.toLowerCase().includes(q))
      );
    }
    const total = items.length;
    const page = Math.max(1, Number(query.page) || 1);
    const size = Math.max(1, Number(query.size) || 50);
    const start = (page - 1) * size;
    const data = items.slice(start, start + size);
    return reply.status(200).send({ data, page, size, total });
  });

  // GET /api/v1/configurations/:configId/zones - List zones with filters
  app.get('/api/v1/configurations/:configId/zones', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'view', configId)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Forbidden' },
      });
    }
    const config = getConfiguration(db, configId);
    if (!config) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Configuration not found' },
      });
    }
    const query = (req.query as any) || {};
    const filters: ZoneFilters = {
      view: query.view,
      type: query.type,
      status: query.status,
      q: query.q,
      page: query.page ? Number(query.page) : undefined,
      size: query.size ? Number(query.size) : undefined,
      sort: query.sort,
    };
    const result = listZones(db, configId, filters);
    return reply.status(200).send(result);
  });

  // GET /api/v1/zones/:zoneId - Get single zone
  app.get('/api/v1/zones/:zoneId', async (req, reply) => {
    const { zoneId } = req.params as { zoneId: string };
    const zone = getZone(db, zoneId);
    if (!zone) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Zone not found' },
      });
    }
    if (!authorize(req.actor, 'view', zone.configurationId)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Forbidden' },
      });
    }
    return reply.status(200).send(zone);
  });

  // PATCH /api/v1/zones/:zoneId - Update zone (requires edit)
  app.patch('/api/v1/zones/:zoneId', async (req, reply) => {
    const { zoneId } = req.params as { zoneId: string };
    const zone = getZone(db, zoneId);
    if (!zone) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Zone not found' },
      });
    }
    if (!authorize(req.actor, 'edit', zone.configurationId)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Forbidden' },
      });
    }
    const body = req.body as any;
    if (!body || typeof body !== 'object') {
      return reply.status(400).send({
        error: { code: 'BAD_REQUEST', message: 'Invalid request body' },
      });
    }
    if (body.configurationId && body.configurationId !== zone.configurationId) {
      if (!authorize(req.actor, 'edit', body.configurationId)) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Forbidden' },
        });
      }
    }
    const updated = updateZone(db, zoneId, body);
    return reply.status(200).send(updated);
  });

  // DELETE /api/v1/zones/:zoneId - Delete zone (requires edit)
  app.delete('/api/v1/zones/:zoneId', async (req, reply) => {
    const { zoneId } = req.params as { zoneId: string };
    const zone = getZone(db, zoneId);
    if (!zone) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Zone not found' },
      });
    }
    if (!authorize(req.actor, 'edit', zone.configurationId)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Forbidden' },
      });
    }
    const result = deleteZone(db, zoneId);
    return reply.status(200).send(result);
  });

  // GET /api/v1/zones/:zoneId/records - List records in zone with filters
  app.get('/api/v1/zones/:zoneId/records', async (req, reply) => {
    const { zoneId } = req.params as { zoneId: string };
    const zone = getZone(db, zoneId);
    if (!zone) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Zone not found' },
      });
    }
    if (!authorize(req.actor, 'view', zone.configurationId)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Forbidden' },
      });
    }
    const query = (req.query as any) || {};
    const filters: RecordFilters = {
      type: query.type,
      status: query.status,
      q: query.q,
      page: query.page ? Number(query.page) : undefined,
      size: query.size ? Number(query.size) : undefined,
      sort: query.sort,
    };
    const result = listRecords(db, zoneId, filters);
    return reply.status(200).send(result);
  });

  // POST /api/v1/zones/:zoneId/records - Create record in zone (requires edit)
  app.post('/api/v1/zones/:zoneId/records', async (req, reply) => {
    const { zoneId } = req.params as { zoneId: string };
    const zone = getZone(db, zoneId);
    if (!zone) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Zone not found' },
      });
    }
    if (!authorize(req.actor, 'edit', zone.configurationId)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Forbidden' },
      });
    }
    const body = req.body as any;
    if (
      !body ||
      typeof body !== 'object' ||
      typeof body.name !== 'string' ||
      typeof body.type !== 'string' ||
      !body.rdata ||
      typeof body.rdata !== 'object'
    ) {
      return reply.status(400).send({
        error: { code: 'BAD_REQUEST', message: 'Invalid record data' },
      });
    }
    const record = createRecord(db, zoneId, body);
    return reply.status(201).send(record);
  });

  // PATCH /api/v1/records/:id - Update record (requires edit)
  app.patch('/api/v1/records/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const record = getRecord(db, id);
    if (!record) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Record not found' },
      });
    }
    const zone = getZone(db, record.zoneId);
    if (!zone) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Zone not found' },
      });
    }
    if (!authorize(req.actor, 'edit', zone.configurationId)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Forbidden' },
      });
    }
    const body = req.body as any;
    if (!body || typeof body !== 'object') {
      return reply.status(400).send({
        error: { code: 'BAD_REQUEST', message: 'Invalid request body' },
      });
    }
    if (body.zoneId && body.zoneId !== record.zoneId) {
      const targetZone = getZone(db, body.zoneId);
      if (!targetZone) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Target zone not found' },
        });
      }
      if (!authorize(req.actor, 'edit', targetZone.configurationId)) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Forbidden' },
        });
      }
    }
    const updated = updateRecord(db, id, body);
    return reply.status(200).send(updated);
  });

  // DELETE /api/v1/records/:id - Delete record (requires edit)
  app.delete('/api/v1/records/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const record = getRecord(db, id);
    if (!record) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Record not found' },
      });
    }
    const zone = getZone(db, record.zoneId);
    if (!zone) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Zone not found' },
      });
    }
    if (!authorize(req.actor, 'edit', zone.configurationId)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Forbidden' },
      });
    }
    const result = deleteRecord(db, id);
    return reply.status(200).send(result);
  });

  // GET /api/v1/configurations/:configId/external-hosts - List external hosts
  app.get('/api/v1/configurations/:configId/external-hosts', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'view', configId)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Forbidden' },
      });
    }
    const config = getConfiguration(db, configId);
    if (!config) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Configuration not found' },
      });
    }
    const query = (req.query as any) || {};
    let items = listExternalHosts(db, configId);
    if (query.q) {
      const q = String(query.q).toLowerCase().trim();
      items = items.filter(
        (h) => h.fqdn.toLowerCase().includes(q) || h.id.toLowerCase().includes(q)
      );
    }
    const total = items.length;
    const page = Math.max(1, Number(query.page) || 1);
    const size = Math.max(1, Number(query.size) || 50);
    const start = (page - 1) * size;
    const data = items.slice(start, start + size);
    return reply.status(200).send({ data, page, size, total });
  });

  return app;
}
