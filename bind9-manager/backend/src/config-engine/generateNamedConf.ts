import type { ConfigModel, ServerRole, View, Zone } from './model';
import { resolveOption, zonesForServer } from './resolve';

function extractAddress(item: unknown): string {
  if (typeof item === 'string') return item;
  if (typeof item === 'number') return String(item);
  if (item && typeof item === 'object') {
    if ('address' in item && typeof (item as { address: unknown }).address === 'string') {
      return (item as { address: string }).address;
    }
    if ('ip' in item && typeof (item as { ip: unknown }).ip === 'string') {
      return (item as { ip: string }).ip;
    }
    if ('value' in item && typeof (item as { value: unknown }).value === 'string') {
      return (item as { value: string }).value;
    }
  }
  return String(item);
}

function formatAclList(val: unknown): string {
  if (val === undefined || val === null) {
    return '{ any; }';
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return '{ none; }';
    const items = val.map((raw) => {
      const item = extractAddress(raw).trim();
      return item.endsWith(';') ? item : `${item};`;
    });
    return `{ ${items.join(' ')} }`;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return trimmed;
    }
    const parts = trimmed
      .split(/[;\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length === 0) return '{ none; }';
    return `{ ${parts.map((p) => `${p};`).join(' ')} }`;
  }
  return `{ ${String(val)}; }`;
}

function formatBool(val: unknown): string {
  if (typeof val === 'boolean') {
    return val ? 'yes' : 'no';
  }
  if (typeof val === 'string') {
    return val;
  }
  return String(val);
}

function renderZone(
  model: ConfigModel,
  serverId: string,
  viewId: string,
  zone: Zone,
  role: ServerRole,
): string {
  const scope = { serverId, viewId, zoneId: zone.id };
  const lines: string[] = [];
  const zoneFileName = zone.name === '.' ? 'root' : zone.name;

  switch (role) {
    case 'PRIMARY': {
      lines.push('        type primary;');
      const fileOpt = resolveOption(model, scope, 'file') as string | undefined;
      const filePath = fileOpt ?? `/etc/bind/zones/db.${zoneFileName}`;
      lines.push(`        file "${filePath}";`);

      const allowTransfer =
        resolveOption(model, scope, 'allow-transfer') ?? zone.allowTransfer;
      if (allowTransfer !== undefined) {
        lines.push(`        allow-transfer ${formatAclList(allowTransfer)};`);
      }

      const allowUpdate =
        resolveOption(model, scope, 'allow-update') ?? zone.allowUpdate;
      if (allowUpdate !== undefined) {
        lines.push(`        allow-update ${formatAclList(allowUpdate)};`);
      }

      const alsoNotify = resolveOption(model, scope, 'also-notify');
      if (alsoNotify !== undefined) {
        lines.push(`        also-notify ${formatAclList(alsoNotify)};`);
      }
      break;
    }

    case 'SECONDARY': {
      lines.push('        type secondary;');
      const fileOpt = resolveOption(model, scope, 'file') as string | undefined;
      const filePath = fileOpt ?? `/var/bind/sec/db.${zoneFileName}`;
      lines.push(`        file "${filePath}";`);

      const primaries =
        resolveOption(model, scope, 'primaries') ??
        resolveOption(model, scope, 'masters');
      if (primaries !== undefined) {
        lines.push(`        primaries ${formatAclList(primaries)};`);
      }

      const allowTransfer =
        resolveOption(model, scope, 'allow-transfer') ?? zone.allowTransfer;
      if (allowTransfer !== undefined) {
        lines.push(`        allow-transfer ${formatAclList(allowTransfer)};`);
      }
      break;
    }

    case 'FORWARDER': {
      lines.push('        type forward;');
      const forwarders = resolveOption(model, scope, 'forwarders');
      if (forwarders !== undefined) {
        lines.push(`        forwarders ${formatAclList(forwarders)};`);
      }
      const forward = (resolveOption(model, scope, 'forward') as string | undefined) ?? 'only';
      lines.push(`        forward ${forward};`);
      break;
    }

    case 'STUB': {
      lines.push('        type stub;');
      const fileOpt = resolveOption(model, scope, 'file') as string | undefined;
      if (fileOpt !== undefined) {
        lines.push(`        file "${fileOpt}";`);
      }
      const primaries =
        resolveOption(model, scope, 'primaries') ??
        resolveOption(model, scope, 'masters');
      if (primaries !== undefined) {
        lines.push(`        primaries ${formatAclList(primaries)};`);
      }
      break;
    }

    case 'RECURSIVE': {
      lines.push('        type hint;');
      const fileOpt = resolveOption(model, scope, 'file') as string | undefined;
      const filePath = fileOpt ?? '/etc/bind/db.root';
      lines.push(`        file "${filePath}";`);
      break;
    }
  }

  return `    zone "${zone.name}" {\n${lines.join('\n')}\n    };`;
}

