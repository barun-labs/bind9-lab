import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, randomToken, sha256 } from '../src/server/crypto';

describe('crypto adversarial', () => {
  describe('verifyPassword timing-safety / no-throw guarantees', () => {
    it('never throws on a length-mismatched digest (naive timingSafeEqual would)', () => {
      const { salt, hash } = hashPassword('correct-horse');

      // Every one of these is a length mismatch vs the real 64-byte digest.
      const badHashes = [
        '', // empty
        '0', // 1 nibble -> 0.5 bytes
        '00', // 1 byte
        'deadbeef', // 4 bytes
        '00'.repeat(32), // 32 bytes
        'ff'.repeat(63), // 63 bytes
        'ff'.repeat(65), // 65 bytes
        'ff'.repeat(128), // 64 bytes but never a real hash of this pw
      ];

      for (const h of badHashes) {
        // Must return false (never throw) even when lengths differ.
        expect(() => verifyPassword('correct-horse', salt, h)).not.toThrow();
        expect(verifyPassword('correct-horse', salt, h)).toBe(false);
      }

      // Sanity: real hash still verifies.
      expect(verifyPassword('correct-horse', salt, hash)).toBe(true);
    });

    it('returns false (no throw) on non-hex / garbage hash and garbage salt', () => {
      const { salt } = hashPassword('pw');
      expect(() => verifyPassword('pw', salt, 'not-hex-at-all!!')).not.toThrow();
      expect(verifyPassword('pw', salt, 'not-hex-at-all!!')).toBe(false);

      expect(() => verifyPassword('pw', '%%%garbage-salt%%%', 'ff'.repeat(64))).not.toThrow();
      expect(verifyPassword('pw', '%%%garbage-salt%%%', 'ff'.repeat(64))).toBe(false);
    });

    it('returns false for a valid-length digest with flipped content', () => {
      const { salt, hash } = hashPassword('pw');
      // Flip a nibble in the middle.
      const mutated = (hash[32] === '0' ? '1' : '0') + hash.slice(1);
      expect(mutated).toHaveLength(128);
      expect(verifyPassword('pw', salt, mutated)).toBe(false);
    });
  });

  describe('password edge cases', () => {
    it('round-trips empty password', () => {
      const { salt, hash } = hashPassword('');
      expect(verifyPassword('', salt, hash)).toBe(true);
      expect(verifyPassword('x', salt, hash)).toBe(false);
    });

    it('round-trips unicode and emoji password', () => {
      const pw = 'pässwörd-🔐-💥-日本語-パスワード';
      const { salt, hash } = hashPassword(pw);
      expect(verifyPassword(pw, salt, hash)).toBe(true);
      expect(verifyPassword(pw + 'x', salt, hash)).toBe(false);
    });

    it('round-trips a very long password (10k chars)', () => {
      const pw = 'A'.repeat(10_000);
      const { salt, hash } = hashPassword(pw);
      expect(verifyPassword(pw, salt, hash)).toBe(true);
      expect(verifyPassword(pw.slice(0, -1), salt, hash)).toBe(false);
    });

    it('scrypt cost does not depend on password length in a trivial way (still 64 bytes out)', () => {
      const short = hashPassword('a');
      const long = hashPassword('a'.repeat(10_000));
      expect(short.hash).toHaveLength(128);
      expect(long.hash).toHaveLength(128);
    });
  });

  describe('token + sha256 properties', () => {
    it('randomToken is uniformly hex and unique across a batch', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        const t = randomToken();
        expect(t).toMatch(/^[0-9a-f]{64}$/);
        expect(seen.has(t)).toBe(false);
        seen.add(t);
      }
    });

    it('sha256 of empty string is the well-known constant (garbage token resolves via it)', () => {
      expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('sha256 is collision-free for these adversarial inputs (distinct digests)', () => {
      const inputs = [
        'admin',
        "admin'; DROP TABLE users;--",
        'bnd_' + 'f'.repeat(64),
        '',
        'admin',
      ];
      const digests = inputs.map(sha256);
      expect(new Set(digests).size).toBe(inputs.length - 1); // only the duplicate 'admin' repeats
    });
  });
});
