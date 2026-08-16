import fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type Database from 'better-sqlite3';
import type { View } from '../../../shared/entities';
import { load } from 'js-yaml';
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
  listViews,
  getView,
  createView,
  updateView,
  deleteView,
  listZones,
  getZone,
  updateZone,
  deleteZone,
  createZone,
  listRecords,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,
  listExternalHosts,
  listServers,
  getServer,
  upsertServer,
  deleteServerById,
  buildConfigModel,
  listAcls,
  getAcl,
  createAcl,
  updateAcl,
  deleteAcl,
  type ZoneFilters,
  type RecordFilters,
} from './entityStore';
import {
  listLabs,
  getLab,
  createLab,
  updateLab,
  deleteLab,
  reconcileServersRuntime,
  isDnsLab,
  setLabLifecycle,
  markLabServersAbsent,
} from './labStore';
import { parseInspect, destroy } from './deployEngine';
import { snapshot } from './telemetry';
import { statisticsSnapshot } from './statistics';
import { runQuery, validateQuery } from './queryTool';
import { analyzeHealth } from './healthEngine';
import { evaluateAcl } from './aclEvaluator';
import {
  generateClabTopology,
  validateTopology,
  type NodeSpec,
  type LinkSpec,
  type TopologyModel,
} from '../config-engine/topology';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  generateServerConfig,
  validateConfig,
  type Runner,
} from '../config-engine';
import { shellQuote } from '../config-engine/shellQuote';
import {
  startDeployJob,
  getDeployJob,
  listDeployJobs,
} from './deployJobs';
import { registerFrontendStatic } from './static';

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor;
    token?: string;
  }
}

export interface AppOptions extends FastifyServerOptions {
  runner?: Runner;
  labDir?: string;
}

let defaultAppRunner: Runner | undefined = undefined;

const defaultFallbackRunner: Runner = (bashScript: string) => {
  return new Promise((resolve) => {
    const p = spawn('bash', ['-s']);
    let stdout = '';
    let stderr = '';

    p.stdout.on('data', (d: Buffer | string) => {
      stdout += d.toString();
    });
    p.stderr.on('data', (d: Buffer | string) => {
      stderr += d.toString();
    });
    p.on('error', (err: Error) => {
      resolve({ code: 1, stdout, stderr: stderr || err.message });
    });
    p.on('close', (code: number | null) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });

    p.stdin.write(bashScript);
    p.stdin.end();
  });
};

export function setDefaultAppRunner(runner: Runner | undefined): void {
  defaultAppRunner = runner;
}

