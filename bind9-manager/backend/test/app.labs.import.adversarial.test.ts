import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { hashPassword } from '../src/server/crypto';
import * as es from '../src/server/entityStore';
import type { Runner } from '../src/config-engine';

type App = ReturnType<typeof buildApp>;

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

function seedUser(
  db: Database.Database,
  id: string,
  username: string,
  password: string,
  roles: Array<{ configurationId: string; role: 'viewer' | 'editor' | 'admin'; canDeploy: boolean }>
): void {
  const { salt, hash } = hashPassword(password);
  db.prepare(`
    INSERT INTO users (id, username, displayName, isActive, roles, pwSalt, pwHash, createdAt)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?)
  `).run(id, username, username, JSON.stringify(roles), salt, hash, new Date().toISOString());
}

async function login(app: App, username: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    payload: { username, password },
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body).token as string;
}

const validClabYaml = `
name: imported-clab
mgmt:
  network: clab-mgmt
  ipv4-subnet: 10.70.0.0/24
topology:
  nodes:
    ns1:
      kind: linux
      image: dnsnode:1.0
      mgmt-ipv4: 10.70.0.11
    router1:
      kind: linux
      image: dnsnode:1.0
    r7:
      kind: linux
      image: dnsnode:1.0
  links:
    - endpoints: ["ns1:eth1", "router1:eth1"]
`;

