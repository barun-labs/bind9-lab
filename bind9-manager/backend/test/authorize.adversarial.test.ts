import { describe, it, expect } from 'vitest';
import { authorize, type Actor } from '../src/server/authorize';
import { can } from '../../shared/can';
import type { User, ApiKey, Permission } from '../../shared/entities';

// Independent adversarial suite. Did NOT author the code under test.
// Only adds tests + reports. Never modifies src/server/authorize.ts or shared/can.ts.

const CONFIG = 'dns-lab';

function makeUser(
  role: 'viewer' | 'editor' | 'admin',
  canDeploy: boolean = false,
  configId: string = CONFIG,
  isActive: boolean = true
): User {
  return {
    id: `user-${role}`,
    username: `${role}-user`,
    displayName: `${role.toUpperCase()} User`,
    isActive,
    roles: [{ configurationId: configId, role, canDeploy }],
  };
}

function makeApiKey(
  scopes: ('read' | 'write' | 'deploy')[],
  readOnly: boolean = false,
  ownerUserId: string = 'owner'
): ApiKey {
  return {
    id: 'key-adv',
    name: 'adv-key',
    ownerUserId,
    scopes,
    readOnly,
    expiresAt: null,
    createdAt: '2026-08-15T00:00:00.000Z',
    lastUsedAt: null,
  };
}

const ALL_SCOPE_SETS: ('read' | 'write' | 'deploy')[][] = [
  [],
  ['read'],
  ['write'],
  ['deploy'],
  ['read', 'write'],
  ['read', 'deploy'],
  ['write', 'deploy'],
  ['read', 'write', 'deploy'],
];

describe('adversarial: api-key can never escalate to admin', () => {
  for (const role of ['viewer', 'editor', 'admin'] as const) {
    for (const scopes of ALL_SCOPE_SETS) {
      for (const readOnly of [false, true]) {
        it(`admin denied: role=${role} scopes=[${scopes.join(',')}] readOnly=${readOnly}`, () => {
          const user = makeUser(role, true);
          const key = makeApiKey(scopes, readOnly, user.id);
          const actor: Actor = { user, viaApiKey: key };
          expect(() => authorize(actor, 'admin', CONFIG)).not.toThrow();
          expect(authorize(actor, 'admin', CONFIG)).toBe(false);
        });
      }
    }
  }
});

describe('adversarial: read-only clamp', () => {
  it('readOnly key blocks edit and deploy even when owner is admin with canDeploy', () => {
    const user = makeUser('admin', true);
    const key = makeApiKey(['read', 'write', 'deploy'], true, user.id);
    const actor: Actor = { user, viaApiKey: key };

    expect(authorize(actor, 'edit', CONFIG)).toBe(false);
    expect(authorize(actor, 'deploy', CONFIG)).toBe(false);
    expect(authorize(actor, 'admin', CONFIG)).toBe(false);
  });

  it('readOnly key with read scope may still view', () => {
    const user = makeUser('admin', true);
    const key = makeApiKey(['read'], true, user.id);
    expect(authorize({ user, viaApiKey: key }, 'view', CONFIG)).toBe(true);
  });

  it('readOnly key without read scope cannot even view', () => {
    const user = makeUser('admin', true);
    const key = makeApiKey(['write', 'deploy'], true, user.id);
    expect(authorize({ user, viaApiKey: key }, 'view', CONFIG)).toBe(false);
  });
});

describe('adversarial: scope enforcement (mapped scope absent -> false, regardless of owner role)', () => {
  for (const role of ['viewer', 'editor', 'admin'] as const) {
    it(`view needs 'read': role=${role}`, () => {
      const user = makeUser(role, true);
      const key = makeApiKey(['write', 'deploy'], false, user.id);
      expect(authorize({ user, viaApiKey: key }, 'view', CONFIG)).toBe(false);
    });

    it(`edit needs 'write': role=${role}`, () => {
      const user = makeUser(role, true);
      const key = makeApiKey(['read', 'deploy'], false, user.id);
      expect(authorize({ user, viaApiKey: key }, 'edit', CONFIG)).toBe(false);
    });

    it(`deploy needs 'deploy': role=${role}`, () => {
      const user = makeUser(role, true);
      const key = makeApiKey(['read', 'write'], false, user.id);
      expect(authorize({ user, viaApiKey: key }, 'deploy', CONFIG)).toBe(false);
    });
  }
});

describe('adversarial: scope present but role absent (clamp never widens past owner rights)', () => {
  it('viewer owner with write scope cannot edit', () => {
    const user = makeUser('viewer', false);
    const key = makeApiKey(['write'], false, user.id);
    expect(authorize({ user, viaApiKey: key }, 'edit', CONFIG)).toBe(false);
  });

  it('viewer owner with deploy scope cannot edit or admin', () => {
    const user = makeUser('viewer', false);
    const key = makeApiKey(['deploy'], false, user.id);
    expect(authorize({ user, viaApiKey: key }, 'edit', CONFIG)).toBe(false);
    expect(authorize({ user, viaApiKey: key }, 'admin', CONFIG)).toBe(false);
  });
});

describe('adversarial: config scoping', () => {
  it('session actor with role on dns-lab cannot act on other-config', () => {
    const actor: Actor = { user: makeUser('admin', true, CONFIG) };
    for (const p of ['view', 'edit', 'deploy', 'admin'] as Permission[]) {
      expect(authorize(actor, p, 'other-config')).toBe(false);
    }
  });

  it('api-key actor with role on dns-lab cannot act on other-config', () => {
    const user = makeUser('admin', true, CONFIG);
    const key = makeApiKey(['read', 'write', 'deploy'], false, user.id);
    const actor: Actor = { user, viaApiKey: key };
    for (const p of ['view', 'edit', 'deploy'] as Permission[]) {
      expect(authorize(actor, p, 'other-config')).toBe(false);
    }
  });
});

