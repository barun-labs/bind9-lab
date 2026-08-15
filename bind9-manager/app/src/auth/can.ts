import type { User, Permission } from '../types/entities';

export function can(
  user: User | null | undefined,
  permission: Permission,
  configId: string
): boolean {
  if (!user || !user.isActive) {
    return false;
  }

  const assignment = user.roles?.find((r) => r.configurationId === configId);
  if (!assignment) {
    return false;
  }

  switch (permission) {
    case 'view':
      return (
        assignment.role === 'viewer' ||
        assignment.role === 'editor' ||
        assignment.role === 'admin'
      );
    case 'edit':
      return assignment.role === 'editor' || assignment.role === 'admin';
    case 'admin':
      return assignment.role === 'admin';
    case 'deploy':
      return Boolean(assignment.canDeploy);
    default:
      return false;
  }
}
