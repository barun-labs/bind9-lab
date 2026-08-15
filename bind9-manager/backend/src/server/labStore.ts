import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import type { TopologyModel, NodeInterface } from '../config-engine/topology';
import { listServers, upsertServer, deleteServerById, getServer } from './entityStore';
import type { Server } from '../config-engine/model';
import type { DeployResult, RuntimeNode } from './deployEngine';

export interface Lab {
  id: string;
  name: string;
  configurationId: string;
  topology: TopologyModel;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLabInput {
  id?: string;
  name: string;
  configurationId: string;
  topology: TopologyModel;
}

export interface UpdateLabPatch {
  name?: string;
  configurationId?: string;
  topology?: TopologyModel;
}

function getIsoTimestamp(now?: string): string {
  if (now) return now;
  try {
    return new Date().toISOString();
  } catch {
    return '2026-08-15T00:00:00.000Z';
  }
}

/**
 * Reconcile containerlab nodes with entityStore Servers for a Lab.
 * Nodes with intent === 'bind' produce/update a Server in configurationId.
 * Bind nodes removed since previous topology are deleted from the servers store.
 * Router and bridge nodes are skipped.
 */
export function reconcileServers(
  db: Database.Database,
  lab: Lab,
  previousLab?: Lab | null
): void {
  const bindNodes = (lab.topology?.nodes || []).filter((n) => n && n.intent === 'bind');
  const currentBindNodeNames = new Set(bindNodes.map((n) => n.name));

  // Collect previous bind node names from previousLab or existing servers
  const previousBindNodeNames = new Set<string>();
  if (previousLab?.topology?.nodes) {
    for (const n of previousLab.topology.nodes) {
      if (n && n.intent === 'bind') {
        previousBindNodeNames.add(n.name);
      }
    }
  }

  // Also check existing servers in the database associated with this lab
  const configsToCheck = new Set<string>([lab.configurationId]);
  if (previousLab?.configurationId) {
    configsToCheck.add(previousLab.configurationId);
  }

  for (const cfgId of configsToCheck) {
    const existingServers = listServers(db, cfgId);
    for (const s of existingServers) {
      if (s.id.startsWith('srv-' + lab.id + '-')) {
        if (s.nodeName) {
          previousBindNodeNames.add(s.nodeName);
        }
      } else if (s.labName === lab.name || (previousLab && s.labName === previousLab.name)) {
        if (s.nodeName) {
          previousBindNodeNames.add(s.nodeName);
        }
      }
    }
  }

  // Delete servers for bind nodes that are no longer in the current topology
  for (const oldNodeName of previousBindNodeNames) {
    if (!currentBindNodeNames.has(oldNodeName)) {
      deleteServerById(db, 'srv-' + lab.id + '-' + oldNodeName);
      if (previousLab) {
        deleteServerById(db, 'srv-' + previousLab.id + '-' + oldNodeName);
      }
    }
  }

  // Upsert servers for current bind nodes
  for (const node of bindNodes) {
    const mgmtAddress = node.mgmtIpv4;
    const rawInterfaces = Array.isArray(node.interfaces) ? node.interfaces : [];
    const serviceInterfaces = rawInterfaces
      .filter((i): i is NodeInterface => i != null && typeof i === 'object' && typeof (i as any).address === 'string')
      .map((i) => ({
        address: i.address.split('/')[0],
        port: 53,
      }));

    const server: Server & Record<string, any> = {
      id: 'srv-' + lab.id + '-' + node.name,
      configurationId: lab.configurationId,
      hostname: node.name,
      labName: lab.name,
      nodeName: node.name,
      mgmtAddress,
      serviceInterfaces,
      adminState: 'ENABLED',
      syncState: 'PENDING',
    };

    upsertServer(db, server);
  }
}

/**
 * Reconcile deployed bind Servers with the real containerlab runtime state
 * gathered by a `deploy()` call (deployEngine.ts's `containerlab inspect`
 * step). Unlike reconcileServers (CRUD-time), this runs after a deploy job
 * and only touches the runtime-derived fields — mgmtAddress (the declared
 * management IP) is never overwritten here.
 */
export function reconcileServersRuntime(
  db: Database.Database,
  lab: Lab,
  result: DeployResult,
  now?: string,
): void {
  // A failed inspect means we do not know liveness; leave every syncState
  // as it was rather than guessing NODE_ABSENT for containers that may
  // still be running fine.
  if (result.runtimeError && !(result.runtime && result.runtime.length > 0)) {
    return;
  }

  const bindNodes = (lab.topology?.nodes || []).filter((n) => n && n.intent === 'bind');

  for (const node of bindNodes) {
    const containerName = 'clab-' + lab.topology.name + '-' + node.name;
    // Exact string equality on the full container name is the whole
    // defence against a same-named node in a different lab, or a
    // same-lab node whose name is a prefix of another node's name.
    const match: RuntimeNode | undefined = (result.runtime ?? []).find(
      (r) => r.name === containerName,
    );

    const existing = getServer(db, 'srv-' + lab.id + '-' + node.name);
    if (!existing) {
      // reconcileServers creates this row at lab CRUD time; if it is
      // somehow missing, do not fabricate a Server from runtime data alone.
      continue;
    }

    // deployEngine emits each deployed entry's serverId as the model server's
    // id (filesForServers: serverId = server.id), which for a lab-reconciled
    // bind node is `srv-<lab.id>-<node.name>` === existing.id. Legacy configs
    // whose server id equals the node name still match via node.name.
    const deployedEntry = result.deployed?.find(
      (d) => d.serverId === existing.id || d.serverId === node.name,
    );
    let syncState: string;
    if (!match) {
      syncState = 'NODE_ABSENT';
    } else if (deployedEntry?.ok === false) {
      syncState = 'ERROR';
    } else {
      syncState = 'SYNCED';
    }

    upsertServer(db, {
      ...existing,
      containerId: match?.containerId,
      runtimeAddress: match?.ipv4Address ? match.ipv4Address.split('/')[0] : undefined,
      runtimeState: match?.state,
      syncState,
      lastDeployedAt: getIsoTimestamp(now),
      configurationId: existing.configurationId as string | undefined, // preserve — upsert needs it
    });
  }
}

/**
 * List labs, optionally filtered by configurationId.
 */
export function listLabs(db: Database.Database, configId?: string): Lab[] {
  if (configId) {
    const rows = db.prepare('SELECT data FROM labs WHERE configurationId = ?').all(configId) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as Lab);
  }
  const rows = db.prepare('SELECT data FROM labs').all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Lab);
}

