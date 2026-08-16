import fastify, { type FastifyInstance, type FastifyServerOptions, type FastifyRequest, type FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import type { View, ChangeSetItem, ChangeSetObjectType, RecordTemplateEntry, RoleAssignment } from '../../../shared/entities';
import { load } from 'js-yaml';
import { validatePassword } from './crypto';
import {
  login,
  resolveSession,
  revokeSession,
  createApiKey,
  resolveApiKey,
  listApiKeys,
  deleteApiKey,
  safeParseJson,
  listUsers,
  getUserById,
  getUserByUsername,
  createUser,
  updateUser,
  deactivateUser,
  countActiveAdmins,
} from './authStore';
import { authorize, type Actor } from './authorize';
import { reconcileReverseForRecord, reconcileBlock } from './reverseSync';
import {
  listConfigurations,
  getConfiguration,
  createConfiguration,
  updateConfiguration,
  deleteConfiguration,
  cloneConfiguration,
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
  getExternalHost,
  createExternalHost,
  updateExternalHost,
  deleteExternalHost,
  listServerGroups,
  getServerGroup,
  createServerGroup,
  updateServerGroup,
  deleteServerGroup,
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
  listTsigKeys,
  getTsigKey,
  createTsigKey,
  updateTsigKey,
  deleteTsigKey,
  TSIG_ALGORITHMS,
  listRecordTemplates,
  getRecordTemplate,
  createRecordTemplate,
  updateRecordTemplate,
  deleteRecordTemplate,
  applyRecordTemplate,
  listDeploymentOptions,
  getDeploymentOption,
  createDeploymentOption,
  updateDeploymentOption,
  deleteDeploymentOption,
  listDeploymentRoles,
  getDeploymentRole,
  createDeploymentRole,
  updateDeploymentRole,
  deleteDeploymentRole,
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
import {
  listBlocks,
  getBlock,
  createBlock,
  updateBlock,
  deleteBlock,
  validateBlockHierarchy,
} from './blockStore';
import { parseCidr } from './ipv4';
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
  effectiveZoneOptions,
  effectiveZoneRoles,
  type Runner,
  type ConfigModel,
} from '../config-engine';
import { shellQuote } from '../config-engine/shellQuote';
import { OPTION_ALLOWLIST, SERVER_ROLES, validateOptionValue } from './deploymentOptions';
import {
  startDeployJob,
  getDeployJob,
  listDeployJobs,
} from './deployJobs';
import { computeChangeSet, diffLines, splitDiff } from './changeSet';
import {
  getBaselineModel,
  createDeployJob,
  getDeployJob as getChangeSetDeployJob,
} from './changeSetStore';
import { runChangeSetDeploy, runPreflight } from './changeSetDeploy';
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

// Render one server's generated file set as a single diffable text blob, with
// a stable file order and a per-file header line so the diff is legible.
function renderServerText(model: ConfigModel, serverId: string): string {
  const files = generateServerConfig(model, serverId);
  const parts: string[] = [];
  const entries = Object.entries(files).sort(([a], [b]) => a.localeCompare(b));
  for (const [filePath, content] of entries) {
    parts.push(`# ---- ${filePath} ----\n${content}`);
  }
  return parts.join('\n');
}

// An external host FQDN is emitted into zone-file record data that BIND parses,
// so reject anything that could break out of that context: letters/digits/dot/
// hyphen only, no empty or hyphen-edged labels, no '..', at most one trailing
// (root-anchored) dot.
// A server-group description is free text (the name becomes an identifier, the
// description does not) — trim and cap the length; only the type is enforced.
function normalizeDescription(value: unknown): { ok: true; value?: string } | { ok: false } {
  if (value === undefined) return { ok: true }; // not provided
  if (typeof value !== 'string') return { ok: false };
  return { ok: true, value: value.trim().slice(0, 256) };
}

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'NS', 'PTR', 'CAA', 'ALIAS'];
const RECORD_LABEL_RE = /^[A-Za-z0-9._@*-]+$/;

// Record-template entry names become labels in generated zone-file content, so
// they are held to a tight charset with an explicit '..' traversal rejection.
function validateRecordTemplateEntries(value: unknown): RecordTemplateEntry[] | null {
  if (!Array.isArray(value)) return null;
  for (const e of value) {
    if (!e || typeof e !== 'object') return null;
    const name = (e as { name?: unknown }).name;
    const type = (e as { type?: unknown }).type;
    if (typeof name !== 'string' || name.length === 0 || name.includes('..') || !RECORD_LABEL_RE.test(name)) return null;
    if (typeof type !== 'string' || !RECORD_TYPES.includes(type)) return null;
    const rdata = (e as { rdata?: unknown }).rdata;
    if (rdata === undefined || rdata === null || typeof rdata !== 'object' || Array.isArray(rdata)) return null;
    const ttl = (e as { ttl?: unknown }).ttl;
    if (ttl !== undefined && (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl < 0)) return null;
  }
  return value as RecordTemplateEntry[];
}

const USER_ROLE_NAMES = ['viewer', 'editor', 'admin'];

// Each role's configurationId must reference a real configuration, so this
// takes db to validate against getConfiguration.
function validateUserRoles(db: Database.Database, value: unknown): RoleAssignment[] | null {
  if (!Array.isArray(value)) return null;
  const roles: RoleAssignment[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;
    const configurationId = (entry as { configurationId?: unknown }).configurationId;
    const role = (entry as { role?: unknown }).role;
    const canDeploy = (entry as { canDeploy?: unknown }).canDeploy;
    if (typeof configurationId !== 'string' || !configurationId) return null;
    if (typeof role !== 'string' || !USER_ROLE_NAMES.includes(role)) return null;
    if (typeof canDeploy !== 'boolean') return null;
    if (!getConfiguration(db, configurationId)) return null;
    roles.push({ configurationId, role: role as RoleAssignment['role'], canDeploy });
  }
  return roles;
}

