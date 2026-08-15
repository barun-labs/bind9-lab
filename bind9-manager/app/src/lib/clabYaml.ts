import type { TopologyModel, NodeSpec, LinkSpec } from '../types/entities';

/**
 * Generate containerlab clab.yml from a TopologyModel.
 */
export function generateClabYaml(topo: TopologyModel): string {
  const lines: string[] = [];
  lines.push(`name: ${topo.name || 'lab'}`);
  lines.push(`mgmt:`);
  lines.push(`  network: ${topo.mgmtNetwork || 'clab-mgmt'}`);
  if (topo.mgmtSubnet) {
    lines.push(`  ipv4-subnet: ${topo.mgmtSubnet}`);
  }

  lines.push(`topology:`);
  lines.push(`  nodes:`);

  for (const node of topo.nodes || []) {
    lines.push(`    ${node.name}:`);
    if (node.kind === 'bridge') {
      lines.push(`      kind: bridge`);
    } else {
      lines.push(`      kind: ${node.kind || 'linux'}`);
      if (node.image) {
        lines.push(`      image: ${node.image}`);
      }
      if (node.mgmtIpv4) {
        lines.push(`      mgmt-ipv4: ${node.mgmtIpv4}`);
      }
      if (node.binds && node.binds.length > 0) {
        lines.push(`      binds:`);
        for (const b of node.binds) {
          lines.push(`        - ${b}`);
        }
      }
    }
  }

  lines.push(`  links:`);
  for (const link of topo.links || []) {
    if (link.endpoints && link.endpoints.length === 2) {
      lines.push(`    - endpoints: ["${link.endpoints[0]}", "${link.endpoints[1]}"]`);
    }
  }

  return lines.join('\n') + '\n';
}

