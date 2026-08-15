import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { StoreProvider, makeStore, type StoreData } from '../../data/store';
import { AuthProvider } from '../../auth/AuthProvider';
import { seedUsers } from '../../data/users.seed';
import type { User, Lab } from '../../types/entities';
import { LabEditor } from './LabEditor';

const testLab: Lab = {
  id: 'lab-edit-1',
  name: 'editor-test-lab',
  configurationId: 'dns-lab',
  topology: {
    name: 'editor-test-lab',
    mgmtNetwork: 'clab-mgmt',
    mgmtSubnet: '10.70.0.0/24',
    nodes: [
      {
        name: 'ns1',
        kind: 'linux',
        intent: 'bind',
        image: 'dnsnode:1.0',
        mgmtIpv4: '10.70.0.11',
        interfaces: [{ name: 'eth1', address: '10.70.0.11/24' }],
      },
      {
        name: 'r1',
        kind: 'linux',
        intent: 'router',
        image: 'dnsnode:1.0',
        mgmtIpv4: '10.70.0.1',
      },
    ],
    links: [
      { endpoints: ['ns1:eth1', 'r1:eth1'] },
    ],
  },
  createdAt: '2026-08-15T10:00:00Z',
  updatedAt: '2026-08-15T10:00:00Z',
};

function renderLabEditor(
  initialStore?: Partial<StoreData>,
  userToLogin?: User,
  configId = 'dns-lab',
  labId = 'lab-edit-1'
) {
  const defaultUser = seedUsers.find((u) => u.username === 'admin')!;
  const user = userToLogin !== undefined ? userToLogin : defaultUser;
  if (user) {
    localStorage.setItem('bnd_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('bnd_user');
  }

  const router = createMemoryRouter(
    [
      {
        path: '/config/:configId/labs/:labId',
        element: <LabEditor />,
      },
    ],
    {
      initialEntries: [`/config/${configId}/labs/${labId}`],
    }
  );

  return render(
    <StoreProvider initialStore={makeStore({ labs: [testLab], ...initialStore })}>
      <AuthProvider initialUser={user}>
        <RouterProvider router={router} />
      </AuthProvider>
    </StoreProvider>
  );
}

describe('LabEditor', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('adding a node then viewing the YAML tab shows that node name in the generated YAML', async () => {
    const user = userEvent.setup();
    renderLabEditor();

    // Verify initial lab loaded
    expect(await screen.findByText('editor-test-lab')).toBeInTheDocument();
    expect(screen.getByText('ns1')).toBeInTheDocument();

    // Click "Add Node"
    const addNodeBtn = screen.getByRole('button', { name: /^add node$/i });
    await user.click(addNodeBtn);

    // Node SidePanel is open
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    // Type new node name
    const nameInput = within(dialog).getByLabelText(/node name/i);
    fireEvent.change(nameInput, { target: { value: 'ns-extra' } });

    // Click Save Changes / Add Node in dialog
    const saveNodeBtn = within(dialog).getByRole('button', { name: /^add node$/i });
    fireEvent.click(saveNodeBtn);

    // Node list now has ns-extra
    expect(await screen.findByText('ns-extra')).toBeInTheDocument();



    // Switch to YAML tab
    const yamlTabBtn = screen.getByRole('button', { name: /^yaml$/i });
    await user.click(yamlTabBtn);

    // The generated YAML textarea should include ns-extra
    const yamlEditor = screen.getByLabelText(/yaml editor/i) as HTMLTextAreaElement;
    expect(yamlEditor.value).toContain('ns-extra');
  });

  test('pasting a small clab.yml and clicking "Parse YAML to form" populates the node list', async () => {
    const user = userEvent.setup();
    renderLabEditor();

    expect(await screen.findByText('editor-test-lab')).toBeInTheDocument();

    // Switch to YAML tab
    const yamlTabBtn = screen.getByRole('button', { name: /^yaml$/i });
    await user.click(yamlTabBtn);

    // Paste custom YAML
    const yamlEditor = screen.getByLabelText(/yaml editor/i);
    await user.clear(yamlEditor);
    await user.paste(
      `
name: pasted-lab
topology:
  nodes:
    custom-dns-1:
      kind: linux
      image: dnsnode:1.0
      mgmt-ipv4: 10.70.0.50
    custom-router:
      kind: linux
      image: dnsnode:1.0
      mgmt-ipv4: 10.70.0.1
    bridge0:
      kind: bridge
  links:
    - endpoints: ["custom-dns-1:eth1", "custom-router:eth1"]
`
    );

    // Click "Parse YAML to form"
    const parseBtn = screen.getByRole('button', { name: /parse yaml to form/i });
    await user.click(parseBtn);


    // Switch to Form tab
    const formTabBtn = screen.getByRole('button', { name: /form editor/i });
    await user.click(formTabBtn);

    // Node list should now show custom-dns-1, custom-router, and bridge0
    expect(screen.getByText('custom-dns-1')).toBeInTheDocument();
    expect(screen.getByText('custom-router')).toBeInTheDocument();
    expect(screen.getByText('bridge0')).toBeInTheDocument();

    // Links table should show the link
    expect(screen.getByText('custom-dns-1:eth1')).toBeInTheDocument();
    expect(screen.getByText('custom-router:eth1')).toBeInTheDocument();
  });

  test('Preview & Validate tab runs validateLab and shows feedback', async () => {
    const user = userEvent.setup();
    renderLabEditor();

    expect(await screen.findByText('editor-test-lab')).toBeInTheDocument();

    // Switch to Preview & Validate tab
    const previewTabBtn = screen.getByRole('button', { name: /preview & validate/i });
    await user.click(previewTabBtn);

    // Shows rendered YAML and validation results
    expect(screen.getByText(/rendered clab\.yml/i)).toBeInTheDocument();
    expect(await screen.findByText(/all valid/i)).toBeInTheDocument();
    expect(screen.getByText(/srv-lab-edit-1-ns1/i)).toBeInTheDocument();
  });

  test('Save Lab button saves the modified topology', async () => {
    const user = userEvent.setup();
    renderLabEditor();

    expect(await screen.findByText('editor-test-lab')).toBeInTheDocument();

    // Rename lab
    const nameInput = screen.getByLabelText(/^lab name$/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'updated-lab-name');

    // Click Save Lab
    const saveBtn = screen.getByRole('button', { name: /save lab/i });
    await user.click(saveBtn);

    // Shows Saved status pill
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });
});
