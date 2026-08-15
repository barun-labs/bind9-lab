import { renderZoneFile } from '../src/config-engine/renderZoneFile';
const zone:any = { name:'lab.test', soa:{ primaryNs:'ns1.lab.test.', adminEmail:'hostmaster.lab.test.', serial:2026081401, refresh:3600, retry:900, expire:604800, minimum:300 } };
const recs:any = [
  { name:'@', type:'NS', ttl:3600, rdata:{ target:'ns1.lab.test.' }, disabled:false },
  { name:'www', type:'A', ttl:300, rdata:{ address:'10.10.10.10' }, disabled:false },
  { name:'old', type:'A', ttl:300, rdata:{ address:'10.0.0.9' }, disabled:true },
];
test('emits headers, SOA, and non-disabled records', () => {
  const out = renderZoneFile(zone, recs);
  expect(out).toMatch(/\$ORIGIN lab\.test\./);
  expect(out).toMatch(/\$TTL 300/);
  expect(out).toMatch(/IN\s+SOA\s+ns1\.lab\.test\./);
  expect(out).toMatch(/2026081401/);            // serial
  expect(out).toContain('www');                 // A record present
  expect(out).not.toContain('old');             // disabled omitted
});