function renderView(
  model: ConfigModel,
  serverId: string,
  view: View,
  serverZoneEntries: { zone: Zone; role: ServerRole; view: View }[],
): string {
  const lines: string[] = [];

  // match-clients
  const resolved = resolveOption(model, { serverId, viewId: view.id }, 'match-clients');
  const matchClients =
    Array.isArray(resolved) && resolved.length > 0
      ? resolved
      : view.matchClients && view.matchClients.length > 0
        ? view.matchClients
        : ['any'];
  lines.push(`    match-clients ${formatAclList(matchClients)};`);

  // allow-*
  const allowQuery = resolveOption(model, { serverId, viewId: view.id }, 'allow-query');
  if (allowQuery !== undefined) {
    lines.push(`    allow-query ${formatAclList(allowQuery)};`);
  }

  const allowQueryCache = resolveOption(
    model,
    { serverId, viewId: view.id },
    'allow-query-cache',
  );
  if (allowQueryCache !== undefined) {
    lines.push(`    allow-query-cache ${formatAclList(allowQueryCache)};`);
  }

  const allowRecursion = resolveOption(
    model,
    { serverId, viewId: view.id },
    'allow-recursion',
  );
  if (allowRecursion !== undefined) {
    lines.push(`    allow-recursion ${formatAclList(allowRecursion)};`);
  }

  const allowTransfer = resolveOption(
    model,
    { serverId, viewId: view.id },
    'allow-transfer',
  );
  if (allowTransfer !== undefined) {
    lines.push(`    allow-transfer ${formatAclList(allowTransfer)};`);
  }

  const allowUpdate = resolveOption(
    model,
    { serverId, viewId: view.id },
    'allow-update',
  );
  if (allowUpdate !== undefined) {
    lines.push(`    allow-update ${formatAclList(allowUpdate)};`);
  }

  // recursion
  const recursion = resolveOption(model, { serverId, viewId: view.id }, 'recursion');
  if (recursion !== undefined) {
    lines.push(`    recursion ${formatBool(recursion)};`);
  }

  // dnssec-validation
  const viewDnssec = resolveOption(
    model,
    { serverId, viewId: view.id },
    'dnssec-validation',
  );
  if (viewDnssec !== undefined) {
    lines.push(`    dnssec-validation ${formatBool(viewDnssec)};`);
  }

  // forwarders
  const forwarders = resolveOption(model, { serverId, viewId: view.id }, 'forwarders');
  if (forwarders !== undefined) {
    lines.push(`    forwarders ${formatAclList(forwarders)};`);
  }

  // forward
  const forward = resolveOption(model, { serverId, viewId: view.id }, 'forward');
  if (forward !== undefined) {
    lines.push(`    forward ${forward};`);
  }

  // response policy zones
  const rpzPolicies = (model.rpzPolicies ?? [])
    .filter((p) => p.viewId === view.id)
    .sort((a, b) => a.order - b.order);

  if (rpzPolicies.length > 0) {
    const refs = rpzPolicies.map((p) => {
      const policyPart = p.defaultPolicy ? ` policy ${p.defaultPolicy}` : '';
      return `        zone "${p.name}"${policyPart};`;
    });
    lines.push(`    response-policy {\n${refs.join('\n')}\n    };`);
  }

  // zones in this view
  const zonesInView = serverZoneEntries.filter((entry) => entry.view.id === view.id);
  const isRecursive = recursion === true || recursion === 'yes';
  const hasHintOrDot = zonesInView.some(
    (entry) => entry.zone.name === '.' || entry.role === 'RECURSIVE',
  );

  const zoneBlocks: string[] = [];

  for (const entry of zonesInView) {
    zoneBlocks.push(renderZone(model, serverId, view.id, entry.zone, entry.role));
  }

  for (const p of rpzPolicies) {
    zoneBlocks.push(
      `    zone "${p.name}" {\n        type master;\n        file "/etc/bind/zones/db.rpz.${p.name}";\n    };`,
    );
  }

  if (isRecursive && !hasHintOrDot) {
    zoneBlocks.push(`    zone "." {\n        type hint;\n        file "/etc/bind/db.root";\n    };`);
  }

  let body = lines.join('\n');
  if (zoneBlocks.length > 0) {
    if (body.length > 0) {
      body += '\n\n' + zoneBlocks.join('\n\n');
    } else {
      body = zoneBlocks.join('\n\n');
    }
  }

  return `view "${view.name}" {\n${body}\n};`;
}

