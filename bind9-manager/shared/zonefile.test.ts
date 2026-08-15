import { zoneFileLine, rdataDisplay } from './zonefile';

test('A', () => { expect(zoneFileLine('ns1',3600,'A',{address:'10.20.30.10'})).toBe('ns1\t3600\tIN\tA\t10.20.30.10'); });
test('AAAA', () => { expect(rdataDisplay('AAAA',{address:'2001:db8::1'})).toBe('2001:db8::1'); });
test('CNAME', () => { expect(rdataDisplay('CNAME',{target:'edge.lab.lun.net.'})).toBe('edge.lab.lun.net.'); });
test('MX priority+target', () => { expect(rdataDisplay('MX',{priority:10,target:'mx1.lab.lun.net.'})).toBe('10 mx1.lab.lun.net.'); });
test('SRV four fields', () => { expect(rdataDisplay('SRV',{priority:10,weight:20,port:5060,target:'sip1.lab.lun.net.'})).toBe('10 20 5060 sip1.lab.lun.net.'); });
test('TXT quoted', () => { expect(rdataDisplay('TXT',{text:'v=spf1 ~all'})).toBe('"v=spf1 ~all"'); });
test('CAA', () => { expect(rdataDisplay('CAA',{flags:0,tag:'issue',value:'letsencrypt.org'})).toBe('0 issue "letsencrypt.org"'); });
test('apex name renders @', () => { expect(zoneFileLine('@',3600,'MX',{priority:10,target:'mx1.'})).toBe('@\t3600\tIN\tMX\t10 mx1.'); });