function isValidExternalFqdn(fqdn: string): boolean {
  if (typeof fqdn !== 'string' || fqdn.length < 1 || fqdn.length > 253) return false;
  if (!/^[A-Za-z0-9.-]+$/.test(fqdn)) return false;
  let body = fqdn;
  if (body.endsWith('.')) body = body.slice(0, -1); // strip at most one trailing dot
  if (body.length === 0 || body.startsWith('.') || body.endsWith('.')) return false;
  if (body.includes('..')) return false;
  const labels = body.split('.');
  for (const label of labels) {
    if (label.length === 0 || label.startsWith('-') || label.endsWith('-')) return false;
  }
  return true;
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
    const isAdmin = (req.actor.user.roles ?? []).some((r) =>
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

  // POST /api/v1/configurations - Create a configuration (admin-only)
  app.post('/api/v1/configurations', async (req, reply) => {
    // ponytail: no global-admin predicate exists; gate on admin role on ANY config
    const isAdmin = (req.actor.user.roles ?? []).some((r) =>
      authorize(req.actor, 'admin', r.configurationId)
    );
    if (!isAdmin) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const body = (req.body ?? {}) as any;
    const name = typeof body.name === 'string' ? body.name : '';
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      return reply.status(422).send({ error: { code: 'INVALID_NAME', message: 'Invalid configuration name' } });
    }
    const all = listConfigurations(db);
    if (all.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      return reply.status(409).send({ error: { code: 'CONFLICT', message: 'A configuration with this name already exists' } });
    }
    const id = typeof body.id === 'string' && body.id ? body.id : undefined;
    if (id && all.some((c) => c.id === id)) {
      return reply.status(409).send({ error: { code: 'CONFLICT', message: 'A configuration with this id already exists' } });
    }
    const config = createConfiguration(db, { name, id });
    return reply.status(201).send(config);
  });

  // PATCH /api/v1/configurations/:configId - Rename / toggle a configuration (requires edit)
  app.patch('/api/v1/configurations/:configId', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const config = getConfiguration(db, configId);
    if (!config) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Configuration not found' } });
    }
    const body = (req.body ?? {}) as any;
    const patch: { name?: string; isActive?: boolean } = {};
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name : '';
      if (!/^[A-Za-z0-9._-]+$/.test(name)) {
        return reply.status(422).send({ error: { code: 'INVALID_NAME', message: 'Invalid configuration name' } });
      }
      const dup = listConfigurations(db).some(
        (c) => c.id !== configId && c.name.toLowerCase() === name.toLowerCase()
      );
      if (dup) {
        return reply.status(409).send({ error: { code: 'CONFLICT', message: 'A configuration with this name already exists' } });
      }
      patch.name = name;
    }
    if (body.isActive !== undefined) {
      patch.isActive = Boolean(body.isActive);
    }
    const updated = updateConfiguration(db, configId, patch);
    return reply.status(200).send(updated);
  });

  // DELETE /api/v1/configurations/:configId - Delete a configuration (requires edit; refuses the last remaining)
  app.delete('/api/v1/configurations/:configId', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const config = getConfiguration(db, configId);
    if (!config) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Configuration not found' } });
    }
    if (listConfigurations(db).length <= 1) {
      return reply.status(409).send({ error: { code: 'LAST_CONFIG', message: 'Cannot delete the only configuration' } });
    }
    const result = deleteConfiguration(db, configId);
    return reply.status(200).send(result);
  });

  // POST /api/v1/configurations/:configId/clone - Deep-copy a configuration into a new one (admin-only)
  app.post('/api/v1/configurations/:configId/clone', async (req, reply) => {
    // ponytail: same admin-on-any-config predicate as POST /configurations
    const isAdmin = (req.actor.user.roles ?? []).some((r) =>
      authorize(req.actor, 'admin', r.configurationId)
    );
    if (!isAdmin) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const { configId } = req.params as { configId: string };
    const source = getConfiguration(db, configId);
    if (!source) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Configuration not found' } });
    }
    const body = (req.body ?? {}) as any;
    const name = typeof body.name === 'string' ? body.name : '';
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      return reply.status(422).send({ error: { code: 'INVALID_NAME', message: 'Invalid configuration name' } });
    }
    const all = listConfigurations(db);
    if (all.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      return reply.status(409).send({ error: { code: 'CONFLICT', message: 'A configuration with this name already exists' } });
    }
    const cloned = cloneConfiguration(db, configId, name);
    return reply.status(201).send(cloned);
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
    reconcileReverseForRecord(db, record, 'CREATE');
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
    reconcileReverseForRecord(db, updated, 'UPDATE');
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
    reconcileReverseForRecord(db, record, 'DELETE');
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

  // POST /api/v1/configurations/:configId/external-hosts - Create an external host (requires edit)
  app.post('/api/v1/configurations/:configId/external-hosts', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const config = getConfiguration(db, configId);
    if (!config) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Configuration not found' } });
    }
    const body = (req.body ?? {}) as any;
    const fqdn = typeof body.fqdn === 'string' ? body.fqdn : '';
    if (!isValidExternalFqdn(fqdn)) {
      return reply.status(422).send({ error: { code: 'INVALID_FQDN', message: 'fqdn must be a valid DNS name' } });
    }
    const dup = listExternalHosts(db, configId).find(
      (h) => h.fqdn.toLowerCase() === fqdn.toLowerCase()
    );
    if (dup) {
      return reply.status(409).send({ error: { code: 'CONFLICT', message: 'An external host with this FQDN already exists' } });
    }
    const host = createExternalHost(db, configId, { fqdn });
    return reply.status(201).send(host);
  });

  // PATCH /api/v1/configurations/:configId/external-hosts/:hostId - Update an external host (scope-checked, requires edit)
  app.patch('/api/v1/configurations/:configId/external-hosts/:hostId', async (req, reply) => {
    const { configId, hostId } = req.params as { configId: string; hostId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const existing = getExternalHost(db, hostId);
    if (!existing || existing.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'External host not found' } });
    }
    const body = (req.body ?? {}) as any;
    const patch: { fqdn?: string } = {};
    if (body.fqdn !== undefined) {
      if (typeof body.fqdn !== 'string' || !isValidExternalFqdn(body.fqdn)) {
        return reply.status(422).send({ error: { code: 'INVALID_FQDN', message: 'fqdn must be a valid DNS name' } });
      }
      const dup = listExternalHosts(db, configId).find(
        (h) => h.id !== hostId && h.fqdn.toLowerCase() === body.fqdn.toLowerCase()
      );
      if (dup) {
        return reply.status(409).send({ error: { code: 'CONFLICT', message: 'An external host with this FQDN already exists' } });
      }
      patch.fqdn = body.fqdn;
    }
    const updated = updateExternalHost(db, hostId, patch);
    return reply.status(200).send(updated);
  });

  // DELETE /api/v1/configurations/:configId/external-hosts/:hostId - Delete an external host (scope-checked, requires edit)
  app.delete('/api/v1/configurations/:configId/external-hosts/:hostId', async (req, reply) => {
    const { configId, hostId } = req.params as { configId: string; hostId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const existing = getExternalHost(db, hostId);
    if (!existing || existing.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'External host not found' } });
    }
    if (existing.referenceCount > 0) {
      return reply.status(409).send({ error: { code: 'HAS_DEPENDENTS', message: 'External host is referenced by records' } });
    }
    const result = deleteExternalHost(db, hostId);
    return reply.status(200).send(result);
  });

  // --- SERVER GROUPS ROUTES (BLUECAT GAP #53) ---

  // GET /api/v1/configurations/:configId/groups - List server groups for a configuration
  app.get('/api/v1/configurations/:configId/groups', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'view', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const config = getConfiguration(db, configId);
    if (!config) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Configuration not found' } });
    }
    return reply.status(200).send(listServerGroups(db, configId));
  });

  // GET /api/v1/configurations/:configId/groups/:groupId - Get single server group (scope-checked)
  app.get('/api/v1/configurations/:configId/groups/:groupId', async (req, reply) => {
    const { configId, groupId } = req.params as { configId: string; groupId: string };
    if (!authorize(req.actor, 'view', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const group = getServerGroup(db, groupId);
    if (!group || group.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Server group not found' } });
    }
    return reply.status(200).send(group);
  });

  // POST /api/v1/configurations/:configId/groups - Create a server group (requires edit)
  app.post('/api/v1/configurations/:configId/groups', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const config = getConfiguration(db, configId);
    if (!config) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Configuration not found' } });
    }
    const body = (req.body ?? {}) as any;
    const name = typeof body.name === 'string' ? body.name : '';
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      return reply.status(422).send({ error: { code: 'INVALID_NAME', message: 'name must be [A-Za-z0-9._-]' } });
    }
    const description = normalizeDescription(body.description);
    if (!description.ok) {
      return reply.status(422).send({ error: { code: 'INVALID_DESCRIPTION', message: 'description must be a string' } });
    }
    const dup = listServerGroups(db, configId).find((g) => g.name.toLowerCase() === name.toLowerCase());
    if (dup) {
      return reply.status(409).send({ error: { code: 'CONFLICT', message: 'A server group with this name already exists' } });
    }
    const group = createServerGroup(db, configId, { name, description: description.value });
    return reply.status(201).send(group);
  });

  // PATCH /api/v1/configurations/:configId/groups/:groupId - Update a server group (scope-checked, requires edit)
  app.patch('/api/v1/configurations/:configId/groups/:groupId', async (req, reply) => {
    const { configId, groupId } = req.params as { configId: string; groupId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const existing = getServerGroup(db, groupId);
    if (!existing || existing.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Server group not found' } });
    }
    const body = (req.body ?? {}) as any;
    const patch: { name?: string; description?: string } = {};
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(body.name)) {
        return reply.status(422).send({ error: { code: 'INVALID_NAME', message: 'name must be [A-Za-z0-9._-]' } });
      }
      const dup = listServerGroups(db, configId).find(
        (g) => g.id !== groupId && g.name.toLowerCase() === body.name.toLowerCase()
      );
      if (dup) {
        return reply.status(409).send({ error: { code: 'CONFLICT', message: 'A server group with this name already exists' } });
      }
      patch.name = body.name;
    }
    if (body.description !== undefined) {
      const description = normalizeDescription(body.description);
      if (!description.ok) {
        return reply.status(422).send({ error: { code: 'INVALID_DESCRIPTION', message: 'description must be a string' } });
      }
      patch.description = description.value;
    }
    const updated = updateServerGroup(db, groupId, patch);
    return reply.status(200).send(updated);
  });

  // DELETE /api/v1/configurations/:configId/groups/:groupId - Delete a server group (scope-checked, requires edit)
  app.delete('/api/v1/configurations/:configId/groups/:groupId', async (req, reply) => {
    const { configId, groupId } = req.params as { configId: string; groupId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const existing = getServerGroup(db, groupId);
    if (!existing || existing.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Server group not found' } });
    }
    const hasMembers = listServers(db, configId).some((s) => s.serverGroupId === groupId);
    if (hasMembers) {
      return reply.status(409).send({ error: { code: 'HAS_DEPENDENTS', message: 'Server group has members' } });
    }
    const result = deleteServerGroup(db, groupId);
    return reply.status(200).send(result);
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

  // --- TSIG KEYS ROUTES (BLUECAT GAP #52) ---

  // GET /api/v1/configurations/:configId/tsig-keys - List TSIG keys for a configuration (secrets omitted)
  app.get('/api/v1/configurations/:configId/tsig-keys', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'view', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const config = getConfiguration(db, configId);
    if (!config) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Configuration not found' } });
    }
    return reply.status(200).send(listTsigKeys(db, configId));
  });

  // GET /api/v1/configurations/:configId/tsig-keys/:keyId - Get single TSIG key (scope-checked, secret omitted)
  app.get('/api/v1/configurations/:configId/tsig-keys/:keyId', async (req, reply) => {
    const { configId, keyId } = req.params as { configId: string; keyId: string };
    if (!authorize(req.actor, 'view', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const key = getTsigKey(db, keyId);
    if (!key || key.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'TSIG key not found' } });
    }
    return reply.status(200).send(key);
  });

  // POST /api/v1/configurations/:configId/tsig-keys - Create a TSIG key (requires edit); returns the secret once
  app.post('/api/v1/configurations/:configId/tsig-keys', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const config = getConfiguration(db, configId);
    if (!config) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Configuration not found' } });
    }
    const body = (req.body ?? {}) as any;
    const name = typeof body.name === 'string' ? body.name : '';
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      return reply.status(422).send({ error: { code: 'INVALID_NAME', message: 'name must be a DNS-safe name ([A-Za-z0-9._-])' } });
    }
    const algorithm = typeof body.algorithm === 'string' ? body.algorithm : '';
    if (!TSIG_ALGORITHMS.includes(algorithm)) {
      return reply.status(422).send({ error: { code: 'INVALID_ALGORITHM', message: `algorithm must be one of: ${TSIG_ALGORITHMS.join(', ')}` } });
    }
    const dup = listTsigKeys(db, configId).find((k) => k.name.toLowerCase() === name.toLowerCase());
    if (dup) {
      return reply.status(409).send({ error: { code: 'CONFLICT', message: 'A TSIG key with this name already exists' } });
    }
    // Any client-supplied secret is ignored; createTsigKey generates it server-side.
    const key = createTsigKey(db, configId, { name, algorithm });
    return reply.status(201).send(key);
  });

  // PATCH /api/v1/configurations/:configId/tsig-keys/:keyId - Update a TSIG key (scope-checked, requires edit)
  app.patch('/api/v1/configurations/:configId/tsig-keys/:keyId', async (req, reply) => {
    const { configId, keyId } = req.params as { configId: string; keyId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const existing = getTsigKey(db, keyId);
    if (!existing || existing.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'TSIG key not found' } });
    }
    const body = (req.body ?? {}) as any;
    const patch: { name?: string; algorithm?: string } = {};
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(body.name)) {
        return reply.status(422).send({ error: { code: 'INVALID_NAME', message: 'name must be a DNS-safe name ([A-Za-z0-9._-])' } });
      }
      const dup = listTsigKeys(db, configId).find(
        (k) => k.id !== keyId && k.name.toLowerCase() === body.name.toLowerCase()
      );
      if (dup) {
        return reply.status(409).send({ error: { code: 'CONFLICT', message: 'A TSIG key with this name already exists' } });
      }
      patch.name = body.name;
    }
    if (body.algorithm !== undefined) {
      if (typeof body.algorithm !== 'string' || !TSIG_ALGORITHMS.includes(body.algorithm)) {
        return reply.status(422).send({ error: { code: 'INVALID_ALGORITHM', message: `algorithm must be one of: ${TSIG_ALGORITHMS.join(', ')}` } });
      }
      patch.algorithm = body.algorithm;
    }
    const updated = updateTsigKey(db, keyId, patch);
    return reply.status(200).send(updated);
  });

  // DELETE /api/v1/configurations/:configId/tsig-keys/:keyId - Delete a TSIG key (scope-checked, requires edit)
  app.delete('/api/v1/configurations/:configId/tsig-keys/:keyId', async (req, reply) => {
    const { configId, keyId } = req.params as { configId: string; keyId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const existing = getTsigKey(db, keyId);
    if (!existing || existing.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'TSIG key not found' } });
    }
    const referenced = listAcls(db, configId).some((acl) =>
      acl.entries.some((e) => e.type === 'KEY_NAME' && e.value === existing.name)
    );
    if (referenced) {
      return reply.status(409).send({ error: { code: 'HAS_DEPENDENTS', message: 'TSIG key is referenced by an ACL' } });
    }
    const result = deleteTsigKey(db, keyId);
    return reply.status(200).send(result);
  });

  // --- RECORD TEMPLATES ROUTES (BLUECAT GAP #55) ---

  // GET /api/v1/configurations/:configId/record-templates - List record templates
  app.get('/api/v1/configurations/:configId/record-templates', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'view', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const config = getConfiguration(db, configId);
    if (!config) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Configuration not found' } });
    }
    return reply.status(200).send(listRecordTemplates(db, configId));
  });

  // GET /api/v1/configurations/:configId/record-templates/:templateId - Get single template (scope-checked)
  app.get('/api/v1/configurations/:configId/record-templates/:templateId', async (req, reply) => {
    const { configId, templateId } = req.params as { configId: string; templateId: string };
    if (!authorize(req.actor, 'view', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const template = getRecordTemplate(db, templateId);
    if (!template || template.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Record template not found' } });
    }
    return reply.status(200).send(template);
  });

  // POST /api/v1/configurations/:configId/record-templates - Create a record template (requires edit)
  app.post('/api/v1/configurations/:configId/record-templates', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const config = getConfiguration(db, configId);
    if (!config) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Configuration not found' } });
    }
    const body = (req.body ?? {}) as any;
    const name = typeof body.name === 'string' ? body.name : '';
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      return reply.status(422).send({ error: { code: 'INVALID_NAME', message: 'name must be [A-Za-z0-9._-]' } });
    }
    const description = normalizeDescription(body.description);
    if (!description.ok) {
      return reply.status(422).send({ error: { code: 'INVALID_DESCRIPTION', message: 'description must be a string' } });
    }
    const entries = body.entries !== undefined ? validateRecordTemplateEntries(body.entries) : [];
    if (entries === null) {
      return reply.status(422).send({ error: { code: 'INVALID_ENTRY', message: 'entries must each have a safe name and a valid type' } });
    }
    const template = createRecordTemplate(db, configId, { name, description: description.value, entries });
    return reply.status(201).send(template);
  });

  // PATCH /api/v1/configurations/:configId/record-templates/:templateId - Update a template (scope-checked, requires edit)
  app.patch('/api/v1/configurations/:configId/record-templates/:templateId', async (req, reply) => {
    const { configId, templateId } = req.params as { configId: string; templateId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const existing = getRecordTemplate(db, templateId);
    if (!existing || existing.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Record template not found' } });
    }
    const body = (req.body ?? {}) as any;
    const patch: { name?: string; description?: string; entries?: RecordTemplateEntry[] } = {};
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(body.name)) {
        return reply.status(422).send({ error: { code: 'INVALID_NAME', message: 'name must be [A-Za-z0-9._-]' } });
      }
      patch.name = body.name;
    }
    if (body.description !== undefined) {
      const description = normalizeDescription(body.description);
      if (!description.ok) {
        return reply.status(422).send({ error: { code: 'INVALID_DESCRIPTION', message: 'description must be a string' } });
      }
      patch.description = description.value;
    }
    if (body.entries !== undefined) {
      const entries = validateRecordTemplateEntries(body.entries);
      if (entries === null) {
        return reply.status(422).send({ error: { code: 'INVALID_ENTRY', message: 'entries must each have a safe name and a valid type' } });
      }
      patch.entries = entries;
    }
    const updated = updateRecordTemplate(db, templateId, patch);
    return reply.status(200).send(updated);
  });

  // DELETE /api/v1/configurations/:configId/record-templates/:templateId - Delete a template (scope-checked, requires edit)
  app.delete('/api/v1/configurations/:configId/record-templates/:templateId', async (req, reply) => {
    const { configId, templateId } = req.params as { configId: string; templateId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const existing = getRecordTemplate(db, templateId);
    if (!existing || existing.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Record template not found' } });
    }
    const result = deleteRecordTemplate(db, templateId);
    return reply.status(200).send(result);
  });

  // POST /api/v1/configurations/:configId/record-templates/:templateId/apply - Apply a template to a zone (requires edit)
  app.post('/api/v1/configurations/:configId/record-templates/:templateId/apply', async (req, reply) => {
    const { configId, templateId } = req.params as { configId: string; templateId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const template = getRecordTemplate(db, templateId);
    if (!template || template.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Record template not found' } });
    }
    const body = (req.body ?? {}) as any;
    const zoneId = typeof body.zoneId === 'string' ? body.zoneId : '';
    const zone = zoneId ? getZone(db, zoneId) : null;
    if (!zone || zone.configurationId !== configId) {
      return reply.status(422).send({ error: { code: 'ZONE_NOT_IN_CONFIG', message: 'Zone not found in this configuration' } });
    }
    const created = applyRecordTemplate(db, templateId, zoneId);
    return reply.status(201).send({ created });
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

  // --- NETWORK BLOCKS ROUTES (IPAM #57) ---

  app.get('/api/v1/configurations/:configId/blocks', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'view', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    if (!getConfiguration(db, configId)) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Configuration not found' } });
    }
    return reply.status(200).send(listBlocks(db, configId));
  });

  app.get('/api/v1/configurations/:configId/blocks/:blockId', async (req, reply) => {
    const { configId, blockId } = req.params as { configId: string; blockId: string };
    if (!authorize(req.actor, 'view', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const block = getBlock(db, blockId);
    if (!block || block.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Block not found' } });
    }
    return reply.status(200).send(block);
  });

  app.post('/api/v1/configurations/:configId/blocks', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    if (!getConfiguration(db, configId)) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Configuration not found' } });
    }
    const body = (req.body ?? {}) as any;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 128) {
      return reply.status(422).send({ error: { code: 'INVALID_NAME', message: 'name must be 1-128 chars' } });
    }
    if (typeof body.cidr !== 'string' || !parseCidr(body.cidr)) {
      return reply.status(422).send({ error: { code: 'INVALID_CIDR', message: 'cidr must be a valid IPv4 CIDR' } });
    }
    if (body.kind !== 'BLOCK' && body.kind !== 'NETWORK') {
      return reply.status(422).send({ error: { code: 'INVALID_KIND', message: "kind must be 'BLOCK' or 'NETWORK'" } });
    }
    const parentBlockId = typeof body.parentBlockId === 'string' ? body.parentBlockId : null;
    if (body.kind === 'NETWORK') {
      if (typeof body.viewId !== 'string' || !getView(db, body.viewId) || getView(db, body.viewId)!.configurationId !== configId) {
        return reply.status(422).send({ error: { code: 'INVALID_VIEW', message: 'NETWORK requires a viewId in this configuration' } });
      }
    }
    const hierarchy = validateBlockHierarchy(db, configId, { cidr: body.cidr, kind: body.kind, parentBlockId });
    if (!hierarchy.ok) {
      return reply.status(422).send({ error: { code: hierarchy.code, message: 'Block violates the hierarchy rules' } });
    }
    const block = createBlock(db, configId, { name, cidr: body.cidr, kind: body.kind, parentBlockId, viewId: body.kind === 'NETWORK' ? body.viewId : undefined });
    return reply.status(201).send(block);
  });

  app.patch('/api/v1/configurations/:configId/blocks/:blockId', async (req, reply) => {
    const { configId, blockId } = req.params as { configId: string; blockId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const existing = getBlock(db, blockId);
    if (!existing || existing.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Block not found' } });
    }
    const body = (req.body ?? {}) as any;
    const patch: { name?: string; cidr?: string; parentBlockId?: string | null; viewId?: string } = {};
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 128) return reply.status(422).send({ error: { code: 'INVALID_NAME', message: 'name must be 1-128 chars' } });
      patch.name = name;
    }
    if (body.cidr !== undefined) {
      if (typeof body.cidr !== 'string' || !parseCidr(body.cidr)) return reply.status(422).send({ error: { code: 'INVALID_CIDR', message: 'cidr must be a valid IPv4 CIDR' } });
      patch.cidr = body.cidr;
    }
    if (body.parentBlockId !== undefined) patch.parentBlockId = typeof body.parentBlockId === 'string' ? body.parentBlockId : null;
    if (body.viewId !== undefined) patch.viewId = body.viewId;
    const next = { id: existing.id, cidr: patch.cidr ?? existing.cidr, kind: existing.kind, parentBlockId: patch.parentBlockId !== undefined ? patch.parentBlockId : existing.parentBlockId };
    const hierarchy = validateBlockHierarchy(db, configId, next);
    if (!hierarchy.ok) return reply.status(422).send({ error: { code: hierarchy.code, message: 'Block violates the hierarchy rules' } });
    const updated = updateBlock(db, blockId, patch);
    return reply.status(200).send(updated);
  });

  app.delete('/api/v1/configurations/:configId/blocks/:blockId', async (req, reply) => {
    const { configId, blockId } = req.params as { configId: string; blockId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const existing = getBlock(db, blockId);
    if (!existing || existing.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Block not found' } });
    }
    const hasChildren = listBlocks(db, configId).some((b) => b.parentBlockId === blockId);
    if (hasChildren) {
      return reply.status(422).send({ error: { code: 'HAS_CHILDREN', message: 'Delete or reparent child blocks first' } });
    }
    return reply.status(200).send(deleteBlock(db, blockId));
  });

  app.post('/api/v1/configurations/:configId/blocks/:blockId/reconcile', async (req, reply) => {
    const { configId, blockId } = req.params as { configId: string; blockId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const block = getBlock(db, blockId);
    if (!block || block.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Block not found' } });
    }
    if (block.kind !== 'NETWORK') {
      return reply.status(422).send({ error: { code: 'NOT_A_NETWORK', message: 'Only a NETWORK can be reconciled' } });
    }
    return reply.status(200).send(reconcileBlock(db, blockId));
  });

  // --- DEPLOYMENT OPTIONS ROUTES (IA-4) ---

  // GET /api/v1/configurations/:configId/options - List deployment options (optional ?scope=&scopeId= filter)
  app.get('/api/v1/configurations/:configId/options', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'view', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const query = (req.query as any) || {};
    let rows = listDeploymentOptions(db, configId);
    const scope = String(query.scope ?? '').toUpperCase();
    if (scope === 'VIEW' || scope === 'ZONE') {
      rows = rows.filter((r) => r.scope === scope);
      if (query.scopeId !== undefined) {
        const scopeId = String(query.scopeId);
        rows = rows.filter((r) => r.scopeId === scopeId);
      }
    }
    return reply.status(200).send(rows);
  });

  // POST /api/v1/configurations/:configId/options - Create a deployment option (requires edit)
  app.post('/api/v1/configurations/:configId/options', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const body = (req.body ?? {}) as any;
    const scope = body.scope;
    const scopeId = typeof body.scopeId === 'string' ? body.scopeId : '';
    const key = typeof body.key === 'string' ? body.key : '';
    const disabled = body.disabled === true;

    if (scope !== 'VIEW' && scope !== 'ZONE') {
      return reply.status(422).send({ error: { code: 'INVALID_SCOPE', message: 'scope must be VIEW or ZONE' } });
    }
    if (!(key in OPTION_ALLOWLIST)) {
      return reply.status(422).send({ error: { code: 'UNKNOWN_OPTION_KEY', message: `Unknown option key: ${key}` } });
    }
    if (!OPTION_ALLOWLIST[key].scopes.includes(scope)) {
      return reply.status(422).send({ error: { code: 'INVALID_SCOPE', message: `Option ${key} is not valid at ${scope} scope` } });
    }
    if (scope === 'VIEW') {
      const view = getView(db, scopeId);
      if (!view || view.configurationId !== configId) {
        return reply.status(422).send({ error: { code: 'INVALID_SCOPE_ID', message: 'scopeId must reference a view in this configuration' } });
      }
    } else {
      const zone = getZone(db, scopeId);
      if (!zone || zone.configurationId !== configId) {
        return reply.status(422).send({ error: { code: 'INVALID_SCOPE_ID', message: 'scopeId must reference a zone in this configuration' } });
      }
    }
    const dup = listDeploymentOptions(db, configId).find(
      (o) => o.scope === scope && o.scopeId === scopeId && o.key === key,
    );
    if (dup) {
      return reply.status(409).send({ error: { code: 'CONFLICT', message: `Option ${key} already exists at ${scope} scope` } });
    }
    if (!disabled) {
      const v = validateOptionValue(key, body.value);
      if (!v.ok) {
        return reply.status(422).send({ error: { code: 'VALIDATION_ERROR', message: `Invalid value for ${key}`, field: v.field } });
      }
    }
    const option = createDeploymentOption(db, configId, {
      scope,
      scopeId,
      key,
      value: disabled ? null : body.value,
      disabled,
    });
    return reply.status(201).send(option);
  });

  // PATCH /api/v1/configurations/:configId/options/:optionId - Update value/disabled (requires edit)
  app.patch('/api/v1/configurations/:configId/options/:optionId', async (req, reply) => {
    const { configId, optionId } = req.params as { configId: string; optionId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const existing = getDeploymentOption(db, optionId);
    if (!existing || existing.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Deployment option not found' } });
    }
    const body = (req.body ?? {}) as any;
    if (!body || typeof body !== 'object') {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'Invalid request body' } });
    }
    const patch: { value?: unknown; disabled?: boolean } = {};
    if (body.value !== undefined) patch.value = body.value;
    if (body.disabled !== undefined) patch.disabled = Boolean(body.disabled);
    const disabled = patch.disabled ?? existing.disabled;
    if (body.value !== undefined && !disabled) {
      const v = validateOptionValue(existing.key, body.value);
      if (!v.ok) {
        return reply.status(422).send({ error: { code: 'VALIDATION_ERROR', message: `Invalid value for ${existing.key}`, field: v.field } });
      }
    }
    const updated = updateDeploymentOption(db, optionId, patch);
    return reply.status(200).send(updated);
  });

  // DELETE /api/v1/configurations/:configId/options/:optionId - Delete a deployment option (requires edit)
  app.delete('/api/v1/configurations/:configId/options/:optionId', async (req, reply) => {
    const { configId, optionId } = req.params as { configId: string; optionId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const existing = getDeploymentOption(db, optionId);
    if (!existing || existing.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Deployment option not found' } });
    }
    deleteDeploymentOption(db, optionId);
    return reply.status(204).send();
  });

  // GET /api/v1/configurations/:configId/zones/:zoneId/effective-options - Resolved per-zone options (requires view)
  app.get('/api/v1/configurations/:configId/zones/:zoneId/effective-options', async (req, reply) => {
    const { configId, zoneId } = req.params as { configId: string; zoneId: string };
    if (!authorize(req.actor, 'view', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const zone = getZone(db, zoneId);
    if (!zone || zone.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Zone not found' } });
    }
    return reply.status(200).send(effectiveZoneOptions(buildConfigModel(db, configId), zone.viewId, zoneId));
  });

  // --- DEPLOYMENT ROLES ROUTES (IA-5) ---

  // GET /api/v1/configurations/:configId/roles - List deployment roles (optional ?scope=&scopeId= filter)
  app.get('/api/v1/configurations/:configId/roles', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'view', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const query = (req.query as any) || {};
    let rows = listDeploymentRoles(db, configId);
    const scope = String(query.scope ?? '').toUpperCase();
    if (scope === 'VIEW' || scope === 'ZONE') {
      rows = rows.filter((r) => r.scope === scope);
      if (query.scopeId !== undefined) {
        const scopeId = String(query.scopeId);
        rows = rows.filter((r) => r.scopeId === scopeId);
      }
    }
    return reply.status(200).send(rows);
  });

  // POST /api/v1/configurations/:configId/roles - Create a deployment role (requires edit)
  app.post('/api/v1/configurations/:configId/roles', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const body = (req.body ?? {}) as any;
    const scope = body.scope;
    const scopeId = typeof body.scopeId === 'string' ? body.scopeId : '';
    const serverId = typeof body.serverId === 'string' ? body.serverId : '';
    const role = typeof body.role === 'string' ? body.role : '';
    const disabled = body.disabled === true;

    if (scope !== 'VIEW' && scope !== 'ZONE') {
      return reply.status(422).send({ error: { code: 'INVALID_SCOPE', message: 'scope must be VIEW or ZONE' } });
    }
    if (!SERVER_ROLES.includes(role)) {
      return reply.status(422).send({ error: { code: 'INVALID_ROLE', message: `role must be one of ${SERVER_ROLES.join(', ')}` } });
    }
    if (scope === 'VIEW') {
      const view = getView(db, scopeId);
      if (!view || view.configurationId !== configId) {
        return reply.status(422).send({ error: { code: 'INVALID_SCOPE_ID', message: 'scopeId must reference a view in this configuration' } });
      }
    } else {
      const zone = getZone(db, scopeId);
      if (!zone || zone.configurationId !== configId) {
        return reply.status(422).send({ error: { code: 'INVALID_SCOPE_ID', message: 'scopeId must reference a zone in this configuration' } });
      }
    }
    const serverExists = listServers(db, configId).some((s) => s.id === serverId);
    if (!serverExists) {
      return reply.status(422).send({ error: { code: 'INVALID_SERVER_ID', message: 'serverId must reference a server in this configuration' } });
    }
    const dup = listDeploymentRoles(db, configId).find(
      (r) => r.scope === scope && r.scopeId === scopeId && r.serverId === serverId,
    );
    if (dup) {
      return reply.status(409).send({ error: { code: 'CONFLICT', message: `A role for this server already exists at ${scope} scope` } });
    }
    const created = createDeploymentRole(db, configId, { scope, scopeId, serverId, role, disabled });
    return reply.status(201).send(created);
  });

  // PATCH /api/v1/configurations/:configId/roles/:roleId - Update role/disabled (requires edit)
  app.patch('/api/v1/configurations/:configId/roles/:roleId', async (req, reply) => {
    const { configId, roleId } = req.params as { configId: string; roleId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const existing = getDeploymentRole(db, roleId);
    if (!existing || existing.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Deployment role not found' } });
    }
    const body = (req.body ?? {}) as any;
    if (!body || typeof body !== 'object') {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'Invalid request body' } });
    }
    const patch: { role?: string; disabled?: boolean } = {};
    if (body.role !== undefined) {
      if (!SERVER_ROLES.includes(body.role)) {
        return reply.status(422).send({ error: { code: 'INVALID_ROLE', message: `role must be one of ${SERVER_ROLES.join(', ')}` } });
      }
      patch.role = body.role;
    }
    if (body.disabled !== undefined) patch.disabled = Boolean(body.disabled);
    const updated = updateDeploymentRole(db, roleId, patch);
    return reply.status(200).send(updated);
  });

  // DELETE /api/v1/configurations/:configId/roles/:roleId - Delete a deployment role (requires edit)
  app.delete('/api/v1/configurations/:configId/roles/:roleId', async (req, reply) => {
    const { configId, roleId } = req.params as { configId: string; roleId: string };
    if (!authorize(req.actor, 'edit', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const existing = getDeploymentRole(db, roleId);
    if (!existing || existing.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Deployment role not found' } });
    }
    deleteDeploymentRole(db, roleId);
    return reply.status(204).send();
  });

  // GET /api/v1/configurations/:configId/zones/:zoneId/effective-roles - Resolved per-zone role matrix (requires view)
  app.get('/api/v1/configurations/:configId/zones/:zoneId/effective-roles', async (req, reply) => {
    const { configId, zoneId } = req.params as { configId: string; zoneId: string };
    if (!authorize(req.actor, 'view', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const zone = getZone(db, zoneId);
    if (!zone || zone.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Zone not found' } });
    }
    return reply.status(200).send(effectiveZoneRoles(buildConfigModel(db, configId), zone.viewId, zoneId));
  });

  // --- CHANGE-SET REVIEW & DEPLOY ROUTES ---

  // GET /api/v1/configurations/:configId/change-set - computed pending change set (requires view)
  app.get('/api/v1/configurations/:configId/change-set', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'view', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const config = getConfiguration(db, configId);
    if (!config) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Configuration not found' } });
    }

    const model = buildConfigModel(db, configId);
    const baseline = getBaselineModel(db, configId);
    const items = computeChangeSet(model, baseline);

    const groupsMap = new Map<string, { groupKey: string; objectType: ChangeSetObjectType; items: ChangeSetItem[] }>();
    for (const item of items) {
      const key = `${item.groupKey}::${item.objectType}`;
      const existing = groupsMap.get(key);
      if (existing) {
        existing.items.push(item);
      } else {
        groupsMap.set(key, { groupKey: item.groupKey, objectType: item.objectType, items: [item] });
      }
    }

    return reply.status(200).send({ items, groups: [...groupsMap.values()] });
  });

  // GET /api/v1/configurations/:configId/change-set/diff - render current vs baseline per-server diff (requires view)
  app.get('/api/v1/configurations/:configId/change-set/diff', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'view', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const config = getConfiguration(db, configId);
    if (!config) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Configuration not found' } });
    }

    const model = buildConfigModel(db, configId);
    const baseline = getBaselineModel(db, configId);
    const query = (req.query as any) || {};
    const mode = query.mode === 'split' ? 'split' : 'unified';
    const serverId =
      typeof query.server === 'string' && query.server ? query.server : model.servers?.[0]?.id;
    if (!serverId) {
      return reply.status(422).send({ error: { code: 'NO_SERVERS', message: 'Configuration has no servers' } });
    }

    const before = baseline ? renderServerText(baseline, serverId) : '';
    const after = renderServerText(model, serverId);
    const lines = diffLines(before, after);
    const diff = mode === 'split' ? splitDiff(lines) : lines;

    return reply.status(200).send({ mode, serverId, before, after, diff });
  });

  // POST /api/v1/configurations/:configId/deploy-jobs - preflight + run a change-set deploy (requires deploy)
  app.post('/api/v1/configurations/:configId/deploy-jobs', async (req, reply) => {
    const { configId } = req.params as { configId: string };
    if (!authorize(req.actor, 'deploy', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const config = getConfiguration(db, configId);
    if (!config) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Configuration not found' } });
    }

    const labs = listLabs(db, configId);
    if (labs.length === 0) {
      return reply.status(422).send({ error: { code: 'NO_LAB_FOR_CONFIG', message: 'Configuration has no lab' } });
    }
    const lab = labs[0];
    if (!isDnsLab(lab)) {
      return reply.status(422).send({ error: { code: 'NOT_A_DNS_LAB', message: 'Bind9-Manager only manages DNS labs (labs with a bind node).' } });
    }

    const body = (req.body ?? {}) as any;
    const changeSetItemIds = Array.isArray(body.changeSetItemIds)
      ? body.changeSetItemIds.filter((x: unknown) => typeof x === 'string')
      : [];
    const targetServerIds = Array.isArray(body.targetServerIds)
      ? body.targetServerIds.filter((x: unknown) => typeof x === 'string')
      : [];
    if (targetServerIds.length === 0) {
      return reply.status(422).send({ error: { code: 'EMPTY_TARGETS', message: 'targetServerIds must not be empty' } });
    }
    // Every target must be a real server in this config. A target id becomes a
    // container name and a filesystem path in the push script; shellQuote stops
    // shell metachars but NOT path traversal, so an unvalidated body id like
    // '../../etc' would be an arbitrary-write vector. Deriving from the model
    // means the id is always a server-generated, charset-validated one.
    const knownServerIds = new Set(buildConfigModel(db, configId).servers.map((s) => s.id));
    const unknownTargets = targetServerIds.filter((id: string) => !knownServerIds.has(id));
    if (unknownTargets.length > 0) {
      return reply.status(422).send({ error: { code: 'UNKNOWN_SERVER', message: `Unknown target server(s): ${unknownTargets.join(', ')}` } });
    }
    const warningAck = body.warningAck === true;

    const pre = await runPreflight(db, configId, targetServerIds, activeRunner);
    if (pre.hasFail) {
      return reply.status(422).send({ error: { code: 'PREFLIGHT_FAILED', message: 'Pre-flight validation failed', details: pre.preflight } });
    }
    if (pre.hasWarn && !warningAck) {
      return reply.status(422).send({ error: { code: 'PREFLIGHT_WARNING_UNACK', message: 'Pre-flight warnings require acknowledgment', details: pre.preflight } });
    }

    const labDir = opts.labDir || `/home/lun/${lab.topology.name}`;
    const job = createDeployJob(db, configId, { changeSetItemIds, targetServerIds, warningAck });
    await runChangeSetDeploy(db, configId, lab, job, { run: activeRunner, labDir, targetServerIds, warningAck });
    return reply.status(201).send({ jobId: job.id });
  });

  // GET /api/v1/configurations/:configId/deploy-jobs/:jobId - a change-set deploy job (requires view)
  app.get('/api/v1/configurations/:configId/deploy-jobs/:jobId', async (req, reply) => {
    const { configId, jobId } = req.params as { configId: string; jobId: string };
    if (!authorize(req.actor, 'view', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const job = getChangeSetDeployJob(db, jobId);
    if (!job || job.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Deploy job not found' } });
    }
    return reply.status(200).send(job);
  });

  // POST /api/v1/configurations/:configId/deploy-jobs/:jobId/retry - retry failed servers (requires deploy)
  app.post('/api/v1/configurations/:configId/deploy-jobs/:jobId/retry', async (req, reply) => {
    const { configId, jobId } = req.params as { configId: string; jobId: string };
    if (!authorize(req.actor, 'deploy', configId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    const config = getConfiguration(db, configId);
    if (!config) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Configuration not found' } });
    }
    const existing = getChangeSetDeployJob(db, jobId);
    if (!existing || existing.configurationId !== configId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Deploy job not found' } });
    }

    const labs = listLabs(db, configId);
    if (labs.length === 0) {
      return reply.status(422).send({ error: { code: 'NO_LAB_FOR_CONFIG', message: 'Configuration has no lab' } });
    }
    const lab = labs[0];
    if (!isDnsLab(lab)) {
      return reply.status(422).send({ error: { code: 'NOT_A_DNS_LAB', message: 'Bind9-Manager only manages DNS labs (labs with a bind node).' } });
    }

    const body = (req.body ?? {}) as any;
    const failedIds = existing.serverResults
      .filter((r) => r.outcome === 'FAILED')
      .map((r) => r.serverId);
    const targetServerIds =
      typeof body.serverId === 'string' && body.serverId ? [body.serverId] : failedIds;
    if (targetServerIds.length === 0) {
      return reply.status(422).send({ error: { code: 'NOTHING_TO_RETRY', message: 'No failed servers to retry' } });
    }
    // Same allowlist as the create route: a retry body.serverId is fresh
    // untrusted input that reaches the push path, so it must be a real server.
    const knownRetryServerIds = new Set(buildConfigModel(db, configId).servers.map((s) => s.id));
    const unknownRetry = targetServerIds.filter((id: string) => !knownRetryServerIds.has(id));
    if (unknownRetry.length > 0) {
      return reply.status(422).send({ error: { code: 'UNKNOWN_SERVER', message: `Unknown target server(s): ${unknownRetry.join(', ')}` } });
    }
    const warningAck = existing.warningAck === true || body.warningAck === true;

    const pre = await runPreflight(db, configId, targetServerIds, activeRunner);
    if (pre.hasFail) {
      return reply.status(422).send({ error: { code: 'PREFLIGHT_FAILED', message: 'Pre-flight validation failed', details: pre.preflight } });
    }
    if (pre.hasWarn && !warningAck) {
      return reply.status(422).send({ error: { code: 'PREFLIGHT_WARNING_UNACK', message: 'Pre-flight warnings require acknowledgment', details: pre.preflight } });
    }

    const labDir = opts.labDir || `/home/lun/${lab.topology.name}`;
    const job = createDeployJob(db, configId, {
      changeSetItemIds: existing.changeSetItemIds,
      targetServerIds,
      warningAck,
    });
    await runChangeSetDeploy(db, configId, lab, job, { run: activeRunner, labDir, targetServerIds, warningAck });
    return reply.status(201).send({ jobId: job.id });
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

  // --- USERS ROUTES (admin-only; mirrors the api-keys/configurations admin-gate idiom) ---

  const requireAdmin = (req: FastifyRequest, reply: FastifyReply): boolean => {
    const isAdmin = (req.actor.user.roles ?? []).some((r) => authorize(req.actor, 'admin', r.configurationId));
    if (!isAdmin) {
      reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    }
    return isAdmin;
  };

  // GET /api/v1/users - list all users (admin-only, secret-free)
  app.get('/api/v1/users', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return reply.status(200).send(listUsers(db));
  });

  // GET /api/v1/users/:userId - get one user (admin-only, secret-free)
  app.get('/api/v1/users/:userId', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { userId } = req.params as { userId: string };
    const user = getUserById(db, userId);
    if (!user) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }
    return reply.status(200).send(user);
  });

  // POST /api/v1/users - create a user (admin-only)
  app.post('/api/v1/users', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;

    const body = (req.body ?? {}) as any;

    const username = typeof body.username === 'string' ? body.username : '';
    if (!/^[A-Za-z0-9._-]+$/.test(username) || username.length < 1 || username.length > 64) {
      return reply.status(422).send({
        error: { code: 'INVALID_USERNAME', message: 'Username must be 1-64 characters of letters, digits, dot, underscore, or hyphen' },
      });
    }
    if (getUserByUsername(db, username)) {
      return reply.status(409).send({ error: { code: 'CONFLICT', message: 'A user with this username already exists' } });
    }

    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    if (!displayName || displayName.length > 128) {
      return reply.status(422).send({ error: { code: 'INVALID_NAME', message: 'Display name must be 1-128 characters' } });
    }

    const passwordReason = validatePassword(typeof body.password === 'string' ? body.password : '');
    if (passwordReason) {
      return reply.status(422).send({ error: { code: 'WEAK_PASSWORD', message: passwordReason } });
    }

    const roles = validateUserRoles(db, body.roles ?? []);
    if (!roles) {
      return reply.status(422).send({ error: { code: 'INVALID_ROLE', message: 'Invalid role assignment' } });
    }

    const user = createUser(db, { username, displayName, password: body.password, roles });
    return reply.status(201).send(user);
  });

  // PATCH /api/v1/users/:userId - update displayName/isActive/roles/password (admin-only; username is immutable)
  app.patch('/api/v1/users/:userId', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;

    const { userId } = req.params as { userId: string };
    const target = getUserById(db, userId);
    if (!target) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }

    const body = (req.body ?? {}) as any;
    const patch: { displayName?: string; isActive?: boolean; roles?: RoleAssignment[]; password?: string } = {};

    if (body.displayName !== undefined) {
      const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
      if (!displayName || displayName.length > 128) {
        return reply.status(422).send({ error: { code: 'INVALID_NAME', message: 'Display name must be 1-128 characters' } });
      }
      patch.displayName = displayName;
    }

    if (body.isActive !== undefined) {
      patch.isActive = Boolean(body.isActive);
    }

    if (body.roles !== undefined) {
      const roles = validateUserRoles(db, body.roles);
      if (!roles) {
        return reply.status(422).send({ error: { code: 'INVALID_ROLE', message: 'Invalid role assignment' } });
      }
      patch.roles = roles;
    }

    if (body.password !== undefined) {
      const passwordReason = validatePassword(typeof body.password === 'string' ? body.password : '');
      if (passwordReason) {
        return reply.status(422).send({ error: { code: 'WEAK_PASSWORD', message: passwordReason } });
      }
      patch.password = body.password;
    }

    // LAST_ADMIN guard: simulate the change and refuse to drop the last active admin.
    const wasActiveAdmin = target.isActive && target.roles.some((r) => r.role === 'admin');
    const nextIsActive = patch.isActive !== undefined ? patch.isActive : target.isActive;
    const nextRoles = patch.roles !== undefined ? patch.roles : target.roles;
    const willBeActiveAdmin = nextIsActive && nextRoles.some((r) => r.role === 'admin');
    if (wasActiveAdmin && !willBeActiveAdmin && countActiveAdmins(db) === 1) {
      return reply.status(409).send({ error: { code: 'LAST_ADMIN', message: 'Cannot remove the last active admin' } });
    }

    // SELF_DEACTIVATION guard: an admin may not deactivate their own account.
    if (patch.isActive === false && userId === req.actor.user.id) {
      return reply.status(409).send({ error: { code: 'SELF_DEACTIVATION', message: 'An admin cannot deactivate their own account' } });
    }

    const updated = updateUser(db, userId, patch);
    return reply.status(200).send(updated);
  });

  // DELETE /api/v1/users/:userId - soft-deactivate a user (admin-only; same LAST_ADMIN/SELF_DEACTIVATION guards as PATCH isActive:false)
  app.delete('/api/v1/users/:userId', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;

    const { userId } = req.params as { userId: string };
    const target = getUserById(db, userId);
    if (!target) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }

    const wasActiveAdmin = target.isActive && target.roles.some((r) => r.role === 'admin');
    if (wasActiveAdmin && countActiveAdmins(db) === 1) {
      return reply.status(409).send({ error: { code: 'LAST_ADMIN', message: 'Cannot deactivate the last active admin' } });
    }
    if (userId === req.actor.user.id) {
      return reply.status(409).send({ error: { code: 'SELF_DEACTIVATION', message: 'An admin cannot deactivate their own account' } });
    }

    deactivateUser(db, userId);
    return reply.status(200).send({ deactivated: true });
  });

  // Serve the built React frontend (bind9-manager/app/dist) on every other
  // GET, with SPA fallback to index.html. See ./static.ts.
  registerFrontendStatic(app);

  return app;
}
