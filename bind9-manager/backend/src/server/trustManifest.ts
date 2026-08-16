import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface Manifest {
  node: string;
  deployJobId: string;
  generatedAt: string;
  files: Record<string, string>; // relpath -> sha256 hex
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/** Build a manifest over a node's pushed file set: each file value is its sha256. */
export function buildManifest(input: {
  node: string;
  deployJobId: string;
  generatedAt: string;
  files: Record<string, string>;
}): Manifest {
  const files: Record<string, string> = {};
  for (const [relPath, content] of Object.entries(input.files)) {
    files[relPath] = sha256(content);
  }
  return { node: input.node, deployJobId: input.deployJobId, generatedAt: input.generatedAt, files };
}

/** Deterministic JSON (sorted keys) so the HMAC is stable across serializations. */
export function canonicalManifest(m: Manifest): string {
  const sortedFiles: Record<string, string> = {};
  for (const k of Object.keys(m.files).sort()) {
    sortedFiles[k] = m.files[k];
  }
  return JSON.stringify({
    node: m.node,
    deployJobId: m.deployJobId,
    generatedAt: m.generatedAt,
    files: sortedFiles,
  });
}

export function signManifest(secret: string, m: Manifest): string {
  return createHmac('sha256', Buffer.from(secret, 'base64')).update(canonicalManifest(m)).digest('hex');
}

/**
 * Verify a signed manifest against the files actually on the node. Hashes
 * drift first (files changed out-of-band), then the signature (not produced
 * by this Manager's current key).
 */
export function verifyManifest(
  secret: string,
  signed: { manifest: Manifest; signature: string },
  actualFiles: Record<string, string>,
): { ok: true } | { ok: false; reason: 'CONFIG_DRIFT' | 'UNTRUSTED_MANIFEST' } {
  const manifestKeys = Object.keys(signed.manifest.files).sort();
  const actualKeys = Object.keys(actualFiles).sort();
  if (manifestKeys.length !== actualKeys.length || manifestKeys.some((k, i) => k !== actualKeys[i])) {
    return { ok: false, reason: 'CONFIG_DRIFT' };
  }
  for (const [relPath, content] of Object.entries(actualFiles)) {
    if (sha256(content) !== signed.manifest.files[relPath]) {
      return { ok: false, reason: 'CONFIG_DRIFT' };
    }
  }

  const expected = signManifest(secret, signed.manifest);
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(signed.signature, 'hex');
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    return { ok: false, reason: 'UNTRUSTED_MANIFEST' };
  }
  return { ok: true };
}
