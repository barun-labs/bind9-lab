import type { Lab } from './labStore';
import type { Runner, RuntimeNode } from './deployEngine';
import { parseInspect } from './deployEngine';
import { shellQuote } from '../config-engine/shellQuote';

export interface TelemetryNode {
  nodeName: string;
  containerName: string; // clab-<topo>-<node>, derived server-side
  containerId?: string;
  state?: string; // from inspect
  status?: string;
  address?: string; // inspect ipv4, /NN stripped
  cpuPerc?: string; // from docker stats, verbatim e.g. "0.15%"
  memPerc?: string;
  memUsage?: string; // e.g. "12.3MiB / 1.9GiB"
  netIO?: string;
  blockIO?: string;
  pids?: string;
  present: boolean; // true iff an inspect entry matched this node's container
}

export interface TelemetrySnapshot {
  nodes: TelemetryNode[];
  at: string;
  runtimeError?: string;
}

function nowIso(): string {
  try {
    return new Date().toISOString();
  } catch {
    return '2026-08-15T00:00:00.000Z';
  }
}

/**
 * `docker stats --no-stream --format '{{json .}}'` prints one JSON object
 * per line. Skip unparseable lines rather than throw — a single malformed
 * line from a flaky docker CLI should not blank out every other container's
 * stats.
 */
export function parseDockerStats(stdout: string): Record<string, any> {
  const byName: Record<string, any> = {};
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed);
      if (row && typeof row === 'object' && typeof row.Name === 'string') {
        byName[row.Name] = row;
      }
    } catch {
      // skip unparseable line
    }
  }
  return byName;
}

export async function snapshot(
  lab: Lab,
  run: Runner,
  labDir: string,
): Promise<TelemetrySnapshot> {
  const at = nowIso();

  // Container names are derived here, server-side, from the lab's own
  // topology — never from request input — so nothing downstream can be
  // steered at a foreign container.
  const bindNodes = (lab.topology?.nodes || []).filter((n) => n && n.intent === 'bind');
  const names = bindNodes.map((node) => 'clab-' + lab.topology.name + '-' + node.name);

  const inspect = await run(
    `containerlab inspect -t ${shellQuote(labDir + '/topo.clab.yml')} --format json`,
  );

  if (inspect.code !== 0) {
    return {
      nodes: bindNodes.map((node, i) => ({
        nodeName: node.name,
        containerName: names[i],
        present: false,
      })),
      at,
      runtimeError: `inspect exited ${inspect.code}: ${inspect.stderr.trim().slice(0, 500)}`,
    };
  }

  const runtimeNodes: RuntimeNode[] = parseInspect(inspect.stdout);

  let statsByName: Record<string, any> = {};
  if (names.length > 0) {
    const stats = await run(
      `docker stats --no-stream --format '{{json .}}' ${names.map(shellQuote).join(' ')}`,
    );
    if (stats.code === 0) {
      statsByName = parseDockerStats(stats.stdout);
    }
    // A failed stats call is non-fatal — leave stats fields undefined.
  }

  const nodes: TelemetryNode[] = bindNodes.map((node, i) => {
    const containerName = names[i];
    const inspected = runtimeNodes.find((r) => r.name === containerName);
    const statsRow = statsByName[containerName];

    const telemetryNode: TelemetryNode = {
      nodeName: node.name,
      containerName,
      present: Boolean(inspected),
    };

    if (inspected) {
      telemetryNode.containerId = inspected.containerId;
      telemetryNode.state = inspected.state;
      telemetryNode.status = inspected.status;
      if (inspected.ipv4Address) {
        telemetryNode.address = inspected.ipv4Address.split('/')[0];
      }
    }

    if (statsRow) {
      telemetryNode.cpuPerc = statsRow.CPUPerc;
      telemetryNode.memPerc = statsRow.MemPerc;
      telemetryNode.memUsage = statsRow.MemUsage;
      telemetryNode.netIO = statsRow.NetIO;
      telemetryNode.blockIO = statsRow.BlockIO;
      telemetryNode.pids = statsRow.PIDs;
    }

    return telemetryNode;
  });

  return { nodes, at };
}