describe('adversarial: degenerate inputs', () => {
  it('user with empty roles -> everything false', () => {
    const user: User = { ...makeUser('admin', true), roles: [] };
    const actor: Actor = { user };
    for (const p of ['view', 'edit', 'deploy', 'admin'] as Permission[]) {
      expect(authorize(actor, p, CONFIG)).toBe(false);
    }
  });

  it('user with undefined roles -> everything false (no throw)', () => {
    const user: User = { ...makeUser('admin', true), roles: undefined as unknown as User['roles'] };
    const actor: Actor = { user };
    for (const p of ['view', 'edit', 'deploy', 'admin'] as Permission[]) {
      expect(() => authorize(actor, p, CONFIG)).not.toThrow();
      expect(authorize(actor, p, CONFIG)).toBe(false);
    }
  });

  it('inactive user -> everything false', () => {
    const actor: Actor = { user: makeUser('admin', true, CONFIG, false) };
    for (const p of ['view', 'edit', 'deploy', 'admin'] as Permission[]) {
      expect(authorize(actor, p, CONFIG)).toBe(false);
    }
  });

  it('unknown permission string (cast) -> false, not throw', () => {
    const actor: Actor = { user: makeUser('admin', true) };
    const unknown = 'superadmin' as Permission;
    expect(() => authorize(actor, unknown, CONFIG)).not.toThrow();
    expect(authorize(actor, unknown, CONFIG)).toBe(false);
  });

  it('api-key with empty scopes -> view false, edit false, deploy false', () => {
    const user = makeUser('admin', true);
    const key = makeApiKey([], false, user.id);
    const actor: Actor = { user, viaApiKey: key };
    expect(authorize(actor, 'view', CONFIG)).toBe(false);
    expect(authorize(actor, 'edit', CONFIG)).toBe(false);
    expect(authorize(actor, 'deploy', CONFIG)).toBe(false);
    expect(authorize(actor, 'admin', CONFIG)).toBe(false);
  });

  it('api-key with undefined scopes -> view false, not throw', () => {
    const user = makeUser('admin', true);
    const key = makeApiKey(['read'], false, user.id);
    key.scopes = undefined as unknown as ApiKey['scopes'];
    expect(() => authorize({ user, viaApiKey: key }, 'view', CONFIG)).not.toThrow();
    expect(authorize({ user, viaApiKey: key }, 'view', CONFIG)).toBe(false);
  });

  it('null/undefined actor and missing user -> false, not throw', () => {
    expect(() => authorize(null as unknown as Actor, 'view', CONFIG)).not.toThrow();
    expect(authorize(null as unknown as Actor, 'view', CONFIG)).toBe(false);
    expect(authorize(undefined as unknown as Actor, 'view', CONFIG)).toBe(false);
    expect(authorize({} as Actor, 'view', CONFIG)).toBe(false);
    expect(authorize({ user: null as unknown as User } as Actor, 'view', CONFIG)).toBe(false);
  });
});

describe('adversarial: session actor (no viaApiKey) is NOT clamped', () => {
  it('admin session -> admin/edit/deploy/view all true on own config', () => {
    const actor: Actor = { user: makeUser('admin', true) };
    expect(authorize(actor, 'view', CONFIG)).toBe(true);
    expect(authorize(actor, 'edit', CONFIG)).toBe(true);
    expect(authorize(actor, 'deploy', CONFIG)).toBe(true);
    expect(authorize(actor, 'admin', CONFIG)).toBe(true);
  });

  it('admin session without canDeploy -> deploy false, admin/edit/view true', () => {
    const actor: Actor = { user: makeUser('admin', false) };
    expect(authorize(actor, 'view', CONFIG)).toBe(true);
    expect(authorize(actor, 'edit', CONFIG)).toBe(true);
    expect(authorize(actor, 'deploy', CONFIG)).toBe(false);
    expect(authorize(actor, 'admin', CONFIG)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DEFECTS — failing on purpose. These prove a privilege-escalation path.
// Do NOT fix the source; the report explains each repro.
// ---------------------------------------------------------------------------
describe('DEFECTS: escalation paths (failing tests — expected to fail)', () => {
  it('DEFECT-1: viewer with canDeploy=true can deploy (role must gate deploy)', () => {
    // can() 'deploy' branch returns Boolean(assignment.canDeploy) with NO role check.
    // A demoted editor->viewer keeps canDeploy=true (see app Users.tsx handleRoleChange),
    // so a read-only "viewer" gains a production deploy right.
    const user = makeUser('viewer', true);
    expect(can(user, 'deploy', CONFIG)).toBe(false); // actual: true
  });

  it('DEFECT-2: viewer session with canDeploy=true passes authorize deploy', () => {
    const actor: Actor = { user: makeUser('viewer', true) };
    expect(authorize(actor, 'deploy', CONFIG)).toBe(false); // actual: true
  });

  it('DEFECT-3: viewer api-key with deploy scope can deploy', () => {
    const user = makeUser('viewer', true);
    const key = makeApiKey(['deploy'], false, user.id);
    expect(authorize({ user, viaApiKey: key }, 'deploy', CONFIG)).toBe(false); // actual: true
  });
});
