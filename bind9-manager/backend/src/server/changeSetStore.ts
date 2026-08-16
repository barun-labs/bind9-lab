import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import type { ConfigModel } from '../config-engine/model';
import type { ChangeSetDeployJob } from '../../../shared/entities';

export function getBaselineModel(
  db: Database.Database,
  configId: string,
): ConfigModel | null {
  const row = db
    .prepare('SELECT data FROM deployed_baselines WHERE configurationId = ?')
    .get(configId) as { data: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.data) as ConfigModel;
  } catch {
    return null;
  }
}

export function setBaselineModel(
  db: Database.Database,
  configId: string,
  model: ConfigModel,
): void {
  db.prepare(
    `INSERT INTO deployed_baselines (configurationId, data) VALUES (?, ?)
     ON CONFLICT(configurationId) DO UPDATE SET data = excluded.data`,
  ).run(configId, JSON.stringify(model));
}

export function createDeployJob(
  db: Database.Database,
  configId: string,
  input: {
    changeSetItemIds: string[];
    targetServerIds: string[];
    warningAck?: boolean;
  },
): ChangeSetDeployJob {
  const job: ChangeSetDeployJob = {
    id: 'csdj-' + randomBytes(6).toString('hex'),
    configurationId: configId,
    changeSetItemIds: input.changeSetItemIds,
    targetServerIds: input.targetServerIds,
    status: 'QUEUED',
    serverResults: [],
    warningAck: input.warningAck === true,
    createdAt: new Date().toISOString(),
  };

  db.prepare(
    'INSERT INTO changeset_deploy_jobs (id, configurationId, data) VALUES (?, ?, ?)',
  ).run(job.id, configId, JSON.stringify(job));

  return job;
}

export function getDeployJob(
  db: Database.Database,
  id: string,
): ChangeSetDeployJob | null {
  const row = db
    .prepare('SELECT data FROM changeset_deploy_jobs WHERE id = ?')
    .get(id) as { data: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.data) as ChangeSetDeployJob;
}

export function listChangeSetDeployJobs(
  db: Database.Database,
  configId: string,
): ChangeSetDeployJob[] {
  const rows = db
    .prepare('SELECT data FROM changeset_deploy_jobs WHERE configurationId = ?')
    .all(configId) as { data: string }[];
  return rows
    .map((row) => JSON.parse(row.data) as ChangeSetDeployJob)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function updateDeployJob(
  db: Database.Database,
  job: ChangeSetDeployJob,
): void {
  db.prepare('UPDATE changeset_deploy_jobs SET data = ? WHERE id = ?').run(
    JSON.stringify(job),
    job.id,
  );
}
