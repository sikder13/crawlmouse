import { describe, it, expect } from 'vitest';
import { buildExcerpt } from './excerpt.js';
import { EXCERPT_MAX_BYTES } from './constants.js';

describe('buildExcerpt (§4.4)', () => {
  it('returns short text unchanged', () => {
    expect(buildExcerpt('hello world')).toBe('hello world');
  });

  it('truncates at a word boundary at the cap, never mid-word', () => {
    const long = 'lorem ipsum '.repeat(400).trim(); // ~4800 chars > cap
    const ex = buildExcerpt(long);
    expect(Buffer.byteLength(ex, 'utf8')).toBeLessThanOrEqual(EXCERPT_MAX_BYTES);
    // last token is a WHOLE word (no partial slice)
    expect(['lorem', 'ipsum']).toContain(ex.split(' ').pop());
    expect(ex).not.toMatch(/\s$/); // trailing whitespace trimmed
  });

  it('never emits a raw-HTML slice (the caller passes .text() output; no angle brackets survive)', () => {
    expect(buildExcerpt('safe text with no markup')).not.toContain('<');
  });

  it('is deterministic', () => {
    const t = 'word '.repeat(1000).trim();
    expect(buildExcerpt(t)).toBe(buildExcerpt(t));
  });
});

describe('buildExcerpt — the word-boundary trim fires ONLY on truncation', () => {
  const DEL = '\u007f';
  const LONE_HIGH = '\ud800';

  it('KEEPS the trailing word when sanitisation merely rewrote the text', () => {
    // The regression: `cut === text` was false whenever sanitisation REWROTE anything, so one
    // stripped control anywhere made the trim fire at full length and eat the last word — on the FREE
    // homepage view, which is the conversion surface.
    expect(buildExcerpt(`hello${DEL} world`)).toBe('hello world');
    expect(buildExcerpt(`alpha beta ${LONE_HIGH}gamma`)).toBe('alpha beta \ufffdgamma');
    expect(buildExcerpt(`a${DEL}b${DEL}c tail`)).toBe('abc tail');
  });

  it('STILL trims at a word boundary when the text genuinely exceeds the budget', () => {
    const long = `${'word '.repeat(600)}FINAL`;
    const out = buildExcerpt(long);
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(EXCERPT_MAX_BYTES);
    expect(out.endsWith(' ')).toBe(false);
    expect(out).not.toContain('FINAL'); // genuinely truncated, not merely rewritten
  });

  it('trims on truncation even when the cut lands short of the budget (multi-byte boundary)', () => {
    // A CJK cut stops at 1998 bytes when the next char needs three, so a length-vs-budget test would
    // wrongly report "not truncated". The detector must not depend on hitting the budget exactly.
    const out = buildExcerpt('中'.repeat(5000));
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(EXCERPT_MAX_BYTES);
    expect(out.length).toBeLessThan(5000);
  });
});
