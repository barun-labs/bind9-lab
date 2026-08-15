import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { Lab, NodeSpec, LinkSpec, NodeInterface, ValidateLabResult } from '../../types/entities';
import { useApi } from '../../data/store';
import { useAuth } from '../../auth/AuthProvider';
import { generateClabYaml, parseClabYaml } from '../../lib/clabYaml';
import { Button } from '../../components/Button/Button';
import { Input } from '../../components/Input/Input';
import { Select } from '../../components/Select/Select';
import { Textarea } from '../../components/Textarea/Textarea';
import { CodeBlock } from '../../components/CodeBlock/CodeBlock';
import { SidePanel } from '../../components/SidePanel/SidePanel';
import { StatusPill } from '../../components/StatusPill/StatusPill';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';

type TabType = 'form' | 'yaml' | 'preview';

interface NodeFormState {
  name: string;
  intent: 'bind' | 'router' | 'bridge';
  image: string;
  mgmtIpv4: string;
  interfaces: NodeInterface[];
}

const DEFAULT_NODE_FORM: NodeFormState = {
  name: '',
  intent: 'bind',
  image: 'dnsnode:1.0',
  mgmtIpv4: '',
  interfaces: [],
};

export function LabEditor() {
  const { configId = 'dns-lab', labId } = useParams();
  const api = useApi();
  const { can } = useAuth();
  const canEdit = can('edit', configId);

  const [lab, setLab] = useState<Lab | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Tab State
  const [activeTab, setActiveTab] = useState<TabType>('form');

  // Topology Form State
  const [labName, setLabName] = useState<string>('');
  const [nodes, setNodes] = useState<NodeSpec[]>([]);
  const [links, setLinks] = useState<LinkSpec[]>([]);
  const [mgmtNetwork, setMgmtNetwork] = useState<string>('clab-mgmt');
  const [mgmtSubnet, setMgmtSubnet] = useState<string>('10.70.0.0/24');

  // YAML Tab State
  const [yamlText, setYamlText] = useState<string>('');
  const [yamlError, setYamlError] = useState<string | null>(null);

  // Node SidePanel State
  const [isNodePanelOpen, setIsNodePanelOpen] = useState<boolean>(false);
  const [editingNodeIndex, setEditingNodeIndex] = useState<number | null>(null);
  const [nodeForm, setNodeForm] = useState<NodeFormState>(DEFAULT_NODE_FORM);
  const [newIfaceName, setNewIfaceName] = useState<string>('');
  const [newIfaceAddress, setNewIfaceAddress] = useState<string>('');

  // Link Add Form State
  const [newEndpointA, setNewEndpointA] = useState<string>('');
  const [newEndpointB, setNewEndpointB] = useState<string>('');

  // Validation State
  const [validationResult, setValidationResult] = useState<ValidateLabResult | null>(null);
  const [validating, setValidating] = useState<boolean>(false);

  // Load Lab
  const loadLab = useCallback(async () => {
    if (!labId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getLab(labId);
      if (!data) {
        setError(`Lab ${labId} not found`);
        return;
      }
      setLab(data);
      setLabName(data.name);
      const topo = data.topology || { name: data.name, nodes: [], links: [] };
      setNodes(topo.nodes || []);
      setLinks(topo.links || []);
      setMgmtNetwork(topo.mgmtNetwork || 'clab-mgmt');
      setMgmtSubnet(topo.mgmtSubnet || '10.70.0.0/24');
      const initialYaml = generateClabYaml(topo);
      setYamlText(initialYaml);
    } catch (err: any) {
      setError(err?.message || 'Failed to load lab');
    } finally {
      setLoading(false);
    }
  }, [api, labId]);

  useEffect(() => {
    loadLab();
  }, [loadLab]);

  // Current current TopologyModel
  const currentTopology = useMemo<Lab['topology']>(() => {
    return {
      name: labName || lab?.name || 'lab',
      mgmtNetwork,
      mgmtSubnet,
      nodes,
      links,
    };
  }, [labName, lab?.name, mgmtNetwork, mgmtSubnet, nodes, links]);

  // Synchronize YAML text when switching to YAML tab or preview
  const handleTabChange = (nextTab: TabType) => {
    if (nextTab === 'yaml' || nextTab === 'preview') {
      const generated = generateClabYaml(currentTopology);
      setYamlText(generated);
    }
    if (nextTab === 'preview') {
      runValidation();
    }
    setActiveTab(nextTab);
  };

  // Regenerate YAML from Form action
  const handleRegenerateYaml = async () => {
    if (labId) {
      try {
        const res = await api.renderLab(labId);
        setYamlText(res.yaml);
        setYamlError(null);
        return;
      } catch {
        // Fall back to client generation
      }
    }
    const generated = generateClabYaml(currentTopology);
    setYamlText(generated);
    setYamlError(null);
  };

  // Parse YAML to Form action
  const handleParseYamlToForm = () => {
    setYamlError(null);
    try {
      const parsed = parseClabYaml(yamlText, labName);
      if (parsed.name) setLabName(parsed.name);
      if (parsed.mgmtNetwork) setMgmtNetwork(parsed.mgmtNetwork);
      if (parsed.mgmtSubnet) setMgmtSubnet(parsed.mgmtSubnet);
      setNodes(parsed.nodes || []);
      setLinks(parsed.links || []);
      setSaveSuccess(false);
    } catch (err: any) {
      setYamlError(err?.message || 'Failed to parse YAML');
    }
  };

  // Run validation
  const runValidation = async () => {
    if (!labId) return;
    setValidating(true);
    try {
      const result = await api.validateLab(labId);
      setValidationResult(result);
    } catch (err: any) {
      setValidationResult({
        topology: [err?.message || 'Validation failed'],
        perServer: [],
      });
    } finally {
      setValidating(false);
    }
  };

  // Save Lab
  const handleSaveLab = async () => {
    if (!labId || !canEdit || saving) return;
    setSaving(true);
    setError(null);
    setSaveSuccess(false);

    try {
      const updated = await api.updateLab(labId, {
        name: labName.trim() || lab?.name,
        topology: currentTopology,
      });
      setLab(updated);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setError(err?.message || 'Failed to save lab');
    } finally {
      setSaving(false);
    }
  };

  // Node editing handlers
  const handleOpenAddNode = () => {
    setEditingNodeIndex(null);
    setNodeForm({
      ...DEFAULT_NODE_FORM,
      name: '',
    });
    setNewIfaceName('');
    setNewIfaceAddress('');
    setIsNodePanelOpen(true);
  };


  const handleOpenEditNode = (index: number) => {
    const target = nodes[index];
    if (!target) return;
    setEditingNodeIndex(index);
    setNodeForm({
      name: target.name,
      intent: target.intent || (target.kind === 'bridge' ? 'bridge' : 'bind'),
      image: target.image || 'dnsnode:1.0',
      mgmtIpv4: target.mgmtIpv4 || '',
      interfaces: target.interfaces ? [...target.interfaces] : [],
    });
    setNewIfaceName('');
    setNewIfaceAddress('');
    setIsNodePanelOpen(true);
  };

  const handleCloseNodePanel = () => {
    setIsNodePanelOpen(false);
    setEditingNodeIndex(null);
  };

  const handleSaveNode = () => {
    const trimmedName = nodeForm.name.trim();
    if (!trimmedName) return;



    const kind: 'linux' | 'bridge' = nodeForm.intent === 'bridge' ? 'bridge' : 'linux';
    const newNode: NodeSpec = {
      name: trimmedName,
      kind,
      intent: nodeForm.intent,
      image: kind === 'linux' ? nodeForm.image.trim() : undefined,
      mgmtIpv4: nodeForm.mgmtIpv4.trim() || undefined,
      interfaces: nodeForm.interfaces,
    };

    if (editingNodeIndex !== null) {
      setNodes((prev) => {
        const next = [...prev];
        next[editingNodeIndex] = newNode;
        return next;
      });
    } else {
      setNodes((prev) => [...prev, newNode]);
    }

    setIsNodePanelOpen(false);
    setEditingNodeIndex(null);
  };

  const handleDeleteNode = (index: number) => {
    const target = nodes[index];
    if (!target) return;
    setNodes((prev) => prev.filter((_, i) => i !== index));
    // Remove links that referenced this node
    setLinks((prev) =>
      prev.filter((link) => {
        const [a, b] = link.endpoints;
        const nodeA = a.split(':')[0];
        const nodeB = b.split(':')[0];
        return nodeA !== target.name && nodeB !== target.name;
      })
    );
  };

  const handleAddInterface = () => {
    const name = newIfaceName.trim();
    const address = newIfaceAddress.trim();
    if (!name || !address) return;
    setNodeForm((prev) => ({
      ...prev,
      interfaces: [...prev.interfaces, { name, address }],
    }));
    setNewIfaceName('');
    setNewIfaceAddress('');
  };

  const handleRemoveInterface = (ifaceIndex: number) => {
    setNodeForm((prev) => ({
      ...prev,
      interfaces: prev.interfaces.filter((_, i) => i !== ifaceIndex),
    }));
  };

  // Link handlers
  const handleAddLink = () => {
    const a = newEndpointA.trim();
    const b = newEndpointB.trim();
    if (!a || !b) return;
    setLinks((prev) => [...prev, { endpoints: [a, b] }]);
    setNewEndpointA('');
    setNewEndpointB('');
  };

  const handleDeleteLink = (index: number) => {
    setLinks((prev) => prev.filter((_, i) => i !== index));
  };

  if (loading) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
        Loading lab details…
      </div>
    );
  }

  if (error && !lab) {
    return (
      <div style={{ padding: '24px 32px' }}>
        <InlineAlert tone="error">{error}</InlineAlert>
        <div style={{ marginTop: '16px' }}>
          <Link to={`/config/${configId}/labs`} className="btn btn-secondary blueprint">
            Back to Labs
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '24px 32px',
        maxWidth: 'var(--chrome-max-content-w, 1040px)',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ marginBottom: '8px' }}>
          <Link
            to={`/config/${configId}/labs`}
            style={{
              fontSize: '12px',
              color: 'var(--color-accent-800)',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontWeight: 500,
            }}
          >
            ← Back to Labs
          </Link>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h1
              style={{
                fontSize: '22px',
                fontWeight: 600,
                margin: 0,
                fontFamily: 'var(--font-heading)',
              }}
            >
              {labName || 'Lab Editor'}
            </h1>
            <span
              className="tag tag-neutral"
              style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}
            >
              {nodes.length} nodes · {links.length} links
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {saveSuccess && (
              <StatusPill state="SYNCED" label="Saved" />
            )}
            {canEdit && (
              <Button
                variant="primary"
                onClick={handleSaveLab}
                loading={saving}
                disabled={saving}
              >
                Save Lab
              </Button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <InlineAlert tone="error" style={{ marginBottom: '16px' }}>
          {error}
        </InlineAlert>
      )}

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--color-divider)',
          marginBottom: '20px',
          gap: '4px',
        }}
      >
        <button
          type="button"
          onClick={() => handleTabChange('form')}
          className="btn btn-ghost"
          style={{
            borderRadius: 0,
            borderBottom: activeTab === 'form' ? '2px solid var(--color-accent)' : '2px solid transparent',
            color: activeTab === 'form' ? 'var(--color-accent-800)' : 'var(--color-text)',
            fontWeight: activeTab === 'form' ? 600 : 400,
            padding: '8px 16px',
          }}
        >
          Form Editor
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('yaml')}
          className="btn btn-ghost"
          style={{
            borderRadius: 0,
            borderBottom: activeTab === 'yaml' ? '2px solid var(--color-accent)' : '2px solid transparent',
            color: activeTab === 'yaml' ? 'var(--color-accent-800)' : 'var(--color-text)',
            fontWeight: activeTab === 'yaml' ? 600 : 400,
            padding: '8px 16px',
          }}
        >
          YAML
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('preview')}
          className="btn btn-ghost"
          style={{
            borderRadius: 0,
            borderBottom: activeTab === 'preview' ? '2px solid var(--color-accent)' : '2px solid transparent',
            color: activeTab === 'preview' ? 'var(--color-accent-800)' : 'var(--color-text)',
            fontWeight: activeTab === 'preview' ? 600 : 400,
            padding: '8px 16px',
          }}
        >
          Preview & Validate
        </button>
      </div>

      {/* TAB 1: FORM EDITOR */}
      {activeTab === 'form' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Topology Settings */}
          <div
            style={{
              padding: '16px',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-divider)',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '16px',
            }}
          >
            <div className="field">
              <label htmlFor="edit-lab-name">Lab Name</label>
              <Input
                id="edit-lab-name"
                value={labName}
                onChange={(e) => setLabName(e.target.value)}
                placeholder="lab-name"
              />
            </div>
            <div className="field">
              <label htmlFor="edit-mgmt-network">Mgmt Network</label>
              <Input
                id="edit-mgmt-network"
                value={mgmtNetwork}
                onChange={(e) => setMgmtNetwork(e.target.value)}
                placeholder="clab-mgmt"
              />
            </div>
            <div className="field">
              <label htmlFor="edit-mgmt-subnet">Mgmt IPv4 Subnet</label>
              <Input
                id="edit-mgmt-subnet"
                value={mgmtSubnet}
                onChange={(e) => setMgmtSubnet(e.target.value)}
                placeholder="10.70.0.0/24"
              />
            </div>
          </div>

          {/* Nodes Section */}
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '12px',
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Nodes</h3>
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                  BIND DNS nodes reconcile to managed Servers in this Configuration. Routers and bridges provide data-plane network infrastructure.
                </p>
              </div>
              {canEdit && (
                <Button variant="secondary" size="sm" onClick={handleOpenAddNode}>
                  Add Node
                </Button>
              )}
            </div>

            <div
              style={{
                border: '1px solid var(--color-divider)',
                background: 'var(--color-surface)',
              }}
            >
              <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr>
                    <th scope="col" style={{ padding: '8px 16px' }}>Node Name</th>
                    <th scope="col" style={{ padding: '8px 16px' }}>Role / Intent</th>
                    <th scope="col" style={{ padding: '8px 16px' }}>Image</th>
                    <th scope="col" style={{ padding: '8px 16px' }}>Mgmt IPv4</th>
                    <th scope="col" style={{ padding: '8px 16px' }}>Interfaces</th>
                    <th scope="col" style={{ padding: '8px 16px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                        No nodes defined. Click "Add Node" to declare one.
                      </td>
                    </tr>
                  ) : (
                    nodes.map((node, idx) => {
                      const intent = node.intent || (node.kind === 'bridge' ? 'bridge' : 'bind');
                      const isBind = intent === 'bind';

                      return (
                        <tr key={node.name || idx}>
                          <td style={{ padding: '8px 16px', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                            {node.name}
                          </td>
                          <td style={{ padding: '8px 16px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <span
                                className={`tag ${isBind ? 'tag-primary' : 'tag-neutral'}`}
                                style={{ fontSize: '11px', alignSelf: 'flex-start' }}
                              >
                                {isBind ? 'BIND Server' : intent === 'router' ? 'Router' : 'Bridge'}
                              </span>
                              {isBind && (
                                <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                                  maps to srv-{lab?.id || 'lab'}-{node.name}
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: '8px 16px', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                            {node.image || '—'}
                          </td>
                          <td style={{ padding: '8px 16px', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                            {node.mgmtIpv4 || '—'}
                          </td>
                          <td style={{ padding: '8px 16px', fontSize: '12px' }}>
                            {node.interfaces && node.interfaces.length > 0 ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                {node.interfaces.map((iface, i) => (
                                  <span key={i} style={{ fontFamily: 'var(--font-mono)' }}>
                                    {iface.name}: {iface.address}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span style={{ color: 'var(--color-text-secondary)' }}>none</span>
                            )}
                          </td>
                          <td style={{ padding: '8px 16px', textAlign: 'right' }}>
                            {canEdit && (
                              <div style={{ display: 'inline-flex', gap: '4px' }}>
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditNode(idx)}
                                  className="btn btn-ghost"
                                  style={{ height: '26px', padding: '0 6px', fontSize: '11px' }}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteNode(idx)}
                                  className="btn btn-ghost"
                                  style={{ height: '26px', padding: '0 6px', fontSize: '11px', color: 'var(--state-error)' }}
                                >
                                  Remove
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Links Section */}
          <div>
            <div style={{ marginBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Links</h3>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                Point-to-point links connecting container interfaces (e.g. <code>ns1:eth1</code> ↔ <code>r1:eth1</code>).
              </p>
            </div>

            {canEdit && (
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'center',
                  padding: '12px 16px',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-divider)',
                  borderBottom: 'none',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <label htmlFor="endpoint-a" style={{ fontSize: '12px', fontWeight: 500 }}>Endpoint A:</label>
                  <Input
                    id="endpoint-a"
                    placeholder="ns1:eth1"
                    value={newEndpointA}
                    onChange={(e) => setNewEndpointA(e.target.value)}
                    style={{ width: '140px', height: '28px', fontSize: '12px' }}
                    mono
                  />
                </div>
                <span style={{ color: 'var(--color-text-secondary)' }}>↔</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <label htmlFor="endpoint-b" style={{ fontSize: '12px', fontWeight: 500 }}>Endpoint B:</label>
                  <Input
                    id="endpoint-b"
                    placeholder="r1:eth1"
                    value={newEndpointB}
                    onChange={(e) => setNewEndpointB(e.target.value)}
                    style={{ width: '140px', height: '28px', fontSize: '12px' }}
                    mono
                  />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleAddLink}
                  disabled={!newEndpointA.trim() || !newEndpointB.trim()}
                >
                  Add Link
                </Button>
              </div>
            )}

            <div
              style={{
                border: '1px solid var(--color-divider)',
                background: 'var(--color-surface)',
              }}
            >
              <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr>
                    <th scope="col" style={{ padding: '8px 16px' }}>#</th>
                    <th scope="col" style={{ padding: '8px 16px' }}>Endpoint A</th>
                    <th scope="col" style={{ padding: '8px 16px' }}>Endpoint B</th>
                    <th scope="col" style={{ padding: '8px 16px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {links.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                        No links defined. Add a link above.
                      </td>
                    </tr>
                  ) : (
                    links.map((link, idx) => (
                      <tr key={idx}>
                        <td style={{ padding: '8px 16px', width: '40px', color: 'var(--color-text-secondary)' }}>
                          {idx + 1}
                        </td>
                        <td style={{ padding: '8px 16px', fontFamily: 'var(--font-mono)' }}>
                          {link.endpoints[0]}
                        </td>
                        <td style={{ padding: '8px 16px', fontFamily: 'var(--font-mono)' }}>
                          {link.endpoints[1]}
                        </td>
                        <td style={{ padding: '8px 16px', textAlign: 'right' }}>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => handleDeleteLink(idx)}
                              className="btn btn-ghost"
                              style={{ height: '26px', padding: '0 6px', fontSize: '11px', color: 'var(--state-error)' }}
                              aria-label={`Remove link ${link.endpoints[0]} to ${link.endpoints[1]}`}
                            >
                              Remove
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: YAML TAB */}
      {activeTab === 'yaml' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Containerlab YAML</h3>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                Edit or paste a <code>clab.yml</code> specification and parse it to synchronize the form model.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button variant="secondary" size="sm" onClick={handleRegenerateYaml}>
                Regenerate YAML from form
              </Button>
              <Button variant="primary" size="sm" onClick={handleParseYamlToForm}>
                Parse YAML to form
              </Button>
            </div>
          </div>

          {yamlError && (
            <InlineAlert tone="error">{yamlError}</InlineAlert>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '16px' }}>
            <div>
              <label
                htmlFor="clab-yaml-editor"
                style={{ display: 'block', marginBottom: '6px', fontSize: '12px', fontWeight: 500 }}
              >
                YAML Editor (Editable)
              </label>
              <Textarea
                id="clab-yaml-editor"
                value={yamlText}
                onChange={(e) => setYamlText(e.target.value)}
                rows={18}
                mono
                style={{ width: '100%', fontSize: '13px', lineHeight: 1.45 }}
              />
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: PREVIEW & VALIDATE */}
      {activeTab === 'preview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Preview & Validation</h3>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                Inspect rendered containerlab YAML and validate configuration health across topology and BIND servers.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={runValidation}
              loading={validating}
            >
              Validate Now
            </Button>
          </div>

          {/* Validation Feedback */}
          {validationResult && (
            <div
              style={{
                padding: '16px',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-divider)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600 }}>Validation Status:</span>
                <StatusPill
                  state={
                    validationResult.topology.length === 0 &&
                    validationResult.perServer.every((s) => s.ok)
                      ? 'SYNCED'
                      : 'ERROR'
                  }
                  label={
                    validationResult.topology.length === 0 &&
                    validationResult.perServer.every((s) => s.ok)
                      ? 'All Valid'
                      : 'Issues Found'
                  }
                />
              </div>

              {validationResult.topology.length > 0 && (
                <InlineAlert tone="error">
                  <div style={{ fontWeight: 600, marginBottom: '4px' }}>Topology Issues:</div>
                  <ul style={{ margin: 0, paddingLeft: '18px' }}>
                    {validationResult.topology.map((prob, i) => (
                      <li key={i}>{prob}</li>
                    ))}
                  </ul>
                </InlineAlert>
              )}

              {validationResult.perServer.length > 0 && (
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                    BIND Server Pre-flight Validation:
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {validationResult.perServer.map((srv) => (
                      <div
                        key={srv.serverId}
                        style={{
                          padding: '8px 12px',
                          border: '1px solid var(--color-divider)',
                          background: 'var(--color-bg)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: '12px',
                        }}
                      >
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{srv.serverId}</span>
                        <StatusPill state={srv.ok ? 'SYNCED' : 'ERROR'} label={srv.ok ? 'OK' : 'Error'} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {validationResult.topology.length === 0 &&
                validationResult.perServer.every((s) => s.ok) && (
                  <InlineAlert tone="info">
                    Topology and BIND server configurations are valid. Ready for deployment.
                  </InlineAlert>
                )}
            </div>
          )}

          {/* Rendered YAML CodeBlock */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600 }}>Rendered clab.yml</span>
            </div>
            <CodeBlock
              code={yamlText || generateClabYaml(currentTopology)}
              language="yaml"
              lineNumbers
              copyable
            />
          </div>
        </div>
      )}

      {/* NODE ADD / EDIT SIDEPANEL */}
      <SidePanel
        open={isNodePanelOpen}
        onClose={handleCloseNodePanel}
        title={editingNodeIndex !== null ? `Edit Node: ${nodeForm.name}` : 'Add Node'}
        actions={
          <>
            <Button variant="secondary" onClick={handleCloseNodePanel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSaveNode}
              disabled={!nodeForm.name.trim()}
            >
              {editingNodeIndex !== null ? 'Save Changes' : 'Add Node'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div className="field">
            <label htmlFor="node-name">Node Name</label>
            <Input
              id="node-name"
              placeholder="e.g. ns1"
              value={nodeForm.name}
              onChange={(e) => setNodeForm((prev) => ({ ...prev, name: e.target.value }))}
              autoFocus
              mono
            />
          </div>

          <div className="field">
            <label htmlFor="node-intent">Role / Intent</label>
            <Select
              id="node-intent"
              value={nodeForm.intent}
              onChange={(e) =>
                setNodeForm((prev) => ({
                  ...prev,
                  intent: e.target.value as 'bind' | 'router' | 'bridge',
                }))
              }
              options={[
                { label: 'BIND DNS Server (bind)', value: 'bind' },
                { label: 'Router / Gateway (router)', value: 'router' },
                { label: 'Bridge / L2 Switch (bridge)', value: 'bridge' },
              ]}
            />
          </div>

          {nodeForm.intent === 'bind' && (
            <InlineAlert tone="info">
              This node will map to a managed <strong>Server</strong> in configuration <code>{configId}</code>.
            </InlineAlert>
          )}

          {nodeForm.intent !== 'bridge' && (
            <>
              <div className="field">
                <label htmlFor="node-image">Container Image</label>
                <Input
                  id="node-image"
                  placeholder="e.g. dnsnode:1.0"
                  value={nodeForm.image}
                  onChange={(e) => setNodeForm((prev) => ({ ...prev, image: e.target.value }))}
                  mono
                />
              </div>

              <div className="field">
                <label htmlFor="node-mgmt-ipv4">Management IPv4</label>
                <Input
                  id="node-mgmt-ipv4"
                  placeholder="e.g. 10.70.0.11"
                  value={nodeForm.mgmtIpv4}
                  onChange={(e) => setNodeForm((prev) => ({ ...prev, mgmtIpv4: e.target.value }))}
                  mono
                />
              </div>

              {/* Data Interfaces */}
              <div className="field">
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 500, fontSize: '13px' }}>
                  Data Plane Interfaces
                </label>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                  <Input
                    placeholder="Interface (e.g. eth1)"
                    value={newIfaceName}
                    onChange={(e) => setNewIfaceName(e.target.value)}
                    style={{ flex: 1 }}
                    mono
                  />
                  <Input
                    placeholder="Address (e.g. 10.70.0.11/24)"
                    value={newIfaceAddress}
                    onChange={(e) => setNewIfaceAddress(e.target.value)}
                    style={{ flex: 2 }}
                    mono
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleAddInterface}
                    disabled={!newIfaceName.trim() || !newIfaceAddress.trim()}
                  >
                    Add
                  </Button>
                </div>

                {nodeForm.interfaces.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {nodeForm.interfaces.map((iface, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '4px 8px',
                          background: 'var(--color-surface)',
                          border: '1px solid var(--color-divider)',
                          fontSize: '12px',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        <span>{iface.name}: {iface.address}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveInterface(i)}
                          className="btn btn-ghost"
                          style={{ height: '22px', padding: '0 4px', fontSize: '11px', color: 'var(--state-error)' }}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </SidePanel>
    </div>
  );
}

export default LabEditor;
