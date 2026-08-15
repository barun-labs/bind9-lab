import { describe, it, expect } from 'vitest';
import { authorize, type Actor } from '../src/server/authorize';
import type { User, ApiKey, Permission } from '../../shared/entities';

function makeUser(
  role: 'viewer' | 'editor' | 'admin',
  canDeploy: boolean = false,
  configId: string = 'dns-lab',
  isActive: boolean = true
): User {
  return {
    id: `user-${role}`,
    username: `${role}-user`,
    displayName: `${role.toUpperCase()} User`,
    isActive,
    roles: [
      {
        configurationId: configId,
        role,
        canDeploy,
      },
    ],
  };
}

function makeApiKey(
  ownerUserId: string,
  scopes: ('read' | 'write' | 'deploy')[],
  readOnly: boolean = false
): ApiKey {
  return {
    id: 'key-123',
    name: 'test-key',
    ownerUserId,
    scopes,
    readOnly,
    expiresAt: null,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };
}

describe('authorize', () => {
  describe('session actor (no viaApiKey)', () => {
    it('viewer can view, but cannot edit or deploy or admin', () => {
      const actor: Actor = { user: makeUser('viewer') };
      expect(authorize(actor, 'view', 'dns-lab')).toBe(true);
      expect(authorize(actor, 'edit', 'dns-lab')).toBe(false);
      expect(authorize(actor, 'deploy', 'dns-lab')).toBe(false);
      expect(authorize(actor, 'admin', 'dns-lab')).toBe(false);
    });

    it('editor without canDeploy can view and edit, but cannot deploy or admin', () => {
      const actor: Actor = { user: makeUser('editor', false) };
      expect(authorize(actor, 'view', 'dns-lab')).toBe(true);
      expect(authorize(actor, 'edit', 'dns-lab')).toBe(true);
      expect(authorize(actor, 'deploy', 'dns-lab')).toBe(false);
      expect(authorize(actor, 'admin', 'dns-lab')).toBe(false);
    });

    it('editor with canDeploy can deploy as well as edit and view', () => {
      const actor: Actor = { user: makeUser('editor', true) };
      expect(authorize(actor, 'view', 'dns-lab')).toBe(true);
      expect(authorize(actor, 'edit', 'dns-lab')).toBe(true);
      expect(authorize(actor, 'deploy', 'dns-lab')).toBe(true);
      expect(authorize(actor, 'admin', 'dns-lab')).toBe(false);
    });

    it('admin can view, edit, and admin', () => {
      const actor: Actor = { user: makeUser('admin', false) };
      expect(authorize(actor, 'view', 'dns-lab')).toBe(true);
      expect(authorize(actor, 'edit', 'dns-lab')).toBe(true);
      expect(authorize(actor, 'admin', 'dns-lab')).toBe(true);
    });

    it('admin with canDeploy can also deploy', () => {
      const actor: Actor = { user: makeUser('admin', true) };
      expect(authorize(actor, 'deploy', 'dns-lab')).toBe(true);
    });

    it('rejects access on wrong configId', () => {
      const actor: Actor = { user: makeUser('admin', true, 'dns-lab') };
      expect(authorize(actor, 'view', 'other-config')).toBe(false);
      expect(authorize(actor, 'edit', 'other-config')).toBe(false);
      expect(authorize(actor, 'deploy', 'other-config')).toBe(false);
      expect(authorize(actor, 'admin', 'other-config')).toBe(false);
    });

    it('rejects access if user is inactive', () => {
      const actor: Actor = { user: makeUser('admin', true, 'dns-lab', false) };
      expect(authorize(actor, 'view', 'dns-lab')).toBe(false);
      expect(authorize(actor, 'edit', 'dns-lab')).toBe(false);
      expect(authorize(actor, 'admin', 'dns-lab')).toBe(false);
    });
  });

  describe('api-key actor (viaApiKey set)', () => {
    it('read-only key blocks edit and deploy even when owner is admin with canDeploy', () => {
      const user = makeUser('admin', true);
      const key = makeApiKey(user.id, ['read', 'write', 'deploy'], true);
      const actor: Actor = { user, viaApiKey: key };

      expect(authorize(actor, 'view', 'dns-lab')).toBe(true);
      expect(authorize(actor, 'edit', 'dns-lab')).toBe(false);
      expect(authorize(actor, 'deploy', 'dns-lab')).toBe(false);
      expect(authorize(actor, 'admin', 'dns-lab')).toBe(false);
    });

    it('blocks action when key is missing the mapped scope', () => {
      const user = makeUser('editor', true);

      // Key has only 'read' scope -> edit and deploy fail
      const readOnlyScopeKey = makeApiKey(user.id, ['read'], false);
      expect(authorize({ user, viaApiKey: readOnlyScopeKey }, 'view', 'dns-lab')).toBe(true);
      expect(authorize({ user, viaApiKey: readOnlyScopeKey }, 'edit', 'dns-lab')).toBe(false);
      expect(authorize({ user, viaApiKey: readOnlyScopeKey }, 'deploy', 'dns-lab')).toBe(false);

      // Key has only 'write' scope -> view and deploy fail
      const writeOnlyScopeKey = makeApiKey(user.id, ['write'], false);
      expect(authorize({ user, viaApiKey: writeOnlyScopeKey }, 'view', 'dns-lab')).toBe(false);
      expect(authorize({ user, viaApiKey: writeOnlyScopeKey }, 'edit', 'dns-lab')).toBe(true);
      expect(authorize({ user, viaApiKey: writeOnlyScopeKey }, 'deploy', 'dns-lab')).toBe(false);

      // Key has only 'deploy' scope -> view and edit fail
      const deployOnlyScopeKey = makeApiKey(user.id, ['deploy'], false);
      expect(authorize({ user, viaApiKey: deployOnlyScopeKey }, 'view', 'dns-lab')).toBe(false);
      expect(authorize({ user, viaApiKey: deployOnlyScopeKey }, 'edit', 'dns-lab')).toBe(false);
      expect(authorize({ user, viaApiKey: deployOnlyScopeKey }, 'deploy', 'dns-lab')).toBe(true);
    });

    it('admin permission is NEVER granted via ANY api-key', () => {
      const user = makeUser('admin', true);
      const fullKey = makeApiKey(user.id, ['read', 'write', 'deploy'], false);
      const actor: Actor = { user, viaApiKey: fullKey };

      expect(authorize(actor, 'admin', 'dns-lab')).toBe(false);
    });

    it('full-scope non-readonly key allows edit if owner can edit', () => {
      const user = makeUser('editor', false);
      const fullKey = makeApiKey(user.id, ['read', 'write', 'deploy'], false);
      const actor: Actor = { user, viaApiKey: fullKey };

      expect(authorize(actor, 'view', 'dns-lab')).toBe(true);
      expect(authorize(actor, 'edit', 'dns-lab')).toBe(true);
      expect(authorize(actor, 'deploy', 'dns-lab')).toBe(false); // owner has canDeploy=false
      expect(authorize(actor, 'admin', 'dns-lab')).toBe(false);
    });

    it('full-scope non-readonly key allows deploy if owner can deploy', () => {
      const user = makeUser('editor', true);
      const fullKey = makeApiKey(user.id, ['read', 'write', 'deploy'], false);
      const actor: Actor = { user, viaApiKey: fullKey };

      expect(authorize(actor, 'view', 'dns-lab')).toBe(true);
      expect(authorize(actor, 'edit', 'dns-lab')).toBe(true);
      expect(authorize(actor, 'deploy', 'dns-lab')).toBe(true);
    });

    it('blocks access if owner has no permission on target configId', () => {
      const user = makeUser('admin', true, 'dns-lab');
      const fullKey = makeApiKey(user.id, ['read', 'write', 'deploy'], false);
      const actor: Actor = { user, viaApiKey: fullKey };

      expect(authorize(actor, 'view', 'wrong-config')).toBe(false);
      expect(authorize(actor, 'edit', 'wrong-config')).toBe(false);
      expect(authorize(actor, 'deploy', 'wrong-config')).toBe(false);
    });
  });
});
