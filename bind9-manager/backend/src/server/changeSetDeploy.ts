import path from 'path';
import type Database from 'better-sqlite3';
import type { ConfigModel } from '../config-engine/model';
import type { Lab } from './labStore';
import { generateServerConfig, validateConfig, type Runner } from '../config-engine';
import { shellQuote } from '../config-engine/shellQuote';
import { buildConfigModel, ensureServerTrustKey, getServerTrustSecret } from './entityStore';
import { buildManifest, signManifest } from './trustManifest';
import { computeChangeSet } from './changeSet';
import { getBaselineModel, setBaselineModel, updateDeployJob } from './changeSetStore';
import type {
  ChangeSetDeployJob,
  DeployPreflight,
  DeployPreflightCheck,
  DeployServerResult,
} from '../../../shared/entities';

export interface RunDeployOptions {
  run: Runner;
  labDir: string;
  targetServerIds: string[];
  warningAck: boolean;
}

export interface PreflightResult {
  preflight: DeployPreflight;
  hasFail: boolean;
  hasWarn: boolean;
}

function b64(content: string): string {
  return Buffer.from(content, 'utf-8').toString('base64');
}

// Map a serverId to the topology node (short) name that owns its container
// and config dir. Lab-reconciled servers are `srv-<lab.id>-<node>`; legacy
// configs may use the node name as the id or an explicit short nodeName.
function bindNodeNameForServer(model: ConfigModel, lab: Lab, serverId: string): string {
  const server = model.servers?.find((s) => s.id === serverId);
  const bindNodes = (lab.topology?.nodes ?? []).filter((n) => n.intent === 'bind');
  for (const node of bindNodes) {
    if (server?.nodeName === node.name) return node.name;
    if (serverId === node.name) return node.name;
    if (serverId === `srv-${lab.id}-${node.name}`) return node.name;
  }
  return server?.nodeName ?? server?.id ?? serverId;
}

function changedZoneIds(model: ConfigModel, baseline: ConfigModel | null): Set<string> {
  const ids = new Set<string>();
  for (const item of computeChangeSet(model, baseline)) {
    if (item.objectType === 'ZONE') {
      ids.add(item.objectId);
    } else if (item.objectType === 'RECORD') {
      const record =
        model.records?.find((r) => r.id === item.objectId) ??
        baseline?.records?.find((r) => r.id === item.objectId);
      if (record) ids.add(record.zoneId);
    }
  }
  return ids;
}

/**
 * Run BIND preflight (named-checkconf + named-checkzone) for each target
 * server and shape the results into a DeployPreflight. Also returns the
 * hasFail/hasWarn booleans the route gate needs.
 */
export async function preflightModel(
  model: ConfigModel,
  baseline: ConfigModel | null,
  targetServerIds: string[],
  run: Runner,
): Promise<PreflightResult> {
  const checkconf: DeployPreflightCheck[] = [];
  const checkzone: DeployPreflightCheck[] = [];
  const changedZones = changedZoneIds(model, baseline);

  for (const serverId of targetServerIds) {
    let files: Record<string, string>;
    try {
      files = generateServerConfig(model, serverId);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      checkconf.push({ serverId, result: 'FAIL', detail });
      continue;
    }

    let result: { ok: boolean; warnings: string[]; errors: string[] };
    try {
      result = await validateConfig(files, run);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      checkconf.push({ serverId, result: 'FAIL', detail });
      continue;
    }

    const errors = result.errors ?? [];
    const warnings = result.warnings ?? [];
    const serverResult: DeployPreflightCheck['result'] =
      errors.length > 0 ? 'FAIL' : warnings.length > 0 ? 'WARN' : 'OK';
    const detail = errors.length > 0 ? errors.join('\n') : warnings.length > 0 ? warnings.join('\n') : 'OK';
    checkconf.push({ serverId, result: serverResult, detail });

    // At minimum one checkzone entry per changed zone; validateConfig runs a
    // single combined script, so the server-level result is the honest detail.
    for (const zone of model.zones ?? []) {
      if (!changedZones.has(zone.id)) continue;
      checkzone.push({
        serverId,
        zoneId: zone.id,
        zoneName: zone.name,
        result: serverResult,
        detail,
      });
    }
  }

  const hasFail =
    checkconf.some((c) => c.result === 'FAIL') || checkzone.some((c) => c.result === 'FAIL');
  const hasWarn =
    checkconf.some((c) => c.result === 'WARN') || checkzone.some((c) => c.result === 'WARN');

  return { preflight: { checkconf, checkzone }, hasFail, hasWarn };
}

