import { describe, test, expect } from 'vitest';
import { generateClabYaml, parseClabYaml, validateClientTopology } from './clabYaml';
import type { TopologyModel } from '../types/entities';

describe('clabYaml utility', () => {
  test('generateClabYaml produces formatted YAML', () => {
    const topo: TopologyModel = {
      name: 'test-lab',
      mgmtNetwork: 'clab-mgmt',
      mgmtSubnet: '10.70.0.0/24',
      nodes: [
        {
          name: 'ns1',
          kind: 'linux',
          intent: 'bind',
          image: 'dnsnode:1.0',
          mgmtIpv4: '10.70.0.11',
          binds: ['./conf:/etc/bind'],
        },
        {
          name: 'r1',
          kind: 'linux',
          intent: 'router',
          image: 'dnsnode:1.0',
          mgmtIpv4: '10.70.0.1',
        },
        {
          name: 'br0',
          kind: 'bridge',
          intent: 'bridge',
        },
      ],
      links: [
        { endpoints: ['ns1:eth1', 'r1:eth1'] },
      ],
    };

    const yaml = generateClabYaml(topo);
    expect(yaml).toContain('name: test-lab');
    expect(yaml).toContain('ipv4-subnet: 10.70.0.0/24');
    expect(yaml).toContain('ns1:');
    expect(yaml).toContain('image: dnsnode:1.0');
    expect(yaml).toContain('mgmt-ipv4: 10.70.0.11');
    expect(yaml).toContain('br0:');
    expect(yaml).toContain('kind: bridge');
    expect(yaml).toContain('endpoints: ["ns1:eth1", "r1:eth1"]');
  });

  test('parseClabYaml parses standard clab.yml and round-trips', () => {
    const yaml = `
name: sample-lab
mgmt:
  network: clab-mgmt
  ipv4-subnet: 10.70.0.0/24
topology:
  nodes:
    ns1:
      kind: linux
      image: dnsnode:1.0
      mgmt-ipv4: 10.70.0.11
    r1:
      kind: linux
      image: dnsnode:1.0
      mgmt-ipv4: 10.70.0.1
    br0:
      kind: bridge
  links:
    - endpoints: ["ns1:eth1", "r1:eth1"]
`;

    const parsed = parseClabYaml(yaml);
    expect(parsed.name).toBe('sample-lab');
    expect(parsed.mgmtNetwork).toBe('clab-mgmt');
    expect(parsed.mgmtSubnet).toBe('10.70.0.0/24');
    expect(parsed.nodes).toHaveLength(3);

    const ns1 = parsed.nodes.find((n) => n.name === 'ns1');
    expect(ns1).toBeDefined();
    expect(ns1?.kind).toBe('linux');
    expect(ns1?.intent).toBe('bind');
    expect(ns1?.image).toBe('dnsnode:1.0');
    expect(ns1?.mgmtIpv4).toBe('10.70.0.11');

    const r1 = parsed.nodes.find((n) => n.name === 'r1');
    expect(r1).toBeDefined();
    expect(r1?.intent).toBe('router');

    const br0 = parsed.nodes.find((n) => n.name === 'br0');
    expect(br0).toBeDefined();
    expect(br0?.intent).toBe('bridge');

    expect(parsed.links).toHaveLength(1);
    expect(parsed.links[0].endpoints).toEqual(['ns1:eth1', 'r1:eth1']);
  });

  test('validateClientTopology catches errors', () => {
    const topo: TopologyModel = {
      name: 'bad-lab',
      nodes: [
        { name: 'ns1', kind: 'linux', image: '' },
        { name: 'ns1', kind: 'linux', image: 'img:1.0' },
        { name: 'r1', kind: 'linux', image: 'img:1.0', mgmtIpv4: '10.0.0.1' },
        { name: 'r2', kind: 'linux', image: 'img:1.0', mgmtIpv4: '10.0.0.1' },
      ],
      links: [
        { endpoints: ['ns1:eth1', 'nonexistent:eth1'] },
      ],
    };

    const errors = validateClientTopology(topo);
    expect(errors.some((e) => e.includes('no image'))).toBe(true);
    expect(errors.some((e) => e.includes('Duplicate node name'))).toBe(true);
    expect(errors.some((e) => e.includes('Duplicate mgmt-ipv4'))).toBe(true);
    expect(errors.some((e) => e.includes('undefined node'))).toBe(true);
  });
});
