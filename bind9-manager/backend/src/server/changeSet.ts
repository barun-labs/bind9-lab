import type { ConfigModel } from '../config-engine/model';
import type {
  ChangeSetItem,
  ChangeSetItemAction,
  ChangeSetObjectType,
} from '../../../shared/entities';

export interface DiffLine {
  kind: 'context' | 'add' | 'del';
  text: string;
}

const TYPE_ORDER: Record<ChangeSetObjectType, number> = {
  VIEW: 0,
  ZONE: 1,
  RECORD: 2,
  ACL: 3,
  SERVER: 4,
  OPTION: 5,
  ROLE: 6,
};

function json(v: unknown): string {
  return JSON.stringify(v);
}

function isDisabledFlag(obj: Record<string, unknown>): boolean {
  return obj.disabled === true || obj.adminState === 'DISABLED';
}

// Remove the fields whose only-change is classified as DISABLE/ENABLE rather
// than UPDATE: the disable flag (disabled/adminState) and the runtime status
// field (syncState) that flip independently of config intent.
function withoutDisableFlags(obj: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...obj };
  delete clone.disabled;
  delete clone.adminState;
  delete clone.syncState;
  return clone;
}

interface CollectionSpec {
  type: ChangeSetObjectType;
  current: unknown[];
  baseline: unknown[];
  label: (obj: Record<string, unknown>) => string;
  groupKey: (obj: Record<string, unknown>) => string;
}

function diffCollection(
  spec: CollectionSpec,
  configId: string,
): ChangeSetItem[] {
  const cur = new Map<string, Record<string, unknown>>();
  const base = new Map<string, Record<string, unknown>>();
  for (const raw of spec.current) {
    const obj = raw as Record<string, unknown>;
    cur.set(String(obj.id), obj);
  }
  for (const raw of spec.baseline) {
    const obj = raw as Record<string, unknown>;
    base.set(String(obj.id), obj);
  }

  const items: ChangeSetItem[] = [];
  for (const id of new Set([...cur.keys(), ...base.keys()])) {
    const c = cur.get(id);
    const b = base.get(id);

    let action: ChangeSetItemAction;
    let before: unknown = null;
    let after: unknown = null;

    if (c !== undefined && b === undefined) {
      action = 'CREATE';
      after = c;
    } else if (c === undefined && b !== undefined) {
      action = 'DELETE';
      before = b;
    } else if (c !== undefined && b !== undefined) {
      if (json(c) === json(b)) continue;
      const cDisabled = isDisabledFlag(c);
      const bDisabled = isDisabledFlag(b);
      const restEqual = json(withoutDisableFlags(c)) === json(withoutDisableFlags(b));
      if (restEqual) {
        if (cDisabled !== bDisabled) {
          action = cDisabled ? 'DISABLE' : 'ENABLE';
        } else {
          // Only the runtime status field (syncState) changed — not config intent.
          continue;
        }
      } else {
        action = 'UPDATE';
      }
      before = b;
      after = c;
    } else {
      continue;
    }

    const obj = (c ?? b) as Record<string, unknown>;
    items.push({
      id: `cs-${spec.type}-${id}`,
      configurationId: configId,
      objectType: spec.type,
      objectId: id,
      objectLabel: spec.label(obj),
      groupKey: spec.groupKey(obj),
      action,
      diff: { before, after },
      createdBy: 'user',
    });
  }

  return items;
}

/**
 * Compute the pending change set by diffing the live model against the
 * last-deployed baseline. Pure: ids are a function of (objectType, objectId),
 * so a client can GET the change set then POST a deploy referencing the same
 * ids. baseline === null means every current object is CREATE.
 */
