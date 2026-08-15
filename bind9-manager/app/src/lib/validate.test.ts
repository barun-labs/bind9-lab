import { validateRecord } from './validate';
const ctx = { zoneName:'lab.lun.net', existing:[], externalHostFqdns:['edge.lab.lun.net'] };
test('bad label errors', () => { expect(validateRecord({name:'-bad',type:'A',ttl:60}, ctx).errors.name).toMatch(/valid DNS label/); });
test('good label passes', () => { expect(validateRecord({name:'ok1',type:'A',ttl:60}, ctx).errors.name).toBeUndefined(); });
test('CNAME at apex errors', () => { expect(validateRecord({name:'@',type:'CNAME',ttl:60}, ctx).errors.type).toMatch(/apex/); });
test('CNAME not at apex passes', () => { expect(validateRecord({name:'www',type:'CNAME',ttl:60,...{}}, {...ctx,target:'edge.lab.lun.net'}).errors.type).toBeUndefined(); });
test('duplicate errors', () => {
  const existing=[{id:'r1',zoneId:'z',name:'ns1',type:'A',ttl:60,rdata:{address:'1.1.1.1'},disabled:false,syncState:'SYNCED',issue:null}] as any;
  expect(validateRecord({name:'ns1',type:'A',ttl:60}, {...ctx,existing}).errors.name).toMatch(/already exists/);
});
test('editing same record is not a duplicate', () => {
  const existing=[{id:'r1',zoneId:'z',name:'ns1',type:'A',ttl:60,rdata:{address:'1.1.1.1'},disabled:false,syncState:'SYNCED',issue:null}] as any;
  expect(validateRecord({name:'ns1',type:'A',ttl:60}, {...ctx,existing,editingId:'r1'}).errors.name).toBeUndefined();
});
test('TTL out of range errors', () => { expect(validateRecord({name:'a',type:'A',ttl:-1}, ctx).errors.ttl).toBeTruthy(); });
test('TTL under 60 warns not errors', () => { const r=validateRecord({name:'a',type:'A',ttl:30}, ctx); expect(r.errors.ttl).toBeUndefined(); expect(r.warnings.ttl).toMatch(/under 60/); });
test('dangling target warns', () => { expect(validateRecord({name:'w',type:'CNAME',ttl:60}, {...ctx,target:'nope.example.'}).warnings.target).toMatch(/dangling/i); });
test('known target does not warn', () => { expect(validateRecord({name:'w',type:'CNAME',ttl:60}, {...ctx,target:'edge.lab.lun.net'}).warnings.target).toBeUndefined(); });
