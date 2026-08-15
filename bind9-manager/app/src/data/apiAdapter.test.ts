import { makeStore } from './store';
import * as api from './apiAdapter';
test('listRecords filters+paginates zone-lab', async () => {
  const s = makeStore();
  const r = await api.listRecords(s,'zone-lab',{type:'A',page:1,size:5});
  expect(r.data.every(x=>x.type==='A')).toBe(true);
  expect(r.total).toBeGreaterThan(0);
  expect(r.data.length).toBeLessThanOrEqual(5);
});
test('createRecord then it appears', async () => {
  const s = makeStore();
  const before = (await api.listRecords(s,'zone-lab',{page:1,size:9999})).total;
  await api.createRecord(s,'zone-lab',{name:'new1',type:'A',ttl:300,rdata:{address:'10.20.30.99'}});
  const after = (await api.listRecords(s,'zone-lab',{page:1,size:9999})).total;
  expect(after).toBe(before+1);
});
test('createApiKey returns token once, list hides it', async () => {
  const s = makeStore();
  const k = await api.createApiKey(s,'ci');
  expect(k.token).toBeTruthy();
  const listed = (await api.listApiKeys(s)).data.find(x=>x.id===k.id)!;
  expect(listed.token).toBeUndefined();
});
test('createApiKey stamps ownerUserId and scopes', async () => {
  const s = makeStore();
  const k = await api.createApiKey(s, {
    name: 'deployer',
    ownerUserId: 'usr-editor',
    scopes: ['read', 'deploy'],
    readOnly: false,
    expiresAt: '2026-12-31T23:59:59Z',
  });
  expect(k.ownerUserId).toBe('usr-editor');
  expect(k.scopes).toEqual(['read', 'deploy']);
  expect(k.readOnly).toBe(false);
  expect(k.expiresAt).toBe('2026-12-31T23:59:59Z');
  const listed = (await api.listApiKeys(s)).data.find((x) => x.id === k.id)!;
  expect(listed.ownerUserId).toBe('usr-editor');
  expect(listed.scopes).toEqual(['read', 'deploy']);
});

test('labs CRUD, render, import, validate operations', async () => {
  const s = makeStore();
  const list1 = await api.listLabs(s, 'dns-lab');
  expect(list1.total).toBeGreaterThan(0);

  const lab = await api.createLab(s, {
    name: 'custom-lab',
    configurationId: 'dns-lab',
    topology: {
      name: 'custom-lab',
      nodes: [
        { name: 'ns1', kind: 'linux', intent: 'bind', image: 'dnsnode:1.0', mgmtIpv4: '10.70.0.11' },
      ],
      links: [],
    },
  });
  expect(lab.id).toBeTruthy();
  expect(lab.name).toBe('custom-lab');

  const fetched = await api.getLab(s, lab.id);
  expect(fetched).not.toBeNull();
  expect(fetched?.name).toBe('custom-lab');

  const rendered = await api.renderLab(s, lab.id);
  expect(rendered.yaml).toContain('custom-lab');
  expect(rendered.yaml).toContain('ns1');

  const validation = await api.validateLab(s, lab.id);
  expect(validation.topology).toEqual([]);
  expect(validation.perServer.length).toBe(1);

  const updated = await api.updateLab(s, lab.id, { name: 'renamed-lab' });
  expect(updated.name).toBe('renamed-lab');

  const imported = await api.importLab(s, {
    name: 'imported-test',
    configurationId: 'dns-lab',
    yaml: `
name: imported-test
topology:
  nodes:
    nsA:
      kind: linux
      image: dnsnode:1.0
  links: []
`,
  });
  expect(imported.name).toBe('imported-test');
  expect(imported.topology.nodes[0].name).toBe('nsA');

  await api.deleteLab(s, lab.id);
  const afterDelete = await api.getLab(s, lab.id);
  expect(afterDelete).toBeNull();
});


