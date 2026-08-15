import type { ConfigModel } from './model';
import { resolveOption, zonesForServer } from './resolve';

interface RootServerInfo {
  name: string;
  address: string;
}

function firstServiceAddress(server: Record<string, unknown> | undefined): string | undefined {
  if (!server) return undefined;

  const interfaces = server.serviceInterfaces;
  if (Array.isArray(interfaces) && interfaces.length > 0) {
    const first = interfaces[0];
    if (first && typeof first === 'object' && 'address' in first) {
      const address = (first as { address: unknown }).address;
      if (typeof address === 'string') return address;
    }
  }

  if (typeof server.address === 'string') return server.address;

  return undefined;
}

// Root hints always reference the well-known name "ns.root." — the same
// convention used by anycast-dns/configs/*/db.root — rather than the
// zone's own SOA primaryNs, so generated hints stay stable even if the
// root zone's SOA is edited.
export function findRootServer(model: ConfigModel): RootServerInfo | undefined {
  const rootZone = model.zones?.find((z) => z.name === '.');
  if (!rootZone) return undefined;

  const primaryRole = model.roles?.find(
    (r) => r.zoneId === rootZone.id && r.role === 'PRIMARY',
  );
  if (!primaryRole) return undefined;

  const rootServer = model.servers?.find((s) => s.id === primaryRole.serverId);
  const address = firstServiceAddress(rootServer);
  if (!address) return undefined;

  return { name: 'ns.root.', address };
}

// A server needs a root-hints file when it either holds an explicit
// RECURSIVE role, or generateNamedConf would silently attach the implicit
// `zone "." { type hint; file "/etc/bind/db.root"; };` stanza it adds for
// any server with recursion enabled and no zone/hint of its own.
export function serverNeedsRootHints(model: ConfigModel, serverId: string): boolean {
  const entries = zonesForServer(model, serverId);

  if (entries.some((entry) => entry.role === 'RECURSIVE')) return true;

  const hasHintOrDot = entries.some(
    (entry) => entry.zone.name === '.' || entry.role === 'RECURSIVE',
  );
  if (hasHintOrDot) return false;

  const recursion = resolveOption(model, { serverId }, 'recursion');
  return recursion === true || recursion === 'yes';
}

export function generateRootHints(root: RootServerInfo): string {
  return (
    `.                        3600000      IN      NS    ${root.name}\n` +
    `${root.name}                 3600000      IN      A     ${root.address}\n`
  );
}
