import { FingerprintSchema } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { fingerprintKey, fingerprintOf, KEY_PREFIX } from './fingerprint.js';

describe('fingerprints', () => {
  it('keys each structure fix type as ENGINE-GAP §5 names it', () => {
    expect(KEY_PREFIX).toEqual({
      orphan_pages: 'orphan',
      deep_pages: 'depth',
      generic_anchor_text: 'anchors',
      redirect_chain: 'redirect',
      duplicate_pagination: 'pagination',
      canonical_mismatch: 'canonical',
      hreflang_gap: 'hreflang',
    });
    expect(fingerprintKey('orphan_pages', 'https://a.test/x')).toBe('orphan:https://a.test/x');
  });

  it('is the first 16 hex characters of the SHA-256 of the key', () => {
    // Independently computed: printf 'orphan:https://a.test/x' | sha256sum | cut -c1-16
    expect(fingerprintOf('orphan:https://a.test/x')).toBe('b4c1fc635c58fc4b');
  });

  it('is valid under the contract and differs when the type or the subject differs', () => {
    const keys = [
      fingerprintKey('orphan_pages', 'https://a.test/x'),
      fingerprintKey('deep_pages', 'https://a.test/x'),
      fingerprintKey('orphan_pages', 'https://a.test/y'),
    ];
    const prints = keys.map(fingerprintOf);
    for (const p of prints) expect(FingerprintSchema.safeParse(p).success).toBe(true);
    expect(new Set(prints).size).toBe(3);
    expect(fingerprintOf(keys[0]!)).toBe(prints[0]);
  });
});