function stripQuotes(val: string): string {
  const trimmed = val.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Parse containerlab clab.yml into a TopologyModel.
 */
export function parseClabYaml(yamlText: string, defaultName?: string): TopologyModel {
  const rawLines = yamlText.split(/\r?\n/);
  const lines: { indent: number; text: string; raw: string }[] = [];

  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = raw.search(/\S/);
    lines.push({ indent, text: trimmed, raw });
  }

  let labName = defaultName || 'imported-lab';
  let mgmtNetwork: string | undefined;
  let mgmtSubnet: string | undefined;
  const nodes: NodeSpec[] = [];
  const links: LinkSpec[] = [];

  let currentSection: '' | 'mgmt' | 'nodes' | 'links' = '';
  let currentNode: Partial<NodeSpec> | null = null;
  let inBinds = false;

  for (let i = 0; i < lines.length; i++) {
    const { indent, text } = lines[i];

    if (indent === 0) {
      if (text.startsWith('name:')) {
        const val = stripQuotes(text.slice('name:'.length));
        if (val) labName = val;
      } else if (text.startsWith('mgmt:')) {
        currentSection = 'mgmt';
      } else if (text.startsWith('topology:')) {
        currentSection = '';
      }
      continue;
    }

    if (currentSection === 'mgmt') {
      if (indent === 2) {
        if (text.startsWith('network:')) {
          mgmtNetwork = stripQuotes(text.slice('network:'.length));
        } else if (text.startsWith('ipv4-subnet:') || text.startsWith('ipv4Subnet:') || text.startsWith('mgmtSubnet:')) {
          const colonIdx = text.indexOf(':');
          mgmtSubnet = stripQuotes(text.slice(colonIdx + 1));
        }
      } else if (indent === 0) {
        currentSection = '';
      }
    }

    if (text.startsWith('nodes:')) {
      currentSection = 'nodes';
      currentNode = null;
      inBinds = false;
      continue;
    }

    if (text.startsWith('links:')) {
      if (currentNode && currentNode.name) {
        finalizeNode(currentNode, nodes);
        currentNode = null;
      }
      currentSection = 'links';
      continue;
    }

    if (currentSection === 'nodes') {
      const nodeMatch = text.match(/^([A-Za-z0-9_-]+):$/);
      if (nodeMatch && (indent === 4 || indent === 2) && !text.startsWith('kind:') && !text.startsWith('image:') && !text.startsWith('binds:') && !text.startsWith('mgmt-ipv4:')) {
        if (currentNode && currentNode.name) {
          finalizeNode(currentNode, nodes);
        }
        currentNode = {
          name: nodeMatch[1],
          kind: 'linux',
          binds: [],
          interfaces: [],
        };
        inBinds = false;
        continue;
      }

      if (currentNode) {
        if (text.startsWith('kind:')) {
          inBinds = false;
          const k = stripQuotes(text.slice('kind:'.length)).toLowerCase();
          currentNode.kind = k === 'bridge' ? 'bridge' : 'linux';
        } else if (text.startsWith('image:')) {
          inBinds = false;
          currentNode.image = stripQuotes(text.slice('image:'.length));
        } else if (text.startsWith('mgmt-ipv4:') || text.startsWith('mgmt_ipv4:') || text.startsWith('mgmtIpv4:')) {
          inBinds = false;
          const colonIdx = text.indexOf(':');
          currentNode.mgmtIpv4 = stripQuotes(text.slice(colonIdx + 1));
        } else if (text.startsWith('binds:')) {
          inBinds = true;
          if (!currentNode.binds) currentNode.binds = [];
        } else if (inBinds && text.startsWith('-')) {
          const bindVal = stripQuotes(text.slice(1));
          if (bindVal && currentNode.binds) {
            currentNode.binds.push(bindVal);
          }
        }
      }
    }

    if (currentSection === 'links') {
      if (text.includes('endpoints:')) {
        const bracketMatch = text.match(/endpoints:\s*\[\s*([^,\]]+)\s*,\s*([^,\]]+)\s*\]/);
        if (bracketMatch) {
          const ep1 = stripQuotes(bracketMatch[1]);
          const ep2 = stripQuotes(bracketMatch[2]);
          if (ep1 && ep2) {
            links.push({ endpoints: [ep1, ep2] });
          }
        } else {
          let ep1 = '';
          let ep2 = '';
          if (i + 1 < lines.length && lines[i + 1].text.startsWith('-')) {
            ep1 = stripQuotes(lines[i + 1].text.slice(1));
            i++;
          }
          if (i + 1 < lines.length && lines[i + 1].text.startsWith('-')) {
            ep2 = stripQuotes(lines[i + 1].text.slice(1));
            i++;
          }
          if (ep1 && ep2) {
            links.push({ endpoints: [ep1, ep2] });
          }
        }
      }
    }
  }

  if (currentNode && currentNode.name) {
    finalizeNode(currentNode, nodes);
  }

  return {
    name: labName,
    mgmtNetwork,
    mgmtSubnet,
    nodes,
    links,
  };
}

function finalizeNode(node: Partial<NodeSpec>, nodes: NodeSpec[]): void {
  const name = node.name || 'node';
  const kind = node.kind || 'linux';

  let intent: 'bind' | 'router' | 'bridge';
  if (kind === 'bridge') {
    intent = 'bridge';
  } else if (/router|^r\d/i.test(name)) {
    intent = 'router';
  } else {
    intent = 'bind';
  }

  nodes.push({
    name,
    kind,
    intent,
    image: node.image,
    mgmtIpv4: node.mgmtIpv4,
    binds: node.binds || [],
    interfaces: node.interfaces || [],
  });
}

/**
 * Validate a TopologyModel for common syntax and configuration issues.
 */
export function validateClientTopology(topo: TopologyModel): string[] {
  const problems: string[] = [];

  const seenNodeNames = new Set<string>();
  const duplicateNodeNames = new Set<string>();
  const seenIps = new Set<string>();
  const duplicateIps = new Set<string>();

  for (const node of topo.nodes || []) {
    if (!node || typeof node !== 'object') continue;

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

  for (let i = 0; i < (topo.links || []).length; i++) {
    const link = topo.links[i];
    if (!link || !Array.isArray(link.endpoints) || link.endpoints.length !== 2) {
      problems.push(`Link ${i + 1} has invalid endpoints definition`);
      continue;
    }

    for (const ep of link.endpoints) {
      if (!ep || typeof ep !== 'string') {
        problems.push(`Link ${i + 1} endpoint is invalid`);
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
