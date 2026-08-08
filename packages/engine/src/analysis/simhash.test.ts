import { describe, it, expect } from 'vitest';
import {
  simhash64, simhashForDedup, hammingDistance, tokenizeForSimhash,
  SIMHASH_HAMMING_K, SIMHASH_MAX_TOKENS, SIMHASH_MIN_TOKENS,
} from './simhash.js';

/** A template page of realistic length — the regime k=3 is actually calibrated for. */
const templatePage = (product: string) =>
  `${product} is available now from our store. ` +
  Array.from({ length: 60 }, (_, i) => `shared boilerplate sentence number ${i} about shipping returns and warranty terms`).join(' ');

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a §5.4 — 64-bit SimHash over extracted main-content text, Hamming k=3.
//
// "Fixed, pinned tokenizer and hash — determinism depends on it, so do not rely on library defaults."
// Determinism here is not a nicety: the fingerprint (§6.7) and the duplicate collapsing both key off
// this, so a tokenizer that varied with locale or a hash that varied with Node build would put
// non-determinism directly into the grade.
// ─────────────────────────────────────────────────────────────────────────────

describe('§5.4 tokenizer — pinned, locale-independent', () => {
  it('lowercases, splits on non-alphanumerics, and drops one-character tokens', () => {
    expect(tokenizeForSimhash('The Quick, Brown fox! A b')).toEqual(['the', 'quick', 'brown', 'fox']);
  });

  it('keeps non-Latin scripts rather than discarding them', () => {
    // A tokenizer that only understood ASCII would reduce a Japanese page to zero tokens and make
    // every such page a duplicate of every other. \p{L} is what prevents that.
    expect(tokenizeForSimhash('日本語 テキスト').length).toBeGreaterThan(0);
    expect(tokenizeForSimhash('Привет мир')).toEqual(['привет', 'мир']);
  });

  it('normalises compatibility forms so visually identical text tokenises identically', () => {
    expect(tokenizeForSimhash('ﬁle')).toEqual(tokenizeForSimhash('file'));
  });

  it('is bounded, and the bound is a deterministic PREFIX rather than a sample', () => {
    const many = Array.from({ length: SIMHASH_MAX_TOKENS + 500 }, (_, i) => `w${i}`).join(' ');
    const toks = tokenizeForSimhash(many);
    expect(toks).toHaveLength(SIMHASH_MAX_TOKENS);
    expect(toks[0]).toBe('w0');
  });
});

