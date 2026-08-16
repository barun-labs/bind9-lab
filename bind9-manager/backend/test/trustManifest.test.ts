import { describe, it, expect } from 'vitest';
import { buildManifest, canonicalManifest, signManifest, verifyManifest } from '../src/server/trustManifest';

describe('trustManifest', () => {
  const secret = 'c2VjcmV0LXRydXN0LWtleS0wMDE='; // base64("secret-trust-key-001")
  const otherSecret = 'c2VjcmV0LXRydXN0LWtleS0wMDI='; // base64("secret-trust-key-002")

  const files = {
    'named.conf': 'options { directory "/etc/bind"; };',
    'zones/db.example': '$ORIGIN example.\n@ IN SOA ns1.example. root.example. 1 3600 600 86400 3600\n',
  };

  it('signs a manifest and verifies it with the same secret', () => {
    const manifest = buildManifest({
      node: 'ns1',
      deployJobId: 'csdj-abc123',
      generatedAt: '2026-08-16T00:00:00.000Z',
      files,
    });
    const signature = signManifest(secret, manifest);
    expect(verifyManifest(secret, { manifest, signature }, files)).toEqual({ ok: true });
  });

  it('rejects a manifest verified under a different secret (MUST-FAIL CONTROL)', () => {
    const manifest = buildManifest({
      node: 'ns1',
      deployJobId: 'csdj-abc123',
      generatedAt: '2026-08-16T00:00:00.000Z',
      files,
    });
    const signature = signManifest(secret, manifest);
    expect(verifyManifest(otherSecret, { manifest, signature }, files)).toEqual({
      ok: false,
      reason: 'UNTRUSTED_MANIFEST',
    });
  });

  it('reports CONFIG_DRIFT when a pushed file changed out-of-band', () => {
    const manifest = buildManifest({
      node: 'ns1',
      deployJobId: 'csdj-abc123',
      generatedAt: '2026-08-16T00:00:00.000Z',
      files,
    });
    const signature = signManifest(secret, manifest);
    const tampered = { ...files, 'named.conf': 'options { directory "/var/cache/bind"; };' };
    expect(verifyManifest(secret, { manifest, signature }, tampered)).toEqual({
      ok: false,
      reason: 'CONFIG_DRIFT',
    });
  });

  it('reports CONFIG_DRIFT when a file is added or removed', () => {
    const manifest = buildManifest({
      node: 'ns1',
      deployJobId: 'csdj-abc123',
      generatedAt: '2026-08-16T00:00:00.000Z',
      files,
    });
    const signature = signManifest(secret, manifest);
    const withExtra = { ...files, 'zones/extra.db': 'stray' };
    expect(verifyManifest(secret, { manifest, signature }, withExtra)).toEqual({
      ok: false,
      reason: 'CONFIG_DRIFT',
    });
  });

  it('canonicalManifest is order-independent so the HMAC is stable', () => {
    const a = buildManifest({ node: 'ns1', deployJobId: 'j', generatedAt: 't', files });
    const b = buildManifest({
      node: 'ns1',
      deployJobId: 'j',
      generatedAt: 't',
      files: Object.fromEntries(Object.entries(files).reverse()),
    });
    expect(canonicalManifest(a)).toBe(canonicalManifest(b));
    expect(signManifest(secret, a)).toBe(signManifest(secret, b));
  });
});
