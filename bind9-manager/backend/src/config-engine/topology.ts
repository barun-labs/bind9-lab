import { dump } from 'js-yaml';

export interface NodeSpec {
  name: string;
  kind: 'linux' | 'bridge';
  image?: string;
  mgmtIpv4?: string;
  binds?: string[];
}

export interface LinkSpec {
  endpoints: [string, string];
}

export interface TopologyModel {
  name: string;
  mgmtNetwork?: string;
  mgmtSubnet?: string;
  nodes: NodeSpec[];
  links: LinkSpec[];
}

export function generateClabTopology(topo: TopologyModel): string {
  const mgmt: Record<string, any> = {
    network: topo.mgmtNetwork ?? 'clab-mgmt',
  };
  if (topo.mgmtSubnet !== undefined) {
    mgmt['ipv4-subnet'] = topo.mgmtSubnet;
  }

  const nodes: Record<string, any> = {};
  for (const node of topo.nodes) {
    if (node.kind === 'bridge') {
      nodes[node.name] = {
        kind: 'bridge',
      };
    } else {
      const nodeObj: Record<string, any> = {
        kind: node.kind,
      };
      if (node.image !== undefined) {
        nodeObj.image = node.image;
      }
      if (node.mgmtIpv4 !== undefined) {
        nodeObj['mgmt-ipv4'] = node.mgmtIpv4;
      }
      if (node.binds !== undefined && node.binds.length > 0) {
        nodeObj.binds = node.binds;
      }
      nodes[node.name] = nodeObj;
    }
  }

  const links = topo.links.map((link) => ({
    endpoints: link.endpoints,
  }));

  const doc = {
    name: topo.name,
    mgmt,
    topology: {
      nodes,
      links,
    },
  };

  return dump(doc, { lineWidth: -1 });
}

export function validateTopology(topo: TopologyModel): string[] {
  const problems: string[] = [];

  const seenNodeNames = new Set<string>();
  const duplicateNodeNames = new Set<string>();
  const seenIps = new Set<string>();
  const duplicateIps = new Set<string>();

  for (const node of topo.nodes) {
    if (seenNodeNames.has(node.name)) {
      duplicateNodeNames.add(node.name);
    } else {
      seenNodeNames.add(node.name);
    }

    if (node.mgmtIpv4) {
      if (seenIps.has(node.mgmtIpv4)) {
        duplicateIps.add(node.mgmtIpv4);
      } else {
        seenIps.add(node.mgmtIpv4);
      }
    }

    if (node.kind === 'linux' && (!node.image || node.image.trim() === '')) {
      problems.push(`Linux node '${node.name}' has no image specified`);
    }
  }

  for (const name of duplicateNodeNames) {
    problems.push(`Duplicate node name '${name}'`);
  }

  for (const ip of duplicateIps) {
    problems.push(`Duplicate mgmt-ipv4 '${ip}'`);
  }

  for (const link of topo.links) {
    if (!link.endpoints || link.endpoints.length !== 2) {
      problems.push(`Link has invalid endpoints definition: ${JSON.stringify(link.endpoints)}`);
      continue;
    }

    for (const ep of link.endpoints) {
      if (!ep || typeof ep !== 'string') {
        problems.push(`Link endpoint is invalid: ${JSON.stringify(ep)}`);
        continue;
      }
      const colonIdx = ep.indexOf(':');
      const nodeName = colonIdx === -1 ? ep.trim() : ep.slice(0, colonIdx).trim();

      if (!seenNodeNames.has(nodeName)) {
        problems.push(`Link endpoint '${ep}' references undefined node '${nodeName}'`);
      }
    }
  }

  return problems;
}
