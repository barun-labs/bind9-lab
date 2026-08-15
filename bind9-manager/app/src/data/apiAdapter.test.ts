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