/** Build + preflight a model for a configId (used by the routes' pre-gate). */
export async function runPreflight(
  db: Database.Database,
  configId: string,
  targetServerIds: string[],
  run: Runner,
): Promise<PreflightResult> {
  const model = buildConfigModel(db, configId);
  const baseline = getBaselineModel(db, configId);
  return preflightModel(model, baseline, targetServerIds, run);
}

// Write the server's generated files to labDir/configs/<nodeName>/... then
// reload named in the container. The container name is derived server-side and
// shell-quoted; both rndc calls gate the script's exit code.
function buildPushScript(
  files: Record<string, string>,
  labDir: string,
  nodeName: string,
  container: string,
): string {
  // Defense in depth: nodeName lands in a filesystem path and a container name.
  // The routes already allowlist target ids to real servers, but guard here too
  // so no future caller can slip a traversal ('../') past shellQuote.
  if (!/^[A-Za-z0-9_-]+$/.test(nodeName)) {
    throw new Error(`Invalid node name for deploy push: ${nodeName}`);
  }

  const lines: string[] = ['#!/usr/bin/env bash'];

  const dirs = new Set<string>();
  for (const filePath of Object.keys(files)) {
    dirs.add(path.posix.dirname(`${labDir}/configs/${nodeName}/${filePath}`));
  }
  for (const dir of dirs) {
    lines.push(`mkdir -p ${shellQuote(dir)}`);
  }

  for (const [filePath, content] of Object.entries(files)) {
    lines.push(
      `echo '${b64(content)}' | base64 -d > ${shellQuote(`${labDir}/configs/${nodeName}/${filePath}`)}`,
    );
  }

  const c = shellQuote(container);
  lines.push(`docker exec ${c} rndc reconfig || exit 1`);
  lines.push(`docker exec ${c} rndc reload || exit 1`);

  return lines.join('\n') + '\n';
}

function isoNow(): string {
  return new Date().toISOString();
}

/**
 * Prove the container is the node we think it is before writing config into it.
 * One docker inspect reads the containerlab labels; the node label must match
 * exactly. The topology label's value varies by clab version, so a mismatch is
 * only fatal when the label is non-empty (an empty topo label is tolerated).
 */
export async function assertManagedTarget(
  run: Runner,
  container: string,
  nodeName: string,
  topoName: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const script =
    `docker inspect -f '{{index .Config.Labels "clab-node-name"}}|{{index .Config.Labels "containerlab"}}' ` +
    shellQuote(container);
  const res = await run(script);
  if (res.code !== 0) {
    const detail = (res.stderr || res.stdout || '').trim().slice(0, 200) || `exit ${res.code}`;
    return { ok: false, reason: `TARGET_UNTRUSTED: docker inspect failed (${detail})` };
  }
  const [nodeLabel = '', topoLabel = ''] = res.stdout.trim().split('|');
  if (nodeLabel !== nodeName) {
    return { ok: false, reason: `TARGET_UNTRUSTED: clab-node-name label '${nodeLabel}' does not match '${nodeName}'` };
  }
  if (topoLabel && topoLabel !== topoName) {
    return { ok: false, reason: `TARGET_UNTRUSTED: containerlab label '${topoLabel}' does not match '${topoName}'` };
  }
  return { ok: true };
}

/**
 * Run a change-set deploy: preflight, push to the target servers, aggregate,
 * and replace the baseline ONLY on full success. Never throws — errors are
 * captured into the job and persisted.
 */