describe('Labs import handler — adversarial (untrusted YAML)', () => {
  let db: Database.Database;
  let mockRunner: Runner;
  let app: App;

  beforeEach(() => {
    db = openDb(':memory:');
    mockRunner = async () => ({ code: 0, stdout: 'OK', stderr: '' });
    app = buildApp(db, { runner: mockRunner });
  });

  async function importYaml(token: string, yaml: string, extra: Record<string, unknown> = {}) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/labs/import',
      headers: bearer(token),
      payload: { configurationId: 'dns-lab', yaml, ...extra },
    });
  }

  describe('malformed YAML -> 422 BAD_YAML, never 500', () => {
    const malformed = [
      ['unterminated double quote', 'name: "unterminated'],
      ['tab used as indentation', 'name: x\n\ttab: y'],
      ['unclosed flow sequence', 'topology: [a, b'],
      ['bad mapping value', 'a: b: c: d'],
      ['unterminated flow mapping', 'topology: {nodes: {ns1: '],
    ];

    for (const [label, yaml] of malformed) {
      it(`${label} -> 422 BAD_YAML`, async () => {
        const token = await login(app, 'admin', 'admin');
        const res = await importYaml(token, yaml);
        expect(res.statusCode).toBe(422);
        const body = JSON.parse(res.body);
        expect(body.error?.code).toBe('BAD_YAML');
      });
    }
  });

  describe('non-object / wrong-shape docs -> 4xx (422), never 500', () => {
    it('YAML scalar -> 422', async () => {
      const token = await login(app, 'admin', 'admin');
      const res = await importYaml(token, '"just a string"');
      expect(res.statusCode).toBe(422);
      expect(JSON.parse(res.body).error?.code).toBe('BAD_YAML');
    });

    it('null document -> 422', async () => {
      const token = await login(app, 'admin', 'admin');
      const res = await importYaml(token, 'null');
      expect(res.statusCode).toBe(422);
    });

    it('empty document -> 422', async () => {
      const token = await login(app, 'admin', 'admin');
      const res = await importYaml(token, '');
      expect(res.statusCode).toBe(422);
    });

    it('array at top level -> 422 (NOT accepted as empty lab)', async () => {
      const token = await login(app, 'admin', 'admin');
      const res = await importYaml(token, '- 1\n- 2\n- 3');
      expect(res.statusCode).toBe(422);
    });

    it('":::" -> 422 (js-yaml parses it to {"::":null}, a non-clab doc)', async () => {
      const token = await login(app, 'admin', 'admin');
      const res = await importYaml(token, ':::');
      expect(res.statusCode).toBe(422);
    });

    it('doc with no topology -> 422', async () => {
      const token = await login(app, 'admin', 'admin');
      const res = await importYaml(token, 'name: not-a-clab-doc\nmgmt:\n  network: clab-mgmt\n');
      expect(res.statusCode).toBe(422);
    });

    it('topology without nodes -> 422', async () => {
      const token = await login(app, 'admin', 'admin');
      const res = await importYaml(token, 'name: x\ntopology:\n  links: []\n');
      expect(res.statusCode).toBe(422);
    });

    it('topology as a scalar -> 422', async () => {
      const token = await login(app, 'admin', 'admin');
      const res = await importYaml(token, 'name: x\ntopology: "not-an-object"\n');
      expect(res.statusCode).toBe(422);
    });
  });

  describe('no 500 on malformed-but-parseable docs', () => {
    it('link entry that is null -> must not 500', async () => {
      const token = await login(app, 'admin', 'admin');
      const yaml = 'name: x\ntopology:\n  nodes:\n    ns1:\n      kind: linux\n      image: dnsnode:1.0\n  links:\n    - null\n';
      const res = await importYaml(token, yaml);
      expect(res.statusCode).toBeLessThan(500);
    });

    it('link entry that is a scalar string -> 4xx, not 500', async () => {
      const token = await login(app, 'admin', 'admin');
      const yaml = 'name: x\ntopology:\n  nodes:\n    ns1:\n      kind: linux\n      image: dnsnode:1.0\n  links:\n    - "just a string"\n';
      const res = await importYaml(token, yaml);
      expect(res.statusCode).toBeLessThan(500);
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('bind node with interfaces: [null] -> must not 500', async () => {
      const token = await login(app, 'admin', 'admin');
      const yaml = 'name: x\ntopology:\n  nodes:\n    ns1:\n      kind: linux\n      image: dnsnode:1.0\n      interfaces:\n        - null\n';
      const res = await importYaml(token, yaml);
      expect(res.statusCode).toBeLessThan(500);
    });
  });

  describe('prototype pollution via __proto__ / constructor', () => {
    it('does not pollute Object.prototype and does not 500', async () => {
      const token = await login(app, 'admin', 'admin');
      const yaml = '__proto__:\n  polluted: "yes"\nconstructor:\n  prototype:\n    polluted2: "yes"\ntopology:\n  nodes:\n    ns1:\n      kind: linux\n      image: dnsnode:1.0\n';
      const res = await importYaml(token, yaml);
      expect(res.statusCode).toBeLessThan(500);
      expect(({} as any).polluted).toBeUndefined();
      expect(({} as any).polluted2).toBeUndefined();
      expect((Object.prototype as any).polluted).toBeUndefined();
    });

    it('nested __proto__ key in a node does not 500', async () => {
      const token = await login(app, 'admin', 'admin');
      const yaml = 'topology:\n  nodes:\n    __proto__:\n      kind: linux\n      image: dnsnode:1.0\n    ns1:\n      kind: linux\n      image: dnsnode:1.0\n';
      const res = await importYaml(token, yaml);
      expect(res.statusCode).toBeLessThan(500);
      expect(({} as any).polluted).toBeUndefined();
    });
  });

  describe('resource abuse (bounded time, no crash)', () => {
    it('deeply nested flow document -> 4xx, no stack overflow', async () => {
      const token = await login(app, 'admin', 'admin');
      const deep = '{a: '.repeat(2000) + 'x' + '}'.repeat(2000);
      const res = await importYaml(token, deep);
      expect(res.statusCode).toBeLessThan(500);
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    }, 15000);

    it('thousands of nodes -> 201 in bounded time', async () => {
      const token = await login(app, 'admin', 'admin');
      const nodeLines: string[] = [];
      for (let i = 0; i < 2000; i += 1) {
        nodeLines.push(`    n${i}:\n      kind: linux\n      image: dnsnode:1.0`);
      }
      const yaml = `name: big\ntopology:\n  nodes:\n${nodeLines.join('\n')}\n`;
      const res = await importYaml(token, yaml);
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.topology.nodes).toHaveLength(2000);
    }, 15000);

    it('heavy anchor reuse -> 2xx in bounded time', async () => {
      const token = await login(app, 'admin', 'admin');
      const lines = ['    n0: &tmpl', '      kind: linux', '      image: dnsnode:1.0'];
      for (let i = 1; i < 2000; i += 1) {
        lines.push(`    n${i}: *tmpl`);
      }
      const yaml = `name: anchors\ntopology:\n  nodes:\n${lines.join('\n')}\n`;
      const res = await importYaml(token, yaml);
      expect(res.statusCode).toBe(201);
    }, 15000);
  });

  describe('semantic validation', () => {
    it('link to undefined node -> 422 INVALID_TOPOLOGY', async () => {
      const token = await login(app, 'admin', 'admin');
      const yaml = 'name: x\ntopology:\n  nodes:\n    ns1:\n      kind: linux\n      image: dnsnode:1.0\n  links:\n    - endpoints: ["ns1:eth1", "ghost-node:eth1"]\n';
      const res = await importYaml(token, yaml);
      expect(res.statusCode).toBe(422);
      expect(JSON.parse(res.body).error?.code).toBe('INVALID_TOPOLOGY');
    });

    it('valid doc -> 201 with topology preserved', async () => {
      const token = await login(app, 'admin', 'admin');
      const res = await importYaml(token, validClabYaml);
      expect(res.statusCode).toBe(201);
      const lab = JSON.parse(res.body);
      expect(lab.topology.name).toBe('imported-clab');
      expect(lab.topology.mgmtSubnet).toBe('10.70.0.0/24');
      expect(lab.topology.nodes).toHaveLength(3);
      expect(lab.topology.links).toHaveLength(1);
      expect(lab.topology.links[0].endpoints).toEqual(['ns1:eth1', 'router1:eth1']);
    });

    it('router-named node -> intent router, NOT reconciled to a Server', async () => {
      const token = await login(app, 'admin', 'admin');
      const res = await importYaml(token, validClabYaml);
      expect(res.statusCode).toBe(201);
      const lab = JSON.parse(res.body);

      const byName = (n: string) => lab.topology.nodes.find((x: any) => x.name === n);
      expect(byName('ns1').intent).toBe('bind');
      expect(byName('router1').intent).toBe('router');
      expect(byName('r7').intent).toBe('router');

      const servers = es.listServers(db, 'dns-lab');
      expect(servers.find((s) => s.nodeName === 'ns1')).toBeDefined();
      expect(servers.find((s) => s.nodeName === 'router1')).toBeUndefined();
      expect(servers.find((s) => s.nodeName === 'r7')).toBeUndefined();
    });
  });

  describe('permissions', () => {
    beforeEach(() => {
      seedUser(db, 'usr-viewer', 'viewer1', 'viewerpass', [
        { configurationId: 'dns-lab', role: 'viewer', canDeploy: false },
      ]);
    });

    it('viewer -> 403 on import; 200 on render and validate', async () => {
      const adminToken = await login(app, 'admin', 'admin');
      const viewerToken = await login(app, 'viewer1', 'viewerpass');

      const created = await importYaml(adminToken, validClabYaml);
      expect(created.statusCode).toBe(201);
      const labId = JSON.parse(created.body).id as string;

      const imp = await importYaml(viewerToken, validClabYaml);
      expect(imp.statusCode).toBe(403);

      const render = await app.inject({ method: 'POST', url: `/api/v1/labs/${labId}/render`, headers: bearer(viewerToken) });
      expect(render.statusCode).toBe(200);

      const validate = await app.inject({ method: 'POST', url: `/api/v1/labs/${labId}/validate`, headers: bearer(viewerToken) });
      expect(validate.statusCode).toBe(200);
    });

    it('unauth -> 401 on import, render, yaml, validate', async () => {
      const importRes = await app.inject({ method: 'POST', url: '/api/v1/labs/import', payload: { configurationId: 'dns-lab', yaml: 'name: x' } });
      expect(importRes.statusCode).toBe(401);

      const renderRes = await app.inject({ method: 'POST', url: '/api/v1/labs/lab-1/render' });
      expect(renderRes.statusCode).toBe(401);

      const yamlRes = await app.inject({ method: 'GET', url: '/api/v1/labs/lab-1/yaml' });
      expect(yamlRes.statusCode).toBe(401);

      const validateRes = await app.inject({ method: 'POST', url: '/api/v1/labs/lab-1/validate' });
      expect(validateRes.statusCode).toBe(401);
    });
  });

  describe('no secret leakage', () => {
    it('import, render, and validate responses contain no token/keyHash/pwHash/pwSalt/password', async () => {
      const token = await login(app, 'admin', 'admin');
      const created = await importYaml(token, validClabYaml);
      expect(created.statusCode).toBe(201);
      const labId = JSON.parse(created.body).id as string;

      const render = await app.inject({ method: 'POST', url: `/api/v1/labs/${labId}/render`, headers: bearer(token) });
      expect(render.statusCode).toBe(200);

      const validate = await app.inject({ method: 'POST', url: `/api/v1/labs/${labId}/validate`, headers: bearer(token) });
      expect(validate.statusCode).toBe(200);

      const needles = ['"token"', '"keyhash"', '"pwhash"', '"pwsalt"', '"password"'];
      for (const [label, res] of [
        ['import', created],
        ['render', render],
        ['validate', validate],
      ] as const) {
        const body = res.body.toLowerCase();
        for (const n of needles) {
          expect(body, `${label} leaks ${n}`).not.toContain(n);
        }
      }
    });
  });
});