/**
 * Get lab by ID.
 */
export function getLab(db: Database.Database, id: string): Lab | null {
  const row = db.prepare('SELECT data FROM labs WHERE id = ?').get(id) as { data: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.data) as Lab;
}

/**
 * Create a new lab and reconcile its bind servers.
 */
export function createLab(
  db: Database.Database,
  input: CreateLabInput,
  now?: string
): Lab {
  const timestamp = getIsoTimestamp(now);
  const lab: Lab = {
    id: input.id || 'lab-' + randomBytes(8).toString('hex'),
    name: input.name,
    configurationId: input.configurationId,
    topology: input.topology,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  db.prepare('INSERT INTO labs (id, configurationId, data) VALUES (?, ?, ?)').run(
    lab.id,
    lab.configurationId,
    JSON.stringify(lab)
  );

  reconcileServers(db, lab);

  return lab;
}

/**
 * Update an existing lab and reconcile its bind servers.
 */
export function updateLab(
  db: Database.Database,
  id: string,
  patch: UpdateLabPatch,
  now?: string
): Lab {
  const existing = getLab(db, id);
  if (!existing) {
    throw new Error(`Lab ${id} not found`);
  }

  const timestamp = getIsoTimestamp(now);
  const updated: Lab = {
    ...existing,
    ...patch,
    id: existing.id,
    name: patch.name ?? existing.name,
    configurationId: patch.configurationId ?? existing.configurationId,
    topology: patch.topology ?? existing.topology,
    createdAt: existing.createdAt,
    updatedAt: timestamp,
  };

  db.prepare('UPDATE labs SET configurationId = ?, data = ? WHERE id = ?').run(
    updated.configurationId,
    JSON.stringify(updated),
    id
  );

  reconcileServers(db, updated, existing);

  return updated;
}

/**
 * Delete a lab and remove any servers created by its bind nodes.
 */
export function deleteLab(db: Database.Database, id: string): { deleted: true } {
  const existing = getLab(db, id);
  if (existing) {
    for (const node of existing.topology?.nodes || []) {
      if (node && node.intent === 'bind') {
        deleteServerById(db, 'srv-' + existing.id + '-' + node.name);
      }
    }
    const servers = listServers(db, existing.configurationId);
    for (const s of servers) {
      if (s.id.startsWith('srv-' + existing.id + '-')) {
        deleteServerById(db, s.id);
      }
    }
    db.prepare('DELETE FROM labs WHERE id = ?').run(id);
  }
  return { deleted: true };
}
