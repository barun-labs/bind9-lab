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

// containerlab's `kind: bridge` node references a Linux bridge on the HOST
// — it never creates that bridge itself (unlike its other node kinds).
// Without this, `containerlab deploy` fails outright with "Bridge ... does
// not exist" for any topology using bridge nodes. Mirrors
// anycast-dns/setup.sh's `sudo ip link add <name> type bridge` bring-up.
function bridgeSetupCommands(topology: TopologyModel): string[] {
  const commands: string[] = [];
  for (const node of topology.nodes) {
    if (node.kind !== 'bridge') continue;
    const name = shellQuote(node.name);
    commands.push(`sudo ip link show ${name} >/dev/null 2>&1 || sudo ip link add ${name} type bridge`);
    commands.push(`sudo ip link set ${name} up`);
  }
  return commands;
}

// Data-plane provisioning: assign interface addresses, bring links up,
// enable ip_forward on routers, and add routes — for every linux topology
// node that carries this addressing info, regardless of whether it also
// has a BIND role. Mirrors anycast-dns/deploy.sh's `ip addr replace` /
// `ip route replace` bring-up, run here via containerlab's `docker exec`
// instead of a hand-written shell script.
function provisionCommands(topology: TopologyModel): string[] {
  const commands: string[] = [];

  for (const node of topology.nodes) {
    if (node.kind !== 'linux') continue;

    const hasProvisioning =
      (node.interfaces && node.interfaces.length > 0) ||
      node.ipForward ||
      node.defaultVia !== undefined ||
      (node.routes && node.routes.length > 0);
    if (!hasProvisioning) continue;

    const container = `clab-${topology.name}-${node.name}`;
    const c = shellQuote(container);

    for (const iface of node.interfaces ?? []) {
      const ifaceName = shellQuote(iface.name);
      // `replace`, not `add`: idempotent across re-deploys of the same
      // node, matching anycast-dns/deploy.sh's `ip addr replace`.
      commands.push(
        `docker exec ${c} ip addr replace ${shellQuote(iface.address)} dev ${ifaceName}`,
      );
      commands.push(`docker exec ${c} ip link set ${ifaceName} up`);
    }

    if (node.ipForward) {
      commands.push(`docker exec ${c} sysctl -w net.ipv4.ip_forward=1`);
    }

    if (node.defaultVia !== undefined) {
      // `replace`, not `add`: containerlab's mgmt network already installs
      // a default route via eth0, so a plain `ip route add default` fails
      // with "File exists".
      commands.push(
        `docker exec ${c} ip route replace default via ${shellQuote(node.defaultVia)}`,
      );
    }

    for (const route of node.routes ?? []) {
      commands.push(
        `docker exec ${c} ip route replace ${shellQuote(route.to)} via ${shellQuote(route.via)}`,
      );
    }
  }

  return commands;
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

  plan.push(...bridgeSetupCommands(topology));
  plan.push(`containerlab deploy -t ${labDir}/topo.clab.yml --reconfigure`);
  plan.push(...provisionCommands(topology));

  for (const { serverId } of bindServers(model, topology)) {
    plan.push(
      `docker exec clab-${topology.name}-${serverId} rndc reload (or start named if not running)`,
    );
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

  lines.push(...bridgeSetupCommands(topology));

  lines.push(
    `containerlab deploy -t ${shellQuote(`${labDir}/topo.clab.yml`)} --reconfigure`,
  );

  lines.push(...provisionCommands(topology));

  for (const { serverId } of bindServers(model, topology)) {
    // containerlab prefixes every container it creates with `clab-`, so the
    // real container name is `clab-<topology.name>-<serverId>`, not
    // `<topology.name>-<serverId>`.
    const container = `clab-${topology.name}-${serverId}`;
    const c = shellQuote(container);
    lines.push(`NODE_ID=${shellQuote(serverId)}`);
    lines.push(`echo "${NODE_BEGIN} $NODE_ID"`);
    // The dnsnode:1.0 entrypoint only starts dropbear, not named, and never
    // prepares /var/log for it. Prime the directories named needs before
    // touching it, then either reload an already-running named or cold
    // start it, mirroring the proven bring-up in anycast-dns/dns-deploy.sh.
    lines.push(`docker exec ${c} mkdir -p /var/log /run/named /var/bind 2>&1`);
    lines.push(`docker exec ${c} touch /var/log/named.log 2>&1`);
    lines.push(
      `docker exec ${c} chown named:named /var/log/named.log /run/named /var/bind 2>&1`,
    );
    lines.push(`if docker exec ${c} pidof named >/dev/null 2>&1; then`);
    lines.push(`  docker exec ${c} rndc reload 2>&1`);
    lines.push(`else`);
    lines.push(`  docker exec ${c} named -u named -c /etc/bind/named.conf 2>&1`);
    lines.push(`fi`);
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
  if (
    !topology.name ||
    /^dns$/.test(topology.name) ||
    topology.name.startsWith('clab-') ||
    !/^[A-Za-z0-9_-]+$/.test(topology.name)
  ) {
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
