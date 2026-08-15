/// <reference types="node" />
import path from 'path';
import type { ConfigModel } from '../config-engine/model';
import type { TopologyModel } from '../config-engine/topology';
import { generateServerConfig, validateConfig } from '../config-engine';
import { generateClabTopology } from '../config-engine/topology';
import { shellQuote } from '../config-engine/shellQuote';

export type Runner = (
  bashScript: string,
) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface DeployResult {
  validated: { serverId: string; ok: boolean; errors: string[] }[];
  plan?: string[];
  aborted?: string;
  deployed?: { serverId: string; ok: boolean; output: string }[];
}

export interface DeployOptions {
  run: Runner;
  labDir: string;
  dryRun?: boolean;
}

const NODE_BEGIN = '__BIND9MGR_NODE_BEGIN__';
const NODE_END = '__BIND9MGR_NODE_END__';

function b64(content: string): string {
  return Buffer.from(content, 'utf-8').toString('base64');
}

interface ServerFiles {
  serverId: string;
  files: Record<string, string>;
}

function filesForServers(model: ConfigModel): ServerFiles[] {
  return model.servers.map((server) => ({
    serverId: server.id,
    files: generateServerConfig(model, server.id),
  }));
}

// BIND servers are model servers that also exist as linux nodes in the topology,
// so `${lab}-${node}` is a real container name.
function bindServers(model: ConfigModel, topology: TopologyModel): ServerFiles[] {
  const linuxNodes = new Set(
    topology.nodes.filter((node) => node.kind === 'linux').map((node) => node.name),
  );
  return filesForServers(model).filter((entry) => linuxNodes.has(entry.serverId));
}

function buildPlan(
  model: ConfigModel,
  topology: TopologyModel,
  labDir: string,
): string[] {
  const plan: string[] = [`mkdir -p ${labDir}`];
  plan.push(`write ${labDir}/topo.clab.yml`);

  for (const { serverId, files } of filesForServers(model)) {
    for (const filePath of Object.keys(files)) {
      plan.push(`write ${labDir}/configs/${serverId}/${filePath}`);
    }
  }

  plan.push(`containerlab deploy -t ${labDir}/topo.clab.yml --reconfigure`);

  for (const { serverId } of bindServers(model, topology)) {
    plan.push(`docker exec ${topology.name}-${serverId} rndc reload`);
  }

  return plan;
}

function buildDeployScript(
  model: ConfigModel,
  topology: TopologyModel,
  labDir: string,
): string {
  const lines: string[] = ['#!/usr/bin/env bash'];

  const dirs = new Set<string>([labDir]);
  for (const { serverId, files } of filesForServers(model)) {
    for (const filePath of Object.keys(files)) {
      const full = `${labDir}/configs/${serverId}/${filePath}`;
      dirs.add(path.posix.dirname(full));
    }
  }
  for (const dir of dirs) {
    lines.push(`mkdir -p ${shellQuote(dir)}`);
  }

  lines.push(
    `echo '${b64(generateClabTopology(topology))}' | base64 -d > ${shellQuote(
      `${labDir}/topo.clab.yml`,
    )}`,
  );

  for (const { serverId, files } of filesForServers(model)) {
    for (const [filePath, content] of Object.entries(files)) {
      lines.push(
        `echo '${b64(content)}' | base64 -d > ${shellQuote(
          `${labDir}/configs/${serverId}/${filePath}`,
        )}`,
      );
    }
  }

  lines.push(
    `containerlab deploy -t ${shellQuote(`${labDir}/topo.clab.yml`)} --reconfigure`,
  );

  for (const { serverId } of bindServers(model, topology)) {
    const container = `${topology.name}-${serverId}`;
    lines.push(`NODE_ID=${shellQuote(serverId)}`);
    lines.push(`echo "${NODE_BEGIN} $NODE_ID"`);
    lines.push(`docker exec ${shellQuote(container)} rndc reload 2>&1`);
    lines.push(`RC=$?`);
    lines.push(`echo "${NODE_END} $NODE_ID $RC"`);
  }

  return lines.join('\n') + '\n';
}

function parseDeployed(
  stdout: string,
  bindNodes: ServerFiles[],
): { serverId: string; ok: boolean; output: string }[] {
  const outputLines = stdout.split('\n');

  return bindNodes.map(({ serverId }) => {
    const beginMarker = `${NODE_BEGIN} ${serverId}`;
    const endMarker = `${NODE_END} ${serverId} `;

    let capturing = false;
    let ok = false;
    const chunks: string[] = [];

    for (const line of outputLines) {
      if (line.includes(beginMarker)) {
        capturing = true;
        continue;
      }
      if (line.startsWith(endMarker)) {
        const rcText = line.slice(endMarker.length).trim();
        ok = Number.parseInt(rcText, 10) === 0;
        break;
      }
      if (capturing) {
        chunks.push(line);
      }
    }

    return { serverId, ok, output: chunks.join('\n').trim() };
  });
}

export async function deploy(
  model: ConfigModel,
  topology: TopologyModel,
  opts: DeployOptions,
): Promise<DeployResult> {
  if (/^dns$/.test(topology.name) || topology.name.startsWith('clab-')) {
    return {
      validated: [],
      aborted: 'refusing to target a reserved/production lab name: ' + topology.name,
    };
  }

  const validated: { serverId: string; ok: boolean; errors: string[] }[] = [];

  for (const { serverId, files } of filesForServers(model)) {
    const result = await validateConfig(files, opts.run);
    validated.push({ serverId, ok: result.ok, errors: result.errors });
  }

  if (validated.some((entry) => !entry.ok)) {
    return { validated, aborted: 'pre-flight failed' };
  }

  if (opts.dryRun) {
    return { validated, plan: buildPlan(model, topology, opts.labDir) };
  }

  const script = buildDeployScript(model, topology, opts.labDir);
  const result = await opts.run(script);
  const deployed = parseDeployed(result.stdout, bindServers(model, topology));

  return { validated, deployed };
}