export async function runChangeSetDeploy(
  db: Database.Database,
  configId: string,
  lab: Lab,
  job: ChangeSetDeployJob,
  opts: RunDeployOptions,
): Promise<ChangeSetDeployJob> {
  job.status = 'RUNNING';
  updateDeployJob(db, job);

  let model: ConfigModel;
  try {
    model = buildConfigModel(db, configId);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    job.status = 'FAILED';
    job.serverResults = opts.targetServerIds.map((serverId) => ({
      serverId,
      outcome: 'FAILED',
      startedAt: isoNow(),
      finishedAt: isoNow(),
      stderr: detail,
    }));
    updateDeployJob(db, job);
    return job;
  }

  const baseline = getBaselineModel(db, configId);

  const pre = await preflightModel(model, baseline, opts.targetServerIds, opts.run);
  job.preflight = pre.preflight;
  updateDeployJob(db, job);

  const allChecks = [...pre.preflight.checkconf, ...pre.preflight.checkzone];
  const failCheck = allChecks.find((c) => c.result === 'FAIL');
  if (failCheck) {
    job.status = 'FAILED';
    job.serverResults = opts.targetServerIds.map((serverId) => ({
      serverId,
      outcome: 'FAILED',
      startedAt: isoNow(),
      finishedAt: isoNow(),
      stderr: failCheck.detail,
    }));
    updateDeployJob(db, job);
    return job;
  }

  const warnCheck = allChecks.find((c) => c.result === 'WARN');
  if (warnCheck && opts.warningAck !== true) {
    job.status = 'FAILED';
    job.serverResults = opts.targetServerIds.map((serverId) => ({
      serverId,
      outcome: 'FAILED',
      startedAt: isoNow(),
      finishedAt: isoNow(),
      stderr: 'Pre-flight warning not acknowledged',
    }));
    updateDeployJob(db, job);
    return job;
  }

  const results: DeployServerResult[] = [];
  for (const serverId of opts.targetServerIds) {
    const startedAt = isoNow();
    const nodeName = bindNodeNameForServer(model, lab, serverId);
    const container = `clab-${lab.topology.name}-${nodeName}`;

    let files: Record<string, string>;
    try {
      files = generateServerConfig(model, serverId);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      results.push({ serverId, outcome: 'FAILED', startedAt, finishedAt: isoNow(), stderr: detail });
      continue;
    }

    let target;
    try {
      target = await assertManagedTarget(opts.run, container, nodeName, lab.topology.name);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      results.push({
        serverId,
        outcome: 'FAILED',
        startedAt,
        finishedAt: isoNow(),
        stderr: detail,
        trust: 'TARGET_UNTRUSTED',
      });
      continue;
    }
    if (!target.ok) {
      results.push({
        serverId,
        outcome: 'FAILED',
        startedAt,
        finishedAt: isoNow(),
        stderr: target.reason,
        trust: 'TARGET_UNTRUSTED',
      });
      continue;
    }

    try {
      ensureServerTrustKey(db, serverId);
      const secret = getServerTrustSecret(db, serverId);
      if (secret) {
        const manifest = buildManifest({ node: nodeName, deployJobId: job.id, generatedAt: isoNow(), files });
        const signature = signManifest(secret, manifest);
        files = { ...files, '.manager-manifest.json': JSON.stringify({ manifest, signature }) };
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      results.push({ serverId, outcome: 'FAILED', startedAt, finishedAt: isoNow(), stderr: detail });
      continue;
    }

    let res;
    try {
      res = await opts.run(buildPushScript(files, opts.labDir, nodeName, container));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      results.push({ serverId, outcome: 'FAILED', startedAt, finishedAt: isoNow(), stderr: detail });
      continue;
    }

    const finishedAt = isoNow();
    if (res.code === 0) {
      results.push({ serverId, outcome: 'SUCCEEDED', startedAt, finishedAt, trust: 'SIGNED' });
    } else {
      results.push({
        serverId,
        outcome: 'FAILED',
        startedAt,
        finishedAt,
        stderr: (res.stderr || res.stdout || '').slice(0, 2000),
        trust: 'SIGNED',
      });
    }
  }
  job.serverResults = results;

  const allSucceeded = results.length > 0 && results.every((r) => r.outcome === 'SUCCEEDED');
  const allFailed = results.every((r) => r.outcome === 'FAILED');
  job.status = allSucceeded ? 'SUCCEEDED' : allFailed ? 'FAILED' : 'PARTIAL';

  if (job.status === 'SUCCEEDED') {
    try {
      setBaselineModel(db, configId, model);
    } catch {
      // A baseline write failure keeps items pending on the next compute — never
      // fail the already-succeeded deploy on it.
    }
  }

  updateDeployJob(db, job);
  return job;
}
