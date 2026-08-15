import type { User } from '../types/entities';

export const seedUsers: User[] = [
  {
    id: 'usr-admin',
    username: 'admin',
    displayName: 'Admin User',
    isActive: true,
    roles: [
      {
        configurationId: 'dns-lab',
        role: 'admin',
        canDeploy: true,
      },
    ],
  },
  {
    id: 'usr-editor',
    username: 'editor',
    displayName: 'Editor User',
    isActive: true,
    roles: [
      {
        configurationId: 'dns-lab',
        role: 'editor',
        canDeploy: true,
      },
    ],
  },
  {
    id: 'usr-viewer',
    username: 'viewer',
    displayName: 'Viewer User',
    isActive: true,
    roles: [
      {
        configurationId: 'dns-lab',
        role: 'viewer',
        canDeploy: false,
      },
    ],
  },
];