describe('§5.4 simhash64 — deterministic and pinned', () => {
  it('returns a 16-hex-digit (64-bit) value', () => {
    expect(simhash64('the quick brown fox jumps over the lazy dog')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is stable across calls — the property the whole feature rests on', () => {
    const t = 'internal linking is the practice of connecting pages within one website';
    expect(simhash64(t)).toBe(simhash64(t));
  });

  it('is pinned against an independently computed value, not against its own output', () => {
    // Asserting only self-consistency would pass for ANY implementation, including a broken one. This
    // vector is computed from the specified construction (NFKC, lowercase, \p{L}\p{N} split, word
    // 3-shingles, sha256 first 8 bytes big-endian, per-bit majority) so a silent redefinition fails.
    // Value produced by a SEPARATE reimplementation written from the spec text alone, structured
    // differently (string bit buffer, manual big-endian byte assembly) so that agreement between the
    // two is evidence rather than a shared bug. Agreement is not correctness when both sides run the
    // same code — this is the vector where they do not.
    expect(simhash64('alpha beta gamma delta')).toBe('601084cba2a1a948');
  });

  it('collapses two template pages that differ only in the product name', () => {
    // THE REAL USE CASE: a CMS emitting one template per product, where the pages share almost all
    // their prose. This is what §5.4 exists to collapse, and it must be measured at document length —
    // see the length-regime test below for why a short vector proves nothing here.
    const d = hammingDistance(simhash64(templatePage('Blue Widget')), simhash64(templatePage('Red Gadget')));
    expect(d).toBeLessThanOrEqual(SIMHASH_HAMMING_K);
  });

  it('k=3 is only meaningful at document length — MEASURED, and the reason for the floor', () => {
    // A one-word edit on a 13-token document scores 7, well past k=3. That is not a defect in the
    // hash; it is the parameterisation being calibrated for web-scale documents. Pinning it here stops
    // anyone "fixing" it later by loosening k, which would start collapsing genuinely distinct pages.
    const shortA = 'internal linking connects the pages of a website so crawlers can reach them all';
    const shortB = 'internal linking connects the pages of a website so crawlers can reach them';
    expect(hammingDistance(simhash64(shortA), simhash64(shortB))).toBeGreaterThan(SIMHASH_HAMMING_K);
    // So short documents are excluded from dedup entirely rather than judged by a meaningless metric.
    expect(simhashForDedup(shortA)).toBeNull();
    expect(simhashForDedup(templatePage('Blue Widget'))).not.toBeNull();
  });

  it('the dedup floor is a token count, applied at exactly the documented boundary', () => {
    const justUnder = Array.from({ length: SIMHASH_MIN_TOKENS - 1 }, (_, i) => `w${i}x`).join(' ');
    const justOver = Array.from({ length: SIMHASH_MIN_TOKENS }, (_, i) => `w${i}x`).join(' ');
    expect(simhashForDedup(justUnder)).toBeNull();
    expect(simhashForDedup(justOver)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('gives unrelated text a large Hamming distance', () => {
    const a = 'internal linking connects the pages of a website so crawlers can reach them all';
    const b = 'sourdough needs a mature starter, a long autolyse and a very hot oven';
    expect(hammingDistance(simhash64(a), simhash64(b))).toBeGreaterThan(SIMHASH_HAMMING_K);
  });

  it('does NOT collapse two short but genuinely different pages', () => {
    // The conservative-bias case: a real contact page and a real about page are both short, and
    // collapsing them would delete a real page from the graph.
    const contact = 'contact us by email at hello example or call during office hours';
    const about = 'we are a small studio building tools for independent site owners';
    expect(hammingDistance(simhash64(contact), simhash64(about))).toBeGreaterThan(SIMHASH_HAMMING_K);
  });

  it('is order-sensitive, so shuffled text is not treated as the same document', () => {
    const a = 'the cat sat on the mat while the dog watched from the door';
    const b = 'the dog watched from the door while the cat sat on the mat';
    expect(simhash64(a)).not.toBe(simhash64(b));
  });

  it('handles empty and whitespace-only text without throwing', () => {
    expect(simhash64('')).toMatch(/^[0-9a-f]{16}$/);
    expect(simhash64('   \n\t ')).toBe(simhash64(''));
  });
});

describe('§5.4 hammingDistance', () => {
  it('is 0 for identical values and 64 for complements', () => {
    expect(hammingDistance('0000000000000000', '0000000000000000')).toBe(0);
    expect(hammingDistance('0000000000000000', 'ffffffffffffffff')).toBe(64);
  });

  it('counts single-bit differences exactly', () => {
    expect(hammingDistance('0000000000000000', '0000000000000001')).toBe(1);
    expect(hammingDistance('0000000000000000', '8000000000000000')).toBe(1);
    expect(hammingDistance('0000000000000000', '0000000100000001')).toBe(2);
  });

  it('is symmetric', () => {
    expect(hammingDistance('0f0f0f0f0f0f0f0f', 'f0f0f0f0f0f0f0f0'))
      .toBe(hammingDistance('f0f0f0f0f0f0f0f0', '0f0f0f0f0f0f0f0f'));
  });

  it('uses k=3, Google\'s validated web-scale parameterisation', () => {
    expect(SIMHASH_HAMMING_K).toBe(3);
  });
});
