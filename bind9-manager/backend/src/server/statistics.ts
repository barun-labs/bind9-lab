import type { Lab } from './labStore';
import type { Runner } from './deployEngine';
import { shellQuote } from '../config-engine/shellQuote';

export interface ServerStatistics {
  serverId: string;      // the node name (matches how reconcile keys servers)
  nodeName: string;
  containerName: string; // clab-<topo>-<node>, derived server-side
  present: boolean;      // true iff the stats dump was read + parsed
  totalQueries?: number;                 // "++ Incoming Requests ++" QUERY count (cumulative)
  responseCodes?: { NOERROR: number; NXDOMAIN: number; SERVFAIL: number; REFUSED: number };
  cacheHits?: number;
  cacheMisses?: number;
  cacheHitRatio?: number;                // hits / (hits+misses), 0..1, undefined if no cache activity
  recursionCount?: number;               // "recursive queries rejected" counter, best-effort
}

export interface StatisticsSnapshot {
  servers: ServerStatistics[];
  at: string;
  runtimeError?: string;
}

function nowIso(): string {
  try {
    return new Date().toISOString();
  } catch {
    return '2026-08-15T00:00:00.000Z';
  }
}

/**
 * Pure parser for a BIND `named.stats` dump. Sections are headed
 * `++ Section Name ++`; counter lines are `<whitespace><integer> <label>`.
 * Any missing section/line simply leaves that field undefined — never throws.
 */
export function parseNamedStats(text: string): Partial<ServerStatistics> {
  const out: Partial<ServerStatistics> = {};
  const rcodes: NonNullable<ServerStatistics['responseCodes']> = {
    NOERROR: 0,
    NXDOMAIN: 0,
    SERVFAIL: 0,
    REFUSED: 0,
  };
  let sawRcodes = false;
  let cacheHits = 0;
  let cacheMisses = 0;
  let sawCache = false;
  let section = '';

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const sectionMatch = /^\+\+\s*(.+?)\s*\+\+/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }

    const counter = /^\s*(\d+)\s+(.+?)\s*$/.exec(rawLine);
    if (!counter) continue;
    const value = parseInt(counter[1], 10);
    const label = counter[2].trim();

    if (section === 'Incoming Requests' && label === 'QUERY') {
      out.totalQueries = value;
    } else if (section === 'Outgoing Rcodes') {
      if (label === 'NOERROR') { rcodes.NOERROR = value; sawRcodes = true; }
      else if (label === 'NXDOMAIN') { rcodes.NXDOMAIN = value; sawRcodes = true; }
      else if (label === 'SERVFAIL') { rcodes.SERVFAIL = value; sawRcodes = true; }
      else if (label === 'REFUSED') { rcodes.REFUSED = value; sawRcodes = true; }
    } else if (section === 'Cache Statistics') {
      // Exact label match — `cache hits (from query)` is a different line.
      if (label === 'cache hits') { cacheHits += value; sawCache = true; }
      else if (label === 'cache misses') { cacheMisses += value; sawCache = true; }
    } else if (section === 'Name Server Statistics' && label === 'recursive queries rejected') {
      out.recursionCount = value;
    }
  }

  if (sawRcodes) out.responseCodes = rcodes;
  if (sawCache) {
    out.cacheHits = cacheHits;
    out.cacheMisses = cacheMisses;
    const denom = cacheHits + cacheMisses;
    if (denom > 0) out.cacheHitRatio = cacheHits / denom;
  }

  return out;
}

export async function statisticsSnapshot(
  lab: Lab,
  run: Runner,
  _labDir: string,
): Promise<StatisticsSnapshot> {
  const at = nowIso();

  // Container names are derived here, server-side, from the lab's own
  // topology — never from request input — so nothing downstream can be
  // steered at a foreign container.
  const bindNodes = (lab.topology?.nodes || []).filter((n) => n && n.intent === 'bind');

  const servers: ServerStatistics[] = [];
  for (const node of bindNodes) {
    const containerName = 'clab-' + lab.topology.name + '-' + node.name;
    const base: ServerStatistics = {
      serverId: node.name,
      nodeName: node.name,
      containerName,
      present: false,
    };

    // Dump then cat, trying both known stats paths. One node's failure must
    // not blank the others, so each node gets its own try and its own exec.
    const command =
      `docker exec ${shellQuote(containerName)} sh -c ` +
      `'rndc stats >/dev/null 2>&1; cat /var/bind/named.stats 2>/dev/null || cat /var/cache/bind/named.stats 2>/dev/null'`;

    try {
      const res = await run(command);
      if (res.code === 0 && res.stdout && res.stdout.trim().length > 0) {
        servers.push({ ...base, ...parseNamedStats(res.stdout), present: true });
      } else {
        servers.push(base);
      }
    } catch {
      servers.push(base);
    }
  }

  return { servers, at };
}
