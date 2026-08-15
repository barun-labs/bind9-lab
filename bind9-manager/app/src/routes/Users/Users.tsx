import { useState, useEffect, useCallback } from 'react';
import { useApi } from '../../data/store';
import { useAuth } from '../../auth/AuthProvider';
import type { User } from '../../types/entities';
import { Select } from '../../components/Select/Select';
import { Checkbox } from '../../components/Checkbox/Checkbox';

export function Users() {
  const { listUsers, setUserRole, setUserActive } = useApi();
  const { can } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchUsers = useCallback(async () => {
    try {
      const response = await listUsers();
      setUsers(response.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [listUsers]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleRoleChange = async (
    userId: string,
    configurationId: string,
    newRole: 'viewer' | 'editor' | 'admin',
    canDeploy: boolean
  ) => {
    // mock: real enforcement is the backend's job
    try {
      await setUserRole(userId, {
        configurationId,
        role: newRole,
        canDeploy: newRole === 'admin' ? true : canDeploy,
      });
      await fetchUsers();
    } catch {
      // ignore
    }
  };

  const handleToggleActive = async (userId: string, isActive: boolean) => {
    // mock: real enforcement is the backend's job
    try {
      await setUserActive(userId, isActive);
      await fetchUsers();
    } catch {
      // ignore
    }
  };

  return (
    <div
      style={{
        padding: '24px 32px',
        maxWidth: 'var(--chrome-max-content-w, 1040px)',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: '24px',
          gap: '16px',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: '24px',
              fontWeight: 600,
              margin: '0 0 6px 0',
              fontFamily: 'var(--font-heading)',
            }}
          >
            Users
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: '13px',
              color: 'var(--color-text-secondary)',
            }}
          >
            Manage user accounts, roles, and configuration access.
          </p>
        </div>
      </div>

      <div
        style={{
          border: '1px solid var(--color-divider)',
          background: 'var(--color-surface)',
        }}
      >
        <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th scope="col" style={{ padding: '10px 16px' }}>
                Display Name
              </th>
              <th scope="col" style={{ padding: '10px 16px' }}>
                Username
              </th>
              <th scope="col" style={{ padding: '10px 16px' }}>
                Roles
              </th>
              <th scope="col" style={{ padding: '10px 16px' }}>
                Active
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={4}
                  style={{
                    textAlign: 'center',
                    padding: '32px 16px',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  Loading users…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  style={{
                    textAlign: 'center',
                    padding: '32px 16px',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  No users found.
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const canAdminAny =
                  user.roles.some((r) => can('admin', r.configurationId)) || can('admin', 'dns-lab');

                return (
                  <tr key={user.id}>
                    <td style={{ padding: '12px 16px', fontWeight: 600 }}>{user.displayName}</td>
                    <td
                      style={{
                        padding: '12px 16px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '13px',
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      {user.username}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {user.roles.length === 0 ? (
                          <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                            None
                          </span>
                        ) : (
                          user.roles.map((assignment) => {
                            const canAdminConfig = can('admin', assignment.configurationId);
                            return (
                              <div
                                key={assignment.configurationId}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: '12px',
                                    fontFamily: 'var(--font-mono)',
                                    color: 'var(--color-text-secondary)',
                                    minWidth: '70px',
                                  }}
                                >
                                  {assignment.configurationId}:
                                </span>
                                <Select
                                  aria-label={`Role for ${user.displayName} on ${assignment.configurationId}`}
                                  value={assignment.role}
                                  disabled={!canAdminConfig}
                                  options={[
                                    { label: 'Viewer', value: 'viewer' },
                                    { label: 'Editor', value: 'editor' },
                                    { label: 'Admin', value: 'admin' },
                                  ]}
                                  onChange={(e) =>
                                    handleRoleChange(
                                      user.id,
                                      assignment.configurationId,
                                      e.target.value as 'viewer' | 'editor' | 'admin',
                                      assignment.canDeploy
                                    )
                                  }
                                  style={{
                                    fontSize: '13px',
                                    padding: '4px 8px',
                                    minHeight: '28px',
                                    minWidth: '100px',
                                  }}
                                />
                              </div>
                            );
                          })
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <Checkbox
                        id={`user-active-${user.id}`}
                        checked={user.isActive}
                        disabled={!canAdminAny}
                        onChange={(e) => handleToggleActive(user.id, e.target.checked)}
                        label={user.isActive ? 'Active' : 'Inactive'}
                        aria-label={`Active status for ${user.displayName}`}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Users;
