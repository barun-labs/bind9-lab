import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import type { Lab } from './labStore';
import { reconcileServersRuntime } from './labStore';
import { buildConfigModel } from './entityStore';
import { deploy, type DeployResult, type Runner } from './deployEngine';

export interface DeployJob {
  id: string;
  labId: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  result?: DeployResult;
  error?: string;
  createdAt: string;
}

export interface StartDeployJobOptions {
  run: Runner;
  labDir: string;
}

export function startDeployJob(
  db: Database.Database,
  lab: Lab,
  opts: StartDeployJobOptions,
): DeployJob {
  const id = 'job-' + randomBytes(8).toString('hex');
  const job: DeployJob = {
    id,
    labId: lab.id,
    status: 'QUEUED',
    createdAt: new Date().toISOString(),
  };

  db.prepare('INSERT INTO deploy_jobs (id, data) VALUES (?, ?)').run(
    job.id,
    JSON.stringify(job),
  );

  (async () => {
    try {
      job.status = 'RUNNING';
      try {
        db.prepare('UPDATE deploy_jobs SET data = ? WHERE id = ?').run(
          JSON.stringify(job),
          job.id,
        );
      } catch {
        // database might be closed in teardown
      }

      const model = buildConfigModel(db, lab.configurationId);
      const result = await deploy(model, lab.topology, {
        run: opts.run,
        labDir: opts.labDir,
      });

      job.result = result;
      if (result.aborted) {
        job.status = 'FAILED';
        job.error = result.aborted;
      } else {
        job.status = 'SUCCEEDED';
        try {
          reconcileServersRuntime(db, lab, result);
        } catch {
          // reconcile is best-effort; the deploy already succeeded, never fail the job on it
        }
      }
    } catch (err: any) {
      job.status = 'FAILED';
      job.error = err?.message || String(err);
    } finally {
      try {
        db.prepare('UPDATE deploy_jobs SET data = ? WHERE id = ?').run(
          JSON.stringify(job),
          job.id,
        );
      } catch {
        // database might be closed in teardown
      }
    }
  })();

  return job;
}

export function getDeployJob(
  db: Database.Database,
  id: string,
): DeployJob | null {
  const row = db.prepare('SELECT data FROM deploy_jobs WHERE id = ?').get(id) as
    | { data: string }
    | undefined;
  if (!row) return null;
  return JSON.parse(row.data) as DeployJob;
}
