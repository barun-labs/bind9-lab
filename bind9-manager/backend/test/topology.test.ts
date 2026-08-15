import { describe, it, expect } from 'vitest';
import { load } from 'js-yaml';
import {
  generateClabTopology,
  validateTopology,
  type TopologyModel,
} from '../src/config-engine/topology';
import { anycastTopology } from '../src/fixtures/anycastTopology';

describe('Topology config engine', () => {
  describe('generateClabTopology', () => {
    it('generates valid YAML faithful to anycast-dns topology', () => {
      const yamlStr = generateClabTopology(anycastTopology);
      expect(yamlStr).toBeTypeOf('string');

      const parsed = load(yamlStr) as any;
      expect(parsed).toBeDefined();

      // Check name and mgmt
      expect(parsed.name).toBe('dns');
      expect(parsed.mgmt).toEqual({
        network: 'dns-mgmt',
        'ipv4-subnet': '10.233.4.0/24',
      });

      // Check nodes
      expect(parsed.topology).toBeDefined();
      expect(parsed.topology.nodes).toBeDefined();

      const nodeNames = Object.keys(parsed.topology.nodes);
      expect(nodeNames).toHaveLength(anycastTopology.nodes.length);

      for (const nodeSpec of anycastTopology.nodes) {
        const generatedNode = parsed.topology.nodes[nodeSpec.name];
        expect(generatedNode).toBeDefined();
        expect(generatedNode.kind).toBe(nodeSpec.kind);

        if (nodeSpec.kind === 'bridge') {
          expect(generatedNode.image).toBeUndefined();
          expect(generatedNode['mgmt-ipv4']).toBeUndefined();
          expect(generatedNode.binds).toBeUndefined();
        } else {
          expect(generatedNode.image).toBe(nodeSpec.image);
          if (nodeSpec.mgmtIpv4) {
            expect(generatedNode['mgmt-ipv4']).toBe(nodeSpec.mgmtIpv4);
          }
          if (nodeSpec.binds) {
            expect(generatedNode.binds).toEqual(nodeSpec.binds);
          }
        }
      }

      // Check links
      expect(parsed.topology.links).toHaveLength(anycastTopology.links.length);
      for (let i = 0; i < anycastTopology.links.length; i++) {
        const link = parsed.topology.links[i];
        expect(link.endpoints).toEqual(anycastTopology.links[i].endpoints);

        // Every link endpoint references a defined node
        for (const ep of link.endpoints) {
          const nodeName = ep.split(':')[0];
          expect(parsed.topology.nodes[nodeName]).toBeDefined();
        }
      }
    });

    it('handles defaults when optional fields are omitted', () => {
      const minimalTopo: TopologyModel = {
        name: 'test-lab',
        nodes: [
          { name: 'n1', kind: 'linux', image: 'dnsnode:1.0' },
          { name: 'br1', kind: 'bridge' },
        ],
        links: [{ endpoints: ['n1:eth1', 'br1:eth1'] }],
      };

      const yamlStr = generateClabTopology(minimalTopo);
      const parsed = load(yamlStr) as any;

      expect(parsed.name).toBe('test-lab');
      expect(parsed.mgmt).toEqual({
        network: 'clab-mgmt',
      });
      expect(parsed.mgmt['ipv4-subnet']).toBeUndefined();
      expect(parsed.topology.nodes.n1).toEqual({
        kind: 'linux',
        image: 'dnsnode:1.0',
      });
      expect(parsed.topology.nodes.br1).toEqual({
        kind: 'bridge',
      });
    });
  });

  describe('validateTopology', () => {
    it('returns empty array for valid anycastTopology', () => {
      const problems = validateTopology(anycastTopology);
      expect(problems).toEqual([]);
    });

    it('detects link endpoint referencing an undefined node', () => {
      const invalidTopo: TopologyModel = {
        name: 'invalid-topo',
        nodes: [{ name: 'node1', kind: 'linux', image: 'dnsnode:1.0' }],
        links: [{ endpoints: ['node1:eth1', 'ghost-node:eth1'] }],
      };

      const problems = validateTopology(invalidTopo);
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.some((p) => p.includes('ghost-node'))).toBe(true);
    });

    it('detects linux node with no image', () => {
      const invalidTopo: TopologyModel = {
        name: 'no-image-topo',
        nodes: [{ name: 'node1', kind: 'linux' }],
        links: [],
      };

      const problems = validateTopology(invalidTopo);
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.some((p) => p.includes('node1') && p.includes('image'))).toBe(true);
    });

    it('detects duplicate node names', () => {
      const invalidTopo: TopologyModel = {
        name: 'dup-node-topo',
        nodes: [
          { name: 'node1', kind: 'linux', image: 'dnsnode:1.0' },
          { name: 'node1', kind: 'linux', image: 'dnsnode:1.0' },
        ],
        links: [],
      };

      const problems = validateTopology(invalidTopo);
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.some((p) => p.includes('node1') && p.includes('Duplicate'))).toBe(true);
    });

    it('detects duplicate mgmt-ipv4', () => {
      const invalidTopo: TopologyModel = {
        name: 'dup-ip-topo',
        nodes: [
          { name: 'node1', kind: 'linux', image: 'dnsnode:1.0', mgmtIpv4: '10.233.4.10' },
          { name: 'node2', kind: 'linux', image: 'dnsnode:1.0', mgmtIpv4: '10.233.4.10' },
        ],
        links: [],
      };

      const problems = validateTopology(invalidTopo);
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.some((p) => p.includes('10.233.4.10') && p.includes('Duplicate'))).toBe(true);
    });
  });
});