export function buildApp(db: Database.Database, opts: AppOptions = {}): FastifyInstance {
  const activeRunner = opts.runner ?? defaultAppRunner ?? defaultFallbackRunner;
  const app = fastify(opts);

  app.decorateRequest('actor', null as unknown as Actor);
  app.decorateRequest('token', undefined);

  // Authentication hook for all routes except POST /api/v1/sessions
  app.addHook('onRequest', async (req, reply) => {
    const urlPath = req.url.split('?')[0];
    if (req.method === 'POST' && (urlPath === '/api/v1/sessions' || urlPath === '/api/v1/sessions/')) {
      return;
    }

    // Static frontend assets and SPA routes are not part of the API and
    // must never require auth — the React app itself enforces login.
    if (!urlPath.startsWith('/api/')) {
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

  // --- LAB CRUD ROUTES (DECLARATIVE-LAB TASK 1) ---

  // GET /api/v1/labs - List labs filtered by ?configurationId=
  app.get('/api/v1/labs', async (req, reply) => {
    const query = (req.query as any) || {};
    const configurationId = query.configurationId;
    if (configurationId) {
      if (!authorize(req.actor, 'view', configurationId)) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Forbidden' },
        });
      }
      const labs = listLabs(db, configurationId);
      return reply.status(200).send(labs);
    }

    const allLabs = listLabs(db);
    const visible = allLabs.filter((l) => authorize(req.actor, 'view', l.configurationId));
    return reply.status(200).send(visible);
  });

  // POST /api/v1/labs - Create a lab (requires edit)
  app.post('/api/v1/labs', async (req, reply) => {
    const body = req.body as any;
    if (
      !body ||
      typeof body !== 'object' ||
      typeof body.name !== 'string' ||
      typeof body.configurationId !== 'string' ||
      !body.topology ||
      typeof body.topology !== 'object'
    ) {
      return reply.status(400).send({
        error: { code: 'BAD_REQUEST', message: 'Invalid lab data' },
      });
    }

    if (!authorize(req.actor, 'edit', body.configurationId)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Forbidden' },
      });
    }

    const topoName = body.topology.name;
    if (typeof topoName !== 'string' || !/^[A-Za-z0-9_-]+$/.test(topoName)) {
      return reply.status(422).send({
        error: { code: 'INVALID_NAME', message: 'Topology name must only contain alphanumeric characters, underscores, and hyphens' },
      });
    }

    if (typeof body.name !== 'string' || /\.\.|\/|\\/.test(body.name)) {
      return reply.status(422).send({
        error: { code: 'INVALID_NAME', message: 'Lab name must not contain path traversal characters' },
      });
    }

    const lab = createLab(db, body);
    return reply.status(201).send(lab);
  });

  // GET /api/v1/labs/:id - Get a single lab
  app.get('/api/v1/labs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const lab = getLab(db, id);
    if (!lab) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Lab not found' },
      });
    }

    if (!authorize(req.actor, 'view', lab.configurationId)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Forbidden' },
      });
    }

    return reply.status(200).send(lab);
  });

  // GET /api/v1/configurations/:configId/servers - List servers for a configuration
  app.get('/api/v1/configurations/:configId/servers', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'view', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    return reply.status(200).send(listServers(db, configId));
  });

  // GET /api/v1/configurations/:configId/servers/:serverId - Get single server (scope-checked)
  app.get('/api/v1/configurations/:configId/servers/:serverId', async (req, reply) => {
    const { configId, serverId } = req.params as { configId: string; serverId: string };
    if (!authorize(req.actor, 'view', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const server = getServer(db, serverId);
    if (!server || server.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Server not found' } });
    }
    return reply.status(200).send(server);
  });

  // POST /api/v1/configurations/:configId/servers - Register a DNS server directly (requires edit)
  app.post('/api/v1/configurations/:configId/servers', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const body = (req.body ?? {}) as any;
    if (typeof body.hostname !== 'string' || !/^[A-Za-z0-9._-]+$/.test(body.hostname)) {
      return reply.status(422).send({ error: { code: 'INVALID_NAME', message: 'hostname must be a DNS-safe name ([A-Za-z0-9._-])' } });
    }
    if (body.nodeName !== undefined && (typeof body.nodeName !== 'string' || !/^[A-Za-z0-9_-]+$/.test(body.nodeName))) {
      return reply.status(422).send({ error: { code: 'INVALID_NAME', message: 'nodeName must be [A-Za-z0-9_-]' } });
    }
    const serviceInterfaces = Array.isArray(body.serviceInterfaces)
      ? body.serviceInterfaces
          .filter((i: any) => i && typeof i.address === 'string')
          .map((i: any) => ({ address: i.address, port: typeof i.port === 'number' ? i.port : 53 }))
      : [];
    const server = {
      id: 'srv-' + randomBytes(8).toString('hex'), // server-side ONLY
      configurationId: configId,
      hostname: body.hostname,
      name: typeof body.name === 'string' ? body.name : body.hostname,
      mgmtAddress: typeof body.mgmtAddress === 'string' ? body.mgmtAddress : undefined,
      image: typeof body.image === 'string' ? body.image : undefined,
      nodeName: typeof body.nodeName === 'string' ? body.nodeName : undefined,
      serviceInterfaces,
      adminState: body.adminState === 'DISABLED' ? 'DISABLED' : 'ENABLED',
      syncState: 'PENDING',
    };
    upsertServer(db, server);
    return reply.status(201).send(server);
  });

  // PATCH /api/v1/configurations/:configId/servers/:serverId - Update a server (scope-checked, requires edit)
  app.patch('/api/v1/configurations/:configId/servers/:serverId', async (req, reply) => {
    const { configId, serverId } = req.params as { configId: string; serverId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const existing = getServer(db, serverId);
    if (!existing || existing.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Server not found' } });
    }
    const body = (req.body ?? {}) as any;
    if (body.hostname !== undefined && (typeof body.hostname !== 'string' || !/^[A-Za-z0-9._-]+$/.test(body.hostname))) {
      return reply.status(422).send({ error: { code: 'INVALID_NAME', message: 'hostname must be a DNS-safe name' } });
    }
    if (body.nodeName !== undefined && (typeof body.nodeName !== 'string' || !/^[A-Za-z0-9_-]+$/.test(body.nodeName))) {
      return reply.status(422).send({ error: { code: 'INVALID_NAME', message: 'nodeName must be [A-Za-z0-9_-]' } });
    }
    const merged: any = { ...existing };
    for (const k of ['hostname', 'name', 'mgmtAddress', 'image', 'nodeName']) {
      if (body[k] !== undefined) merged[k] = body[k];
    }
    if (body.adminState !== undefined) {
      merged.adminState = body.adminState === 'DISABLED' ? 'DISABLED' : 'ENABLED';
    }
    if (Array.isArray(body.serviceInterfaces)) {
      merged.serviceInterfaces = body.serviceInterfaces
        .filter((i: any) => i && typeof i.address === 'string')
        .map((i: any) => ({ address: i.address, port: typeof i.port === 'number' ? i.port : 53 }));
    }
    merged.id = existing.id;                 // never change id
    merged.configurationId = configId;       // never change scope
    upsertServer(db, merged);
    return reply.status(200).send(merged);
  });

  // DELETE /api/v1/configurations/:configId/servers/:serverId - Delete a server (scope-checked, requires edit)
  app.delete('/api/v1/configurations/:configId/servers/:serverId', async (req, reply) => {
    const { configId, serverId } = req.params as { configId: string; serverId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const existing = getServer(db, serverId);
    if (!existing || existing.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Server not found' } });
    }
    deleteServerById(db, serverId);
    return reply.status(200).send({ deleted: true });
  });

  // GET /api/v1/configurations/:configId/views - List views for a configuration
  app.get('/api/v1/configurations/:configId/views', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'view', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    return reply.status(200).send(listViews(db, configId));
  });

  // GET /api/v1/configurations/:configId/views/:viewId - Get single view (scope-checked)
  app.get('/api/v1/configurations/:configId/views/:viewId', async (req, reply) => {
    const { configId, viewId } = req.params as { configId: string; viewId: string };
    if (!authorize(req.actor, 'view', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const view = getView(db, viewId);
    if (!view || view.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'View not found' } });
    }
    return reply.status(200).send(view);
  });

  // POST /api/v1/configurations/:configId/views - Create a view (requires edit)
  app.post('/api/v1/configurations/:configId/views', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const body = (req.body ?? {}) as any;
    const name = typeof body.name === 'string' ? body.name : '';
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      return reply.status(422).send({ error: { code: 'INVALID_NAME', message: 'name must be a DNS-safe name ([A-Za-z0-9._-])' } });
    }
    const view = createView(db, configId, { name, order: body.order, matchClients: body.matchClients });
    return reply.status(201).send(view);
  });

  // PATCH /api/v1/configurations/:configId/views/:viewId - Update a view (scope-checked, requires edit)
  app.patch('/api/v1/configurations/:configId/views/:viewId', async (req, reply) => {
    const { configId, viewId } = req.params as { configId: string; viewId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const existing = getView(db, viewId);
    if (!existing || existing.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'View not found' } });
    }
    const body = (req.body ?? {}) as any;
    if (body.name !== undefined && (typeof body.name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(body.name))) {
      return reply.status(422).send({ error: { code: 'INVALID_NAME', message: 'name must be a DNS-safe name ([A-Za-z0-9._-])' } });
    }
    const patch: Partial<View> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (typeof body.order === 'number') patch.order = body.order;
    if (Array.isArray(body.matchClients)) {
      patch.matchClients = body.matchClients.filter((c: unknown) => typeof c === 'string');
    }
    const updated = updateView(db, viewId, patch);
    return reply.status(200).send(updated);
  });

  // DELETE /api/v1/configurations/:configId/views/:viewId - Delete a view (scope-checked, requires edit)
  app.delete('/api/v1/configurations/:configId/views/:viewId', async (req, reply) => {
    const { configId, viewId } = req.params as { configId: string; viewId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const existing = getView(db, viewId);
    if (!existing || existing.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'View not found' } });
    }
    const zoneCount = (db.prepare('SELECT count(*) as cnt FROM zones WHERE viewId = ?').get(viewId) as { cnt: number }).cnt;
    if (zoneCount > 0) {
      return reply.status(409).send({ error: { code: 'HAS_DEPENDENTS', message: 'View has zones; delete them first' } });
    }
    const result = deleteView(db, viewId);
    return reply.status(200).send(result);
  });

  // GET /api/v1/configurations/:configId/acls - List ACLs for a configuration
  app.get('/api/v1/configurations/:configId/acls', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'view', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    return reply.status(200).send(listAcls(db, configId));
  });

  // GET /api/v1/configurations/:configId/acls/:aclId - Get single ACL (scope-checked)
  app.get('/api/v1/configurations/:configId/acls/:aclId', async (req, reply) => {
    const { configId, aclId } = req.params as { configId: string; aclId: string };
    if (!authorize(req.actor, 'view', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const acl = getAcl(db, aclId);
    if (!acl || acl.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'ACL not found' } });
    }
    return reply.status(200).send(acl);
  });

  // POST /api/v1/configurations/:configId/acls - Create an ACL (requires edit)
  app.post('/api/v1/configurations/:configId/acls', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const body = (req.body ?? {}) as any;
    const name = typeof body.name === 'string' ? body.name : '';
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      return reply.status(422).send({ error: { code: 'INVALID_NAME', message: 'name must be a DNS-safe name ([A-Za-z0-9._-])' } });
    }
    const acl = createAcl(db, configId, { name, entries: body.entries });
    return reply.status(201).send(acl);
  });

  // PATCH /api/v1/configurations/:configId/acls/:aclId - Update an ACL (scope-checked, requires edit)
  app.patch('/api/v1/configurations/:configId/acls/:aclId', async (req, reply) => {
    const { configId, aclId } = req.params as { configId: string; aclId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const existing = getAcl(db, aclId);
    if (!existing || existing.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'ACL not found' } });
    }
    const body = (req.body ?? {}) as any;
    if (body.name !== undefined && (typeof body.name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(body.name))) {
      return reply.status(422).send({ error: { code: 'INVALID_NAME', message: 'name must be a DNS-safe name ([A-Za-z0-9._-])' } });
    }
    const patch: { name?: string; entries?: unknown } = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.entries !== undefined) patch.entries = body.entries;
    const updated = updateAcl(db, aclId, patch);
    return reply.status(200).send(updated);
  });

  // DELETE /api/v1/configurations/:configId/acls/:aclId - Delete an ACL (scope-checked, requires edit)
  app.delete('/api/v1/configurations/:configId/acls/:aclId', async (req, reply) => {
    const { configId, aclId } = req.params as { configId: string; aclId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const existing = getAcl(db, aclId);
    if (!existing || existing.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'ACL not found' } });
    }
    const result = deleteAcl(db, aclId);
    return reply.status(200).send(result);
  });

  // POST /api/v1/configurations/:configId/acls/evaluate - Evaluate an ACL against a client IP (requires view)
  app.post('/api/v1/configurations/:configId/acls/evaluate', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'view', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const body = (req.body ?? {}) as any;
    const target = typeof body.target === 'string' ? body.target : '';
    if (!target) {
      return reply.status(422).send({ error: { code: 'INVALID_TARGET', message: 'target is required' } });
    }
    const clientIp = typeof body.clientIp === 'string' ? body.clientIp : '';
    if (!/^[0-9A-Fa-f:.]+$/.test(clientIp)) {
      return reply.status(422).send({ error: { code: 'INVALID_IP', message: 'clientIp must be a plausible IP address' } });
    }
    const result = evaluateAcl(listAcls(db, configId), target, clientIp);
    return reply.status(200).send(result);
  });

  // POST /api/v1/configurations/:configId/zones - Create a zone (requires edit)
  app.post('/api/v1/configurations/:configId/zones', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const body = (req.body ?? {}) as any;
    const name = typeof body.name === 'string' ? body.name : '';
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      return reply.status(422).send({ error: { code: 'INVALID_NAME', message: 'name must be a DNS-safe name ([A-Za-z0-9._-])' } });
    }
    if (typeof body.viewId !== 'string') {
      return reply.status(422).send({ error: { code: 'INVALID_VIEW', message: 'viewId must reference a view in this configuration' } });
    }
    const parentView = getView(db, body.viewId);
    if (!parentView || parentView.configurationId !== configId) {
      return reply.status(422).send({ error: { code: 'INVALID_VIEW', message: 'viewId must reference a view in this configuration' } });
    }
    const zone = createZone(db, configId, body);
    return reply.status(201).send(zone);
  });

  // GET /api/v1/configurations/:configId/search - Search zones/records/views/servers/external hosts (requires view)
  app.get('/api/v1/configurations/:configId/search', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'view', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const config = getConfiguration(db, configId);
    if (!config) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Configuration not found' } });
    }
    const rawQ = (req.query as any)?.q ?? '';
    const q = String(rawQ).toLowerCase().trim();
    const empty = { zones: [], records: [], views: [], servers: [], externalHosts: [] };
    if (!q) {
      return reply.status(200).send({ q: '', results: empty });
    }
    const model = buildConfigModel(db, configId);
    const cap = (arr: any[]): any[] => arr.slice(0, 25);
    const results = {
      zones: cap(model.zones.filter((z) => z.name.toLowerCase().includes(q) || z.id.toLowerCase().includes(q))),
      records: cap(model.records.filter((r) => {
        const rdataValues = r.rdata ? Object.values(r.rdata).join(' ') : '';
        return r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q) || rdataValues.toLowerCase().includes(q);
      })),
      views: cap(model.views.filter((v) => v.name.toLowerCase().includes(q) || v.id.toLowerCase().includes(q))),
      servers: cap(model.servers.filter((s) =>
        String(s.hostname ?? '').toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        String(s.nodeName ?? '').toLowerCase().includes(q)
      )),
      externalHosts: cap((model.externalHosts ?? []).filter((h) => h.fqdn.toLowerCase().includes(q) || h.id.toLowerCase().includes(q))),
    };
    return reply.status(200).send({ q: String(rawQ), results });
  });

  // PATCH /api/v1/labs/:id - Update a lab (requires edit)
  app.patch('/api/v1/labs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const lab = getLab(db, id);
    if (!lab) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Lab not found' },
      });
    }

    if (!authorize(req.actor, 'edit', lab.configurationId)) {
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

    if (body.configurationId && body.configurationId !== lab.configurationId) {
      if (!authorize(req.actor, 'edit', body.configurationId)) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Forbidden' },
        });
      }
    }

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || /\.\.|\/|\\/.test(body.name)) {
        return reply.status(422).send({
          error: { code: 'INVALID_NAME', message: 'Lab name must not contain path traversal characters' },
        });
      }
    }

    if (body.topology !== undefined) {
      if (
        !body.topology ||
        typeof body.topology !== 'object' ||
        typeof body.topology.name !== 'string' ||
        !/^[A-Za-z0-9_-]+$/.test(body.topology.name)
      ) {
        return reply.status(422).send({
          error: { code: 'INVALID_NAME', message: 'Topology name must only contain alphanumeric characters, underscores, and hyphens' },
        });
      }
    }

    const updated = updateLab(db, id, body);
    return reply.status(200).send(updated);
  });

  // DELETE /api/v1/labs/:id - Delete a lab (requires edit)
  app.delete('/api/v1/labs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const lab = getLab(db, id);
    if (!lab) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Lab not found' },
      });
    }

    if (!authorize(req.actor, 'edit', lab.configurationId)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Forbidden' },
      });
    }

    const result = deleteLab(db, id);
    return reply.status(200).send(result);
  });

  // --- DECLARATIVE-LAB TASK 2 ROUTES (RENDER, YAML, IMPORT, VALIDATE) ---

  // POST /api/v1/labs/import - Import a containerlab YAML into a Lab (requires edit)
  app.post('/api/v1/labs/import', async (req, reply) => {
    const body = req.body as any;
    if (
      !body ||
      typeof body !== 'object' ||
      typeof body.configurationId !== 'string' ||
      typeof body.yaml !== 'string'
    ) {
      return reply.status(400).send({
        error: { code: 'BAD_REQUEST', message: 'Missing configurationId or yaml in request body' },
      });
    }

    if (!authorize(req.actor, 'edit', body.configurationId)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Forbidden' },
      });
    }

    let doc: any;
    try {
      doc = load(body.yaml);
    } catch (err: any) {
      return reply.status(422).send({
        error: { code: 'BAD_YAML', message: err?.message || 'Invalid YAML' },
      });
    }

    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      return reply.status(422).send({
        error: { code: 'BAD_YAML', message: 'Parsed YAML must be a containerlab configuration object' },
      });
    }

    if (
      !doc.topology ||
      typeof doc.topology !== 'object' ||
      Array.isArray(doc.topology) ||
      !doc.topology.nodes ||
      typeof doc.topology.nodes !== 'object' ||
      Array.isArray(doc.topology.nodes)
    ) {
      return reply.status(422).send({
        error: { code: 'INVALID_TOPOLOGY', message: 'missing topology.nodes' },
      });
    }

    try {
      const rawDocName = doc.name !== undefined && doc.name !== null ? String(doc.name).trim() : '';
      const rawBodyName = body.name !== undefined && body.name !== null ? String(body.name).trim() : '';
      const topoName = rawDocName || rawBodyName || 'imported-lab';
      const labName = rawBodyName || rawDocName || 'imported-lab';

      if (!/^[A-Za-z0-9_-]+$/.test(topoName)) {
        return reply.status(422).send({
          error: { code: 'INVALID_NAME', message: 'Topology name must only contain alphanumeric characters, underscores, and hyphens' },
        });
      }

      if (/\.\.|\/|\\/.test(labName)) {
        return reply.status(422).send({
          error: { code: 'INVALID_NAME', message: 'Lab name must not contain path traversal characters' },
        });
      }

      const mgmtNetwork = doc.mgmt?.network;
      const mgmtSubnet = doc.mgmt?.['ipv4-subnet'] ?? doc.mgmt?.ipv4Subnet ?? doc.mgmt?.mgmtSubnet;

      const rawNodes = doc.topology.nodes;
      const nodes: NodeSpec[] = [];

      for (const [key, rawNodeVal] of Object.entries(rawNodes)) {
        const node = (rawNodeVal && typeof rawNodeVal === 'object' ? rawNodeVal : {}) as any;
        const nodeName = key;
        const rawKind = node.kind;
        const kind: 'linux' | 'bridge' = rawKind === 'bridge' ? 'bridge' : (rawKind || 'linux');

        // Router heuristic:
        // In containerlab topologies, nodes of kind 'bridge' represent L2 bridges (intent 'bridge').
        // Linux nodes are inferred as 'router' if they have IP forwarding enabled ('ip-forward' / ipForward
        // or sysctl net.ipv4.ip_forward) or if their name follows standard router naming (/router|^r\d/).
        // All other Linux nodes default to intent 'bind' (DNS server nodes).
        let intent: 'bind' | 'router' | 'bridge';
        if (kind === 'bridge') {
          intent = 'bridge';
        } else if (
          node['ip-forward'] ||
          node.ipForward ||
          (node.sysctls && node.sysctls['net.ipv4.ip_forward']) ||
          /router|^r\d/.test(nodeName)
        ) {
          intent = 'router';
        } else {
          intent = 'bind';
        }

        const nodeSpec: NodeSpec = {
          name: nodeName,
          kind,
          intent,
        };

        if (node.image !== undefined) {
          nodeSpec.image = String(node.image);
        }
        if (node['mgmt-ipv4'] !== undefined || node.mgmtIpv4 !== undefined) {
          nodeSpec.mgmtIpv4 = String(node['mgmt-ipv4'] ?? node.mgmtIpv4);
        }
        if (Array.isArray(node.binds)) {
          nodeSpec.binds = node.binds.map(String);
        }
        if (Array.isArray(node.interfaces)) {
          nodeSpec.interfaces = node.interfaces;
        }

        nodes.push(nodeSpec);
      }

      const rawLinks = doc.topology?.links;
      const links: LinkSpec[] = [];

      if (Array.isArray(rawLinks)) {
        for (const rawLink of rawLinks) {
          if (rawLink && typeof rawLink === 'object' && Array.isArray(rawLink.endpoints)) {
            links.push({
              endpoints: [rawLink.endpoints[0], rawLink.endpoints[1]],
            });
          } else {
            links.push(rawLink as any);
          }
        }
      }

      const topology: TopologyModel = {
        name: topoName,
        mgmtNetwork,
        mgmtSubnet,
        nodes,
        links,
      };

      const problems = validateTopology(topology);
      if (problems.length > 0) {
        return reply.status(422).send({
          error: { code: 'INVALID_TOPOLOGY', details: problems, message: 'Topology validation failed' },
        });
      }

      const lab = createLab(db, {
        name: labName,
        configurationId: body.configurationId,
        topology,
      });

      return reply.status(201).send(lab);
    } catch (err: any) {
      return reply.status(422).send({
        error: { code: 'INVALID_TOPOLOGY', message: err?.message || 'Topology processing failed' },
      });
    }
  });

  // POST /api/v1/labs/:id/render - Render containerlab YAML for a lab (requires view)
  app.post('/api/v1/labs/:id/render', async (req, reply) => {
    const { id } = req.params as { id: string };
    const lab = getLab(db, id);
    if (!lab) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Lab not found' },
      });
    }

    if (!authorize(req.actor, 'view', lab.configurationId)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Forbidden' },
      });
    }

    const yaml = generateClabTopology(lab.topology);
    return reply.status(200).send({ yaml });
  });

  // GET /api/v1/labs/:id/yaml - Get containerlab YAML as text/yaml (requires view)
  app.get('/api/v1/labs/:id/yaml', async (req, reply) => {
    const { id } = req.params as { id: string };
    const lab = getLab(db, id);
    if (!lab) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Lab not found' },
      });
    }

    if (!authorize(req.actor, 'view', lab.configurationId)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Forbidden' },
      });
    }

    const yaml = generateClabTopology(lab.topology);
    return reply.status(200).type('text/yaml').send(yaml);
  });

  // POST /api/v1/labs/:id/validate - Validate topology and BIND server configs (requires view)
  app.post('/api/v1/labs/:id/validate', async (req, reply) => {
    const { id } = req.params as { id: string };
    const lab = getLab(db, id);
    if (!lab) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Lab not found' },
      });
    }

    if (!authorize(req.actor, 'view', lab.configurationId)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Forbidden' },
      });
    }

    const topology = validateTopology(lab.topology);

    const configModel = buildConfigModel(db, lab.configurationId);

    const bindNodes = (lab.topology?.nodes || []).filter((n) => n.intent === 'bind');
    const perServer: Array<{
      serverId: string;
      ok: boolean;
      warnings?: string[];
      errors: string[];
    }> = [];

    for (const node of bindNodes) {
      const serverId = `srv-${lab.id}-${node.name}`;
      try {
        const serverConfig = generateServerConfig(configModel, serverId);
        const result = await validateConfig(serverConfig, activeRunner);
        perServer.push({
          serverId,
          ok: result.ok,
          warnings: result.warnings,
          errors: result.errors,
        });
      } catch (err: any) {
        perServer.push({
          serverId,
          ok: false,
          warnings: [],
          errors: [err?.message || String(err)],
        });
      }
    }

    return reply.status(200).send({
      topology,
      perServer,
    });
  });

  // POST /api/v1/labs/:id/deploy - Deploy a lab (requires deploy permission)
  app.post('/api/v1/labs/:id/deploy', async (req, reply) => {
    const { id } = req.params as { id: string };
    const lab = getLab(db, id);
    if (!lab) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Lab not found' },
      });
    }

    if (!authorize(req.actor, 'deploy', lab.configurationId)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Forbidden' },
      });
    }

    if (!isDnsLab(lab)) {
      return reply.status(422).send({
        error: { code: 'NOT_A_DNS_LAB', message: 'Bind9-Manager only manages DNS labs (labs with a bind node).' },
      });
    }

    const labDir = opts.labDir || `/home/lun/${lab.topology.name}`;

    const job = startDeployJob(db, lab, { run: activeRunner, labDir });
    return reply.status(201).send({ jobId: job.id });
  });

  // POST /api/v1/labs/:id/destroy - Tear down the lab's containers (requires deploy permission)
  app.post('/api/v1/labs/:id/destroy', async (req, reply) => {
    const { id } = req.params as { id: string };
    const lab = getLab(db, id);
    if (!lab) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Lab not found' } });
    }
    if (!authorize(req.actor, 'deploy', lab.configurationId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    if (!isDnsLab(lab)) {
      return reply.status(422).send({ error: { code: 'NOT_A_DNS_LAB', message: 'Bind9-Manager only manages DNS labs (labs with a bind node).' } });
    }
    const labDir = opts.labDir || `/home/lun/${lab.topology.name}`;
    const result = await destroy(activeRunner, labDir);
    if (!result.ok) {
      return reply.status(502).send({ error: { code: 'DESTROY_FAILED', message: result.output.slice(0, 500) } });
    }
    // Containers are gone — this is irreversible. Record the outcome best-effort:
    // never 500 after a successful destroy, or the caller can't tell it worked and
    // a retry would just re-run destroy against already-gone containers.
    let updated: typeof lab | null = lab;
    try {
      markLabServersAbsent(db, lab); // NODE_ABSENT, no bogus lastDeployedAt
      updated = setLabLifecycle(db, id, 'DESTROYED') ?? lab;
    } catch {
      // persistence failed after the teardown already happened; still report success
    }
    return reply.status(200).send({
      lab: updated,
      servers: listServers(db, lab.configurationId).filter((s) => s.id.startsWith('srv-' + lab.id + '-')),
    });
  });

  // GET /api/v1/deploy-jobs - List deploy jobs the actor may view (optional ?labId= filter)
  app.get('/api/v1/deploy-jobs', async (req, reply) => {
    const query = (req.query as any) || {};
    let jobs = listDeployJobs(db);
    if (query.labId) {
      const labId = String(query.labId);
      jobs = jobs.filter((j) => j.labId === labId);
    }
    // Scope to jobs whose lab's configuration the actor can view — a deploy job
    // is not config-scoped in storage, so authorize per job.
    jobs = jobs.filter((j) => {
      const lab = getLab(db, j.labId);
      return lab !== null && authorize(req.actor, 'view', lab.configurationId);
    });
    return reply.status(200).send({ data: jobs });
  });

  // GET /api/v1/deploy-jobs/:id - Get a deploy job status (requires view permission on the lab's configuration)
  app.get('/api/v1/deploy-jobs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = getDeployJob(db, id);
    if (!job) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Deploy job not found' },
      });
    }

    const lab = getLab(db, job.labId);
    if (!lab) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Lab not found' },
      });
    }

    if (!authorize(req.actor, 'view', lab.configurationId)) {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Forbidden' },
      });
    }

    return reply.status(200).send(job);
  });

  // --- TELEMETRY ROUTES (SECURITY-CRITICAL: see telemetry.ts) ---

  // GET /api/v1/labs/:id/telemetry - Point-in-time runtime snapshot (requires view)
  app.get('/api/v1/labs/:id/telemetry', async (req, reply) => {
    const { id } = req.params as { id: string };
    const lab = getLab(db, id);
    if (!lab) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Lab not found' },
      });
    }

    if (!authorize(req.actor, 'view', lab.configurationId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }

    if (!isDnsLab(lab)) {
      return reply.status(422).send({
        error: { code: 'NOT_A_DNS_LAB', message: 'Bind9-Manager only manages DNS labs (labs with a bind node).' },
      });
    }

    const labDir = opts.labDir || `/home/lun/${lab.topology.name}`;
    return reply.status(200).send(await snapshot(lab, activeRunner, labDir));
  });

  // GET /api/v1/labs/:id/statistics - Per-server BIND statistics snapshot (requires view; DNS-lab only)
  app.get('/api/v1/labs/:id/statistics', async (req, reply) => {
    const { id } = req.params as { id: string };
    const lab = getLab(db, id);
    if (!lab) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Lab not found' },
      });
    }

    if (!authorize(req.actor, 'view', lab.configurationId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }

    if (!isDnsLab(lab)) {
      return reply.status(422).send({
        error: { code: 'NOT_A_DNS_LAB', message: 'Bind9-Manager only manages DNS labs (labs with a bind node).' },
      });
    }

    const labDir = opts.labDir || `/home/lun/${lab.topology.name}`;
    return reply.status(200).send(await statisticsSnapshot(lab, activeRunner, labDir));
  });

  // POST /api/v1/labs/:id/query - run `dig` inside a bind node (requires view; DNS-lab only)
  app.post('/api/v1/labs/:id/query', async (req, reply) => {
    const { id } = req.params as { id: string };
    const lab = getLab(db, id);
    if (!lab) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Lab not found' },
      });
    }

    if (!authorize(req.actor, 'view', lab.configurationId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }

    if (!isDnsLab(lab)) {
      return reply.status(422).send({
        error: { code: 'NOT_A_DNS_LAB', message: 'Bind9-Manager only manages DNS labs (labs with a bind node).' },
      });
    }

    const bindNodes = (lab.topology?.nodes || []).filter((n) => n && n.intent === 'bind').map((n) => n.name);
    const v = validateQuery(req.body as any, bindNodes);
    if (!v.ok) {
      return reply.status(422).send({ error: { code: v.code, message: v.message } });
    }
    const result = await runQuery(lab, activeRunner, { ...(req.body as any), qtype: v.qtype });
    return reply.status(200).send(result);
  });

  // GET /api/v1/configurations/:configId/health - static config health analysis (requires view)
  app.get('/api/v1/configurations/:configId/health', async (req, reply) => {
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
    const findings = analyzeHealth(buildConfigModel(db, configId));
    return reply.status(200).send({ findings });
  });

  // GET /api/v1/labs/:id/telemetry/stream - Server-sent events, one snapshot every 2.5s (requires view)
  app.get('/api/v1/labs/:id/telemetry/stream', async (req, reply) => {
    const { id } = req.params as { id: string };
    const lab = getLab(db, id);
    if (!lab) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Lab not found' },
      });
    }

    if (!authorize(req.actor, 'view', lab.configurationId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }

    if (!isDnsLab(lab)) {
      return reply.status(422).send({
        error: { code: 'NOT_A_DNS_LAB', message: 'Bind9-Manager only manages DNS labs (labs with a bind node).' },
      });
    }

    const labDir = opts.labDir || `/home/lun/${lab.topology.name}`;

    // Hijack the raw socket so Fastify does not also try to send a reply —
    // an SSE stream owns the response for the life of the connection.
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    const send = async () => {
      try {
        reply.raw.write(`data: ${JSON.stringify(await snapshot(lab, activeRunner, labDir))}\n\n`);
      } catch {}
    };
    await send(); // first frame immediately
    const timer = setInterval(send, 2500);
    req.raw.on('close', () => {
      clearInterval(timer);
      try {
        reply.raw.end();
      } catch {}
    });
    return reply; // already hijacked
  });

  // GET /api/v1/labs/:id/nodes/:node/logs?tail=N - docker logs for one node (requires view)
  app.get('/api/v1/labs/:id/nodes/:node/logs', async (req, reply) => {
    const { id, node } = req.params as { id: string; node: string };
    const lab = getLab(db, id);
    if (!lab) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Lab not found' },
      });
    }

    if (!authorize(req.actor, 'view', lab.configurationId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }

    if (!isDnsLab(lab)) {
      return reply.status(422).send({
        error: { code: 'NOT_A_DNS_LAB', message: 'Bind9-Manager only manages DNS labs (labs with a bind node).' },
      });
    }

    // Defence 1: charset — a `:node` param that is not a bare identifier
    // can never become a shell/container argument, no matter what follows.
    if (!/^[A-Za-z0-9_-]+$/.test(node)) {
      return reply.status(400).send({
        error: { code: 'BAD_REQUEST', message: 'Invalid node name' },
      });
    }

    // Defence 2: membership — the authoritative gate. A syntactically valid
    // name that is not one of THIS lab's own topology nodes is rejected,
    // even though it already passed the charset check.
    const isLabNode = (lab.topology.nodes || []).some((n) => n && n.name === node);
    if (!isLabNode) {
      return reply.status(400).send({
        error: { code: 'BAD_REQUEST', message: 'Unknown node' },
      });
    }

    const tail = Math.min(1000, Math.max(1, Number((req.query as any).tail) || 200));

    // Defence 3: the container name is derived here, server-side, from the
    // lab's own topology name + the now-validated node name — never taken
    // from the raw request param — and shell-quoted before interpolation.
    const container = 'clab-' + lab.topology.name + '-' + node;
    const result = await activeRunner(`docker logs --tail ${tail} ${shellQuote(container)}`);
    return reply.type('text/plain').status(200).send(result.stdout || result.stderr || '');
  });

  // POST /api/v1/labs/:id/sync - Re-inspect runtime state without deploying (requires view)
  app.post('/api/v1/labs/:id/sync', async (req, reply) => {
    const { id } = req.params as { id: string };
    const lab = getLab(db, id);
    if (!lab) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Lab not found' },
      });
    }

    if (!authorize(req.actor, 'view', lab.configurationId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }

    if (!isDnsLab(lab)) {
      return reply.status(422).send({
        error: { code: 'NOT_A_DNS_LAB', message: 'Bind9-Manager only manages DNS labs (labs with a bind node).' },
      });
    }

    const labDir = opts.labDir || `/home/lun/${lab.topology.name}`;
    const insp = await activeRunner(
      `containerlab inspect -t ${shellQuote(labDir + '/topo.clab.yml')} --format json`,
    );

    const result =
      insp.code === 0
        ? { validated: [], runtime: parseInspect(insp.stdout) }
        : { validated: [], runtimeError: 'inspect exited ' + insp.code };

    reconcileServersRuntime(db, lab, result);

    return reply
      .status(200)
      .send(listServers(db, lab.configurationId).filter((s) => s.id.startsWith('srv-' + lab.id + '-')));
  });

  // Serve the built React frontend (bind9-manager/app/dist) on every other
  // GET, with SPA fallback to index.html. See ./static.ts.
  registerFrontendStatic(app);

  return app;
}
