import type { Lab } from './labStore';
import type { Runner } from './deployEngine';
import { shellQuote } from '../config-engine/shellQuote';

export const ALLOWED_QTYPES = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME', 'SOA', 'PTR', 'SRV', 'CAA', 'ANY'] as const;

export interface QueryInput {
  node: string;
  qname: string;
  qtype?: string;
  server?: string;
}

export interface QueryValidation {
  ok: boolean;
  code?: string;
  message?: string;
  qtype?: string;
}

export interface QueryResult {
  node: string;
  containerName: string;
  qname: string;
  qtype: string;
  server?: string;
  output: string;
  exitCode: number;
}

const NAME_RE = /^[A-Za-z0-9._-]+$/;
const IPV4_RE = /^[0-9]{1,3}(\.[0-9]{1,3}){3}$/;
const IPV6_RE = /^[0-9A-Fa-f:]+$/;

/**
 * Pure validation. Every request field ends up in a `dig`/`docker exec`
 * argument, so each is rejected before it can reach the shell. Returns
 * {ok:false, code, message} on the FIRST failure, else {ok:true, qtype}
 * with the upper-cased (or defaulted) qtype.
 */
export function validateQuery(input: QueryInput, bindNodeNames: string[]): QueryValidation {
  if (!input || typeof input.node !== 'string' || input.node.length === 0) {
    return { ok: false, code: 'INVALID_NODE', message: 'node is required' };
  }
  if (!bindNodeNames.includes(input.node)) {
    return { ok: false, code: 'INVALID_NODE', message: `node '${input.node}' is not a bind node in this lab` };
  }

  const qname = typeof input.qname === 'string' ? input.qname : '';
  const hasEmptyLabel = qname.split('.').some((label) => label === '');
  // A leading '-' would be parsed by dig as an option (-x reverse, -b source,
  // -p port, ...), so reject it even though it passes the charset regex.
  if (qname.length === 0 || qname.length > 253 || !NAME_RE.test(qname) || hasEmptyLabel || qname.startsWith('-')) {
    return {
      ok: false,
      code: 'INVALID_NAME',
      message: 'qname must match ^[A-Za-z0-9._-]+$ with no empty labels, not start with "-", and be at most 253 characters',
    };
  }

  const rawQtype = typeof input.qtype === 'string' ? input.qtype.trim() : '';
  const qtype = rawQtype === '' ? 'A' : rawQtype.toUpperCase();
  if (!(ALLOWED_QTYPES as readonly string[]).includes(qtype)) {
    return {
      ok: false,
      code: 'INVALID_TYPE',
      message: `qtype must be one of ${ALLOWED_QTYPES.join(' ')}`,
    };
  }

  if (input.server !== undefined && input.server !== null && String(input.server) !== '') {
    const server = String(input.server);
    if (!IPV4_RE.test(server) && !IPV6_RE.test(server)) {
      return {
        ok: false,
        code: 'INVALID_SERVER',
        message: 'server must be an IPv4 address or a bare IPv6 address',
      };
    }
  }

  return { ok: true, qtype };
}

/**
 * Run `dig` inside the lab's bind-node container. The caller has already
 * validated the input; the container name is derived server-side from the
 * lab topology, and every interpolated value is shell-quoted regardless —
 * defense in depth so a value that slips past validation still cannot be
 * executed bare.
 */
export async function runQuery(lab: Lab, run: Runner, input: QueryInput): Promise<QueryResult> {
  const containerName = 'clab-' + lab.topology.name + '-' + input.node;
  const qname = String(input.qname);
  const qtype = input.qtype ? String(input.qtype).toUpperCase() : 'A';
  const server = input.server ? String(input.server) : undefined;

  const args = [
    'docker', 'exec', shellQuote(containerName), 'dig',
    '+time=3', '+tries=1',
    shellQuote(qtype), shellQuote(qname),
  ];
  if (server) {
    args.push('@' + shellQuote(server));
  }
  const command = args.join(' ');

  const res = await run(command);

  const result: QueryResult = {
    node: input.node,
    containerName,
    qname,
    qtype,
    output: (res.stdout ?? '') + (res.stderr ?? ''),
    exitCode: res.code,
  };
  if (server) {
    result.server = server;
  }
  return result;
}
