import { test, expect } from 'vitest';
import { can } from './can';
const u = (role: any, canDeploy: any) => ({ id:'u1', username:'a', displayName:'A', isActive:true,
  roles:[{ configurationId:'dns-lab', role, canDeploy }] }) as any;
test('viewer can view not edit', () => { const v=u('viewer',false);
  expect(can(v,'view','dns-lab')).toBe(true); expect(can(v,'edit','dns-lab')).toBe(false); });
test('editor can edit not deploy without flag', () => { const e=u('editor',false);
  expect(can(e,'edit','dns-lab')).toBe(true); expect(can(e,'deploy','dns-lab')).toBe(false); });
test('editor with canDeploy can deploy', () => { expect(can(u('editor',true),'deploy','dns-lab')).toBe(true); });
test('admin can admin + edit', () => { const a=u('admin',false);
  expect(can(a,'admin','dns-lab')).toBe(true); expect(can(a,'edit','dns-lab')).toBe(true); });
test('no assignment on other config = no access', () => { expect(can(u('admin',true),'view','other')).toBe(false); });
