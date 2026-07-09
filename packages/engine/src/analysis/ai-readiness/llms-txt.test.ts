import { describe, it, expect } from 'vitest';
import { parseLlmsTxt } from './llms-txt.js';

describe('parseLlmsTxt (§8 — informational, ZERO weight)', () => {
  it('present + parseable for a well-formed llms.txt (H1 + link list)', () => {
    const body = '# Example\n\n> A short summary.\n\n## Docs\n\n- [Guide](https://example.com/guide)\n- [API](https://example.com/api)\n';
    const s = parseLlmsTxt(200, body);
    expect(s.present).toBe(true);
    expect(s.parseable).toBe(true);
    expect(s.note).toMatch(/AI search engine/i);
  });

  it('present but NOT parseable for a non-markdown body', () => {
    const s = parseLlmsTxt(200, 'just some plain text with no heading and no links at all');
    expect(s.present).toBe(true);
    expect(s.parseable).toBe(false);
  });

  it('requires an H1 (a doc that is only H2 + links is not the llms.txt shape)', () => {
    expect(parseLlmsTxt(200, '## Docs\n- [Guide](https://example.com/guide)').parseable).toBe(false);
  });

  it('absent for a 404', () => {
    const s = parseLlmsTxt(404, 'not found');
    expect(s.present).toBe(false);
    expect(s.parseable).toBe(false);
  });

  it('absent for an empty 200 body', () => {
    expect(parseLlmsTxt(200, '   ').present).toBe(false);
  });

  it('bounds cost on a hostile body — no ReDoS on a huge run of "[" (§12)', () => {
    const hostile = '['.repeat(500_000); // an unbounded [text](url) regex backtracks O(n^2) → seconds
    const t0 = performance.now();
    const s = parseLlmsTxt(200, hostile);
    const ms = performance.now() - t0;
    expect(s.parseable).toBe(false);
    expect(ms).toBeLessThan(500); // bounded scan + bounded-quantifier regex → milliseconds
  });
});
