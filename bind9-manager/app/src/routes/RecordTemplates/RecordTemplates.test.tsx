import { render, screen, fireEvent } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../data/store';
import { AuthProvider } from '../../auth/AuthProvider';
import { seedUsers } from '../../data/users.seed';
import type { User } from '../../types/entities';
import * as apiAdapter from '../../data/apiAdapter';
import { RecordTemplates } from './RecordTemplates';

vi.mock('../../data/apiAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/apiAdapter')>();
  return {
    ...actual,
    listRecordTemplates: vi.fn(async () => [
      {
        id: 'tpl-1',
        configurationId: 'dns-lab',
        name: 'standard-web-stack',
        description: 'www CNAME + MX for new customer zones',
        entries: [
          { name: 'www', type: 'CNAME', rdata: { target: '@' } },
          { name: '@', type: 'MX', rdata: { priority: 10, target: 'mail.example.com' } },
        ],
      },
      {
        id: 'tpl-2',
        configurationId: 'dns-lab',
        name: 'empty-template',
        entries: [],
      },
    ]),
    createRecordTemplate: vi.fn(async () => ({
      id: 'tpl-3',
      configurationId: 'dns-lab',
      name: 'newtemplate',
      entries: [],
    })),
    deleteRecordTemplate: vi.fn(async () => ({ deleted: true })),
  };
});

const createRecordTemplateMock = vi.mocked(apiAdapter.createRecordTemplate);
const deleteRecordTemplateMock = vi.mocked(apiAdapter.deleteRecordTemplate);

function renderRecordTemplates(userToLogin?: User) {
  const defaultUser = seedUsers.find((u) => u.username === 'admin')!;
  const user = userToLogin !== undefined ? userToLogin : defaultUser;
  if (user) {
    localStorage.setItem('bnd_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('bnd_user');
  }

  const router = createMemoryRouter(
    [{ path: '/config/:configId/templates', element: <RecordTemplates /> }],
    { initialEntries: ['/config/dns-lab/templates'] }
  );

  return render(
    <StoreProvider>
      <AuthProvider initialUser={user}>
        <RouterProvider router={router} />
      </AuthProvider>
    </StoreProvider>
  );
}

describe('RecordTemplates', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  test('renders one row per record template with name, description and entry count', async () => {
    renderRecordTemplates();

    expect(await screen.findByText('standard-web-stack')).toBeInTheDocument();
    expect(screen.getByText('empty-template')).toBeInTheDocument();
    expect(screen.getByText('www CNAME + MX for new customer zones')).toBeInTheDocument();
  });

  test('opens Add record template modal and submits createRecordTemplate with the name', async () => {
    renderRecordTemplates();

    fireEvent.click(await screen.findByRole('button', { name: 'Add record template' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'newtemplate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create record template' }));

    expect(createRecordTemplateMock).toHaveBeenCalledWith(
      expect.any(Object),
      'dns-lab',
      expect.objectContaining({ name: 'newtemplate' })
    );
  });

  test('deleting a row confirms and calls deleteRecordTemplate with the template id', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderRecordTemplates();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete record template standard-web-stack' }));

    expect(deleteRecordTemplateMock).toHaveBeenCalledWith(expect.any(Object), 'dns-lab', 'tpl-1');
    confirmSpy.mockRestore();
  });

  test('a non-edit user sees no Add or Delete controls', async () => {
    const viewer = seedUsers.find((u) => u.username === 'viewer')!;
    renderRecordTemplates(viewer);

    await screen.findByText('standard-web-stack');

    expect(screen.queryByRole('button', { name: 'Add record template' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete record template standard-web-stack' })).toBeNull();
  });
});
