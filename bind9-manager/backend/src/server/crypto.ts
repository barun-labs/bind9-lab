import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

/**
 * Hash a password using scrypt with a random 16-byte hex salt.
 */
export function hashPassword(pw: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(pw, Buffer.from(salt, 'hex'), 64).toString('hex');
  return { salt, hash };
}

/**
 * Verify a password against a salt and hash using timing-safe comparison.
 * Never use `===` on digests.
 */
export function verifyPassword(pw: string, salt: string, hash: string): boolean {
  try {
    const computed = scryptSync(pw, Buffer.from(salt, 'hex'), 64);
    const expected = Buffer.from(hash, 'hex');
    if (computed.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(computed, expected);
  } catch {
    return false;
  }
}

/**
 * Generate a cryptographically secure random 32-byte hex token.
 */
export function randomToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Return the hex-encoded SHA-256 digest of a string.
 */
export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
