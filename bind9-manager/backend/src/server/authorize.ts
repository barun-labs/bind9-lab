import { can } from '../../../shared/can';
import type { User, ApiKey, Permission } from '../../../shared/entities';

export type Actor = {
  user: User;
  viaApiKey?: ApiKey;
};

const PERMISSION_TO_SCOPE: Record<Exclude<Permission, 'admin'>, 'read' | 'write' | 'deploy'> = {
  view: 'read',
  edit: 'write',
  deploy: 'deploy',
};

export function authorize(actor: Actor, permission: Permission, configId: string): boolean {
  if (!actor || !actor.user || !can(actor.user, permission, configId)) {
    return false;
  }

  if (!actor.viaApiKey) {
    return true;
  }

  // An API key can NEVER grant admin permission
  if (permission === 'admin') {
    return false;
  }

  // A readOnly key fails any permission in {'edit', 'deploy'} (only 'view' may pass)
  if (actor.viaApiKey.readOnly && (permission === 'edit' || permission === 'deploy')) {
    return false;
  }

  const requiredScope = PERMISSION_TO_SCOPE[permission];
  if (!requiredScope || !actor.viaApiKey.scopes || !actor.viaApiKey.scopes.includes(requiredScope)) {
    return false;
  }

  return true;
}