export function computeChangeSet(
  current: ConfigModel,
  baseline: ConfigModel | null,
): ChangeSetItem[] {
  const configId = current.configuration.id;

  const currentZoneById = new Map((current.zones ?? []).map((z) => [z.id, z]));
  const baselineZoneById = new Map((baseline?.zones ?? []).map((z) => [z.id, z]));
  const zoneNameForRecord = (record: Record<string, unknown>): string => {
    const zoneId = String(record.zoneId);
    const zone = currentZoneById.get(zoneId) ?? baselineZoneById.get(zoneId);
    return zone ? zone.name : zoneId;
  };

  const specs: CollectionSpec[] = [
    {
      type: 'VIEW',
      current: current.views ?? [],
      baseline: baseline?.views ?? [],
      label: (v) => v.name as string,
      groupKey: () => 'VIEW',
    },
    {
      type: 'ZONE',
      current: current.zones ?? [],
      baseline: baseline?.zones ?? [],
      label: (z) => z.name as string,
      groupKey: (z) => z.name as string,
    },
    {
      type: 'RECORD',
      current: current.records ?? [],
      baseline: baseline?.records ?? [],
      label: (r) => (r.fqdn as string) ?? (r.name as string),
      groupKey: zoneNameForRecord,
    },
    {
      type: 'ACL',
      current: current.acls ?? [],
      baseline: baseline?.acls ?? [],
      label: (a) => a.name as string,
      groupKey: () => 'ACL',
    },
    {
      type: 'SERVER',
      current: current.servers ?? [],
      baseline: baseline?.servers ?? [],
      label: (s) => String(s.id),
      groupKey: () => 'SERVER',
    },
    {
      type: 'OPTION',
      current: (current.options ?? []).filter((o) => o.id),
      baseline: (baseline?.options ?? []).filter((o) => o.id),
      label: (o) => `${o.scopeType as string}:${o.key as string}`,
      groupKey: () => 'OPTION',
    },
    {
      type: 'ROLE',
      current: current.roleRows ?? [],
      baseline: baseline?.roleRows ?? [],
      label: (r) => `${r.scope as string}:${r.scopeId as string}:${r.serverId as string}:${r.role as string}`,
      groupKey: () => 'ROLE',
    },
  ];

  const items = specs.flatMap((spec) => diffCollection(spec, configId));

  items.sort((a, b) => {
    if (a.groupKey !== b.groupKey) return a.groupKey.localeCompare(b.groupKey);
    const typeOrder = TYPE_ORDER[a.objectType] - TYPE_ORDER[b.objectType];
    if (typeOrder !== 0) return typeOrder;
    return a.objectId.localeCompare(b.objectId);
  });

  return items;
}

/**
 * LCS-based line diff. LEFT is `before`, RIGHT is `after`: unchanged lines are
 * `context`, only-in-after lines are `add`, only-in-before lines are `del`.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'context', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: 'del', text: a[i] });
      i++;
    } else {
      out.push({ kind: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) {
    out.push({ kind: 'del', text: a[i] });
    i++;
  }
  while (j < m) {
    out.push({ kind: 'add', text: b[j] });
    j++;
  }

  return out;
}

export interface SplitSideLine {
  lineNo?: number;
  text: string;
  kind: 'context' | 'add' | 'del';
}

export interface SplitDiff {
  left: SplitSideLine[];
  right: SplitSideLine[];
}

/** Derive side-by-side columns from the same DiffLine[] used for unified view. */
export function splitDiff(lines: DiffLine[]): SplitDiff {
  const left: SplitSideLine[] = [];
  const right: SplitSideLine[] = [];
  let leftNo = 0;
  let rightNo = 0;

  for (const line of lines) {
    if (line.kind === 'add') {
      rightNo++;
      left.push({ text: '', kind: 'add' });
      right.push({ lineNo: rightNo, text: line.text, kind: 'add' });
    } else if (line.kind === 'del') {
      leftNo++;
      left.push({ lineNo: leftNo, text: line.text, kind: 'del' });
      right.push({ text: '', kind: 'del' });
    } else {
      leftNo++;
      rightNo++;
      left.push({ lineNo: leftNo, text: line.text, kind: 'context' });
      right.push({ lineNo: rightNo, text: line.text, kind: 'context' });
    }
  }

  return { left, right };
}
