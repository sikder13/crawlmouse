import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashToken, isToken, newToken } from './tokens';

describe('account link tokens', () => {
  it('makes 43-character base64url tokens that differ each time', () => {
    const a = newToken();
    const b = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(isToken(a)).toBe(true);
  });

  it('refuses anything that is not a token before it reaches the database', () => {
    for (const v of [
      '',
      'x'.repeat(42),
      'x'.repeat(44),
      `${'x'.repeat(42)}=`,
      `${'x'.repeat(42)}/`,
      42,
      null,
    ]) {
      expect(isToken(v)).toBe(false);
    }
  });

  it('stores the sha256 of the token, as lowercase hex', () => {
    // Independent truth: the digest of a fixed string, computed here rather than by the helper.
    const known = createHash('sha256').update('abc').digest('hex');
    expect(known).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hashToken('abc')).toBe(known);
    expect(hashToken(newToken())).toMatch(/^[0-9a-f]{64}$/);
  });
});