function renderTopLevelZone(
  model: ConfigModel,
  serverId: string,
  zone: Zone,
  role: ServerRole,
): string {
  const scope = { serverId, zoneId: zone.id };
  const lines: string[] = [];
  const zoneFileName = zone.name === '.' ? 'root' : zone.name;

  switch (role) {
    case 'PRIMARY': {
      lines.push('    type primary;');
      const fileOpt = resolveOption(model, scope, 'file') as string | undefined;
      const filePath = fileOpt ?? `/etc/bind/zones/db.${zoneFileName}`;
      lines.push(`    file "${filePath}";`);

      const allowTransfer =
        resolveOption(model, scope, 'allow-transfer') ?? zone.allowTransfer;
      if (allowTransfer !== undefined) {
        lines.push(`    allow-transfer ${formatAclList(allowTransfer)};`);
      }

      const allowUpdate =
        resolveOption(model, scope, 'allow-update') ?? zone.allowUpdate;
      if (allowUpdate !== undefined) {
        lines.push(`    allow-update ${formatAclList(allowUpdate)};`);
      }

      const alsoNotify = resolveOption(model, scope, 'also-notify');
      if (alsoNotify !== undefined) {
        lines.push(`    also-notify ${formatAclList(alsoNotify)};`);
      }
      break;
    }

    case 'SECONDARY': {
      lines.push('    type secondary;');
      const fileOpt = resolveOption(model, scope, 'file') as string | undefined;
      const filePath = fileOpt ?? `/var/bind/sec/db.${zoneFileName}`;
      lines.push(`    file "${filePath}";`);

      const primaries =
        resolveOption(model, scope, 'primaries') ??
        resolveOption(model, scope, 'masters');
      if (primaries !== undefined) {
        lines.push(`    primaries ${formatAclList(primaries)};`);
      }

      const allowTransfer =
        resolveOption(model, scope, 'allow-transfer') ?? zone.allowTransfer;
      if (allowTransfer !== undefined) {
        lines.push(`    allow-transfer ${formatAclList(allowTransfer)};`);
      }
      break;
    }

    case 'FORWARDER': {
      lines.push('    type forward;');
      const forwarders = resolveOption(model, scope, 'forwarders');
      if (forwarders !== undefined) {
        lines.push(`    forwarders ${formatAclList(forwarders)};`);
      }
      const forward = (resolveOption(model, scope, 'forward') as string | undefined) ?? 'only';
      lines.push(`    forward ${forward};`);
      break;
    }

    case 'STUB': {
      lines.push('    type stub;');
      const fileOpt = resolveOption(model, scope, 'file') as string | undefined;
      if (fileOpt !== undefined) {
        lines.push(`    file "${fileOpt}";`);
      }
      const primaries =
        resolveOption(model, scope, 'primaries') ??
        resolveOption(model, scope, 'masters');
      if (primaries !== undefined) {
        lines.push(`    primaries ${formatAclList(primaries)};`);
      }
      break;
    }

    case 'RECURSIVE': {
      lines.push('    type hint;');
      const fileOpt = resolveOption(model, scope, 'file') as string | undefined;
      const filePath = fileOpt ?? '/etc/bind/db.root';
      lines.push(`    file "${filePath}";`);
      break;
    }
  }

  return `zone "${zone.name}" {\n${lines.join('\n')}\n};`;
}

