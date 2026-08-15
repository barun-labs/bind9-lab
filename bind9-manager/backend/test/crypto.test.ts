import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, randomToken, sha256 } from '../src/server/crypto';

describe('crypto', () => {
  it('hashes password and verifies successfully with correct password', () => {
    const password = 'SuperSecretPassword123!';
    const { salt, hash } = hashPassword(password);

    expect(salt).toBeDefined();
    expect(hash).toBeDefined();
    expect(typeof salt).toBe('string');
    expect(typeof hash).toBe('string');
    expect(salt.length).toBe(32); // 16 bytes = 32 hex chars
    expect(hash.length).toBe(128); // 64 bytes = 128 hex chars

    // Hash must not equal the plaintext password
    expect(hash).not.toBe(password);
    expect(salt).not.toBe(password);

    // Verification succeeds with correct password
    expect(verifyPassword(password, salt, hash)).toBe(true);

    // Verification fails with wrong password
    expect(verifyPassword('WrongPassword', salt, hash)).toBe(false);
    expect(verifyPassword('', salt, hash)).toBe(false);
  });

  it('generates different hashes and salts for the same password', () => {
    const password = 'identicalPassword';
    const res1 = hashPassword(password);
    const res2 = hashPassword(password);

    expect(res1.salt).not.toBe(res2.salt);
    expect(res1.hash).not.toBe(res2.hash);

    expect(verifyPassword(password, res1.salt, res1.hash)).toBe(true);
    expect(verifyPassword(password, res2.salt, res2.hash)).toBe(true);
    // Crossing salts/hashes fails
    expect(verifyPassword(password, res1.salt, res2.hash)).toBe(false);
  });

  it('verifyPassword safely handles malformed/corrupted digests without throwing', () => {
    const { salt } = hashPassword('test');
    expect(verifyPassword('test', salt, 'invalid-hex-short')).toBe(false);
    expect(verifyPassword('test', salt, '')).toBe(false);
    expect(verifyPassword('test', salt, '00'.repeat(32))).toBe(false); // 32 bytes instead of 64
  });

  it('randomToken returns unique 64 hex char strings', () => {
    const token1 = randomToken();
    const token2 = randomToken();

    expect(token1).toHaveLength(64); // 32 bytes = 64 hex chars
    expect(token2).toHaveLength(64);
    expect(token1).toMatch(/^[0-9a-f]{64}$/);
    expect(token1).not.toBe(token2);
  });

  it('sha256 computes correct deterministic hex digest', () => {
    const digest1 = sha256('hello-world');
    const digest2 = sha256('hello-world');
    const digest3 = sha256('different-input');

    expect(digest1).toBe(digest2);
    expect(digest1).toHaveLength(64);
    expect(digest1).toMatch(/^[0-9a-f]{64}$/);
    expect(digest1).not.toBe(digest3);
    // Known SHA-256 for 'hello-world'
    expect(digest1).toBe('afa27b44d43b02a9fea41d13cedc2e4016cfcf87c5dbf990e593669aa8ce286d');
  });
});
