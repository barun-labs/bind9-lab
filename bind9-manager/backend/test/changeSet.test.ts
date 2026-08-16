import { describe, it, expect } from 'vitest';
import { computeChangeSet, diffLines, splitDiff } from '../src/server/changeSet';
import type { ConfigModel } from '../src/config-engine/model';

function makeModel(overrides: Record<string, unknown> = {}): ConfigModel {
  return {
    configuration: {
      id: 'cfg-1',
      name: 'cfg-1',
      isActive: true,
      createdFromTemplateId: null,
      createdAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:00.000Z',
      counts: { views: 0, zones: 0, records: 0, servers: 0 },
    },
    views: [
      { id: 'view-1', configurationId: 'cfg-1', name: 'internal', defaultForConfig: true, options: [] },
    ],
    zones: [
      { id: 'zone-1', configurationId: 'cfg-1', viewId: 'view-1', name: 'example.com', type: 'primary', options: [] },
    ],
    records: [
      { id: 'rec-1', zoneId: 'zone-1', name: 'www', fqdn: 'www.example.com.', type: 'A', ttl: 300, content: '10.0.0.1' },
    ],
    servers: [{ id: 'srv-1', nodeName: 'ns1' }],
    acls: [{ id: 'acl-1', configurationId: 'cfg-1', name: 'internal', entries: [] }],
    roles: [],
    options: [],
    ...overrides,
  } as unknown as ConfigModel;
}

describe('computeChangeSet', () => {
  it('treats a null baseline as all-CREATE with correct ids, labels, and groupKeys', () => {
    const model = makeModel();
    const items = computeChangeSet(model, null);

    expect(items.map((i) => i.action)).toEqual(['CREATE', 'CREATE', 'CREATE', 'CREATE', 'CREATE']);
    expect(items.every((i) => i.configurationId === 'cfg-1')).toBe(true);

    const view = items.find((i) => i.objectType === 'VIEW')!;
    expect(view).toMatchObject({ id: 'cs-VIEW-view-1', objectLabel: 'internal', groupKey: 'VIEW' });

    const zone = items.find((i) => i.objectType === 'ZONE')!;
    expect(zone).toMatchObject({ id: 'cs-ZONE-zone-1', objectLabel: 'example.com', groupKey: 'example.com' });

    const record = items.find((i) => i.objectType === 'RECORD')!;
    expect(record).toMatchObject({
      id: 'cs-RECORD-rec-1',
      objectLabel: 'www.example.com.',
      groupKey: 'example.com',
    });

    const acl = items.find((i) => i.objectType === 'ACL')!;
    expect(acl).toMatchObject({ id: 'cs-ACL-acl-1', objectLabel: 'internal', groupKey: 'ACL' });
  });

  it('detects UPDATE when a field changes and DELETE when an object disappears', () => {
    const baseline = makeModel();
    const changed = makeModel({
      zones: [
        { id: 'zone-1', configurationId: 'cfg-1', viewId: 'view-1', name: 'example.com', type: 'PRIMARY', options: [], ttl: 3600 },
      ],
      records: [],
    });

    const items = computeChangeSet(changed, baseline);
    const zone = items.find((i) => i.objectType === 'ZONE')!;
    expect(zone.action).toBe('UPDATE');

    const record = items.find((i) => i.objectType === 'RECORD')!;
    expect(record.action).toBe('DELETE');
    expect(record.diff.before).toMatchObject({ id: 'rec-1' });
    expect(record.diff.after).toBeNull();
  });

  it('classifies a disable-flag flip as DISABLE/ENABLE, not UPDATE', () => {
    const baseline = makeModel();
    const disabled = makeModel({
      servers: [{ id: 'srv-1', nodeName: 'ns1', adminState: 'DISABLED' }],
    });
    const disabledItems = computeChangeSet(disabled, baseline);
    expect(disabledItems.find((i) => i.objectType === 'SERVER')!.action).toBe('DISABLE');

    const reenabled = computeChangeSet(makeModel(), disabled);
    expect(reenabled.find((i) => i.objectType === 'SERVER')!.action).toBe('ENABLE');
  });

  it('ignores syncState-only changes (runtime status is not config intent)', () => {
    const baseline = makeModel();
    const synced = makeModel({
      servers: [{ id: 'srv-1', nodeName: 'ns1', syncState: 'SYNCED' }],
    });
    const items = computeChangeSet(synced, baseline);
    expect(items.find((i) => i.objectType === 'SERVER')).toBeUndefined();
  });

  it('produces no items when current equals baseline', () => {
    const model = makeModel();
    expect(computeChangeSet(model, model)).toEqual([]);
  });
});

describe('diffLines + splitDiff', () => {
  it('marks unchanged lines context, added lines add, removed lines del', () => {
    const lines = diffLines('a\nb\nc', 'a\nx\nc');
    expect(lines).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'x' },
      { kind: 'context', text: 'c' },
    ]);
  });

  it('emits trailing deletions and additions', () => {
    const lines = diffLines('a\nb', 'a');
    expect(lines).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'del', text: 'b' },
    ]);

    const add = diffLines('a', 'a\nb');
    expect(add).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'add', text: 'b' },
    ]);
  });

  it('splitDiff aligns sides and numbers lines on the owning side only', () => {
    const split = splitDiff(diffLines('a\nb\nc', 'a\nx\nc'));
    expect(split.left).toEqual([
      { lineNo: 1, text: 'a', kind: 'context' },
      { lineNo: 2, text: 'b', kind: 'del' },
      { text: '', kind: 'add' },
      { lineNo: 3, text: 'c', kind: 'context' },
    ]);
    expect(split.right).toEqual([
      { lineNo: 1, text: 'a', kind: 'context' },
      { text: '', kind: 'del' },
      { lineNo: 2, text: 'x', kind: 'add' },
      { lineNo: 3, text: 'c', kind: 'context' },
    ]);
  });
});