export function generateNamedConf(model: ConfigModel, serverId: string): string {
  const directory =
    (resolveOption(model, { serverId }, 'directory') as string | undefined) ??
    '/var/bind';
  const listenOn = resolveOption(model, { serverId }, 'listen-on');
  const listenOnV6 = resolveOption(model, { serverId }, 'listen-on-v6');
  const dnssecValidation =
    resolveOption(model, { serverId }, 'dnssec-validation') ?? 'no';
  const emptyZonesEnable =
    resolveOption(model, { serverId }, 'empty-zones-enable') ?? 'no';
  const serverIdOpt = resolveOption(model, { serverId }, 'server-id');

  const optionsLines: string[] = [
    `    directory "${directory}";`,
    `    listen-on ${listenOn !== undefined ? formatAclList(listenOn) : '{ any; }'};`,
    `    listen-on-v6 ${listenOnV6 !== undefined ? formatAclList(listenOnV6) : '{ none; }'};`,
  ];
  if (serverIdOpt !== undefined) {
    optionsLines.push(`    server-id ${serverIdOpt};`);
  }
  optionsLines.push(`    dnssec-validation ${formatBool(dnssecValidation)};`);
  optionsLines.push(`    empty-zones-enable ${formatBool(emptyZonesEnable)};`);

  const optionsBlock = `options {\n${optionsLines.join('\n')}\n};`;

  const loggingBlock = `logging {
    channel default_log {
        file "/var/log/named.log" versions 3 size 5m;
        severity info;
        print-time yes;
        print-severity yes;
        print-category yes;
    };
    category default { default_log; };
    category queries { default_log; };
    category resolver { default_log; };
};`;

  const controlsBlock = `include "/etc/bind/rndc.key";
controls {
    inet 127.0.0.1 allow { localhost; } keys { "rndc-key"; };
};`;

  const serverZoneEntries = zonesForServer(model, serverId);
  const views = [...(model.views ?? [])].sort((a, b) => a.order - b.order);

  const sections: string[] = [optionsBlock, loggingBlock, controlsBlock];

  if (views.length > 0) {
    for (const view of views) {
      sections.push(renderView(model, serverId, view, serverZoneEntries));
    }
  } else {
    const isRecursive =
      resolveOption(model, { serverId }, 'recursion') === true ||
      resolveOption(model, { serverId }, 'recursion') === 'yes';
    const hasHintOrDot = serverZoneEntries.some(
      (entry) => entry.zone.name === '.' || entry.role === 'RECURSIVE',
    );

    for (const entry of serverZoneEntries) {
      sections.push(renderTopLevelZone(model, serverId, entry.zone, entry.role));
    }
    if (isRecursive && !hasHintOrDot) {
      sections.push(`zone "." {\n    type hint;\n    file "/etc/bind/db.root";\n};`);
    }
  }

  return sections.join('\n\n') + '\n';
}
