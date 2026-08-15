/// <reference types="node" />
import { spawn } from 'child_process';
import path from 'path';
import { shellQuote } from './shellQuote';

export type Runner = (bashScript: string) => Promise<{ code: number; stdout: string; stderr: string }>;

const defaultRunner: Runner = (bashScript: string) => {
  return new Promise((resolve) => {
    const p = spawn('bash', ['-s']);
    let stdout = '';
    let stderr = '';

    p.stdout.on('data', (d: Buffer | string) => {
      stdout += d.toString();
    });
    p.stderr.on('data', (d: Buffer | string) => {
      stderr += d.toString();
    });
    p.on('error', (err: Error) => {
      resolve({ code: 1, stdout, stderr: stderr || err.message });
    });
    p.on('close', (code: number | null) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });

    p.stdin.write(bashScript);
    p.stdin.end();
  });
};

export async function validateConfig(
  files: Record<string, string>,
  run: Runner = defaultRunner,
): Promise<{ ok: boolean; warnings: string[]; errors: string[] }> {
  const allFiles: Record<string, string> = { ...files };

  // 1. Ensure rndc.key stub is present if absent
  if (!allFiles['rndc.key']) {
    allFiles['rndc.key'] =
      'key "rndc-key" { algorithm hmac-sha256; secret "c3R1YmtleXN0dWJrZXlzdHVia2V5c3R1Yg=="; };\n';
  }

  // 2. Build ONE bash script that manages temp dir, writes files, and runs docker validation
  const scriptLines: string[] = [
    '#!/usr/bin/env bash',
    'PARENT_DIR="/tmp/bind-val-$(id -u)"',
    'mkdir -p "$PARENT_DIR" 2>/dev/null || PARENT_DIR="/tmp"',
    'TMPDIR=$(mktemp -d "$PARENT_DIR/val.XXXXXX" 2>/dev/null || mktemp -d)',
    'chmod 777 "$TMPDIR" 2>/dev/null || true',
    'cleanup() {',
    '  rm -rf "$TMPDIR" 2>/dev/null || true',
    '}',
    'trap cleanup EXIT',
    'STATUS=0',
  ];

  for (const [filePath, content] of Object.entries(allFiles)) {
    const dir = path.posix.dirname(filePath);
    if (dir && dir !== '.') {
      scriptLines.push(`mkdir -p "$TMPDIR"/${shellQuote(dir)}`);
    }
    const b64 = Buffer.from(content, 'utf-8').toString('base64');
    scriptLines.push(`echo '${b64}' | base64 -d > "$TMPDIR"/${shellQuote(filePath)}`);
  }

  // named-checkconf
  scriptLines.push(
    'docker run --rm -v "$TMPDIR":/etc/bind dnsnode:1.0 named-checkconf /etc/bind/named.conf || STATUS=1',
  );

  // named-checkzone for each zone file
  const zoneFiles = Object.keys(allFiles).filter((f) => f.startsWith('zones/db.'));
  for (const zf of zoneFiles) {
    const fileSuffix = zf.slice('zones/db.'.length);
    const zoneName = fileSuffix === 'root' ? '.' : fileSuffix;
    scriptLines.push(
      `docker run --rm -v "$TMPDIR":/etc/bind dnsnode:1.0 named-checkzone ${shellQuote(
        zoneName,
      )} ${shellQuote(`/etc/bind/${zf}`)} || STATUS=1`,
    );
  }

  scriptLines.push('exit $STATUS');

  const bashScript = scriptLines.join('\n') + '\n';

  // 3. Execute runner
  const { code, stdout, stderr } = await run(bashScript);

  // 4. Parse output
  const warnings: string[] = [];
  const errors: string[] = [];

  const rawLines = `${stdout}\n${stderr}`.split('\n');
  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;

    // Ignore normal checkzone success output
    if (/^zone\s+.+\/IN:\s+loaded serial\s+\d+$/i.test(line) || /^OK$/i.test(line)) {
      continue;
    }

    // Check for warnings
    if (
      /\bwarning\b/i.test(line) ||
      /\(out of zone\) has no addresses? records/i.test(line) ||
      /has no address records/i.test(line)
    ) {
      if (!/not loaded due to errors|failed:/i.test(line)) {
        warnings.push(line);
        continue;
      }
    }

    // Otherwise treat as error
    errors.push(line);
  }

  if (code !== 0 && errors.length === 0) {
    if (warnings.length > 0) {
      errors.push(...warnings);
      warnings.length = 0;
    } else {
      errors.push(`Validation failed with exit code ${code}`);
    }
  }

  return {
    ok: errors.length === 0,
    warnings,
    errors,
  };
}
