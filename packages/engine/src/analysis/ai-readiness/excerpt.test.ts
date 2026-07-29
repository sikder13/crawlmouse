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

describe('buildExcerpt — the truncation probe needs a FULL code point of headroom', () => {
  it('detects truncation when the cut lands exactly on the budget', () => {
    // The probe asks whether N+4 bytes admit anything more; 4 is the max UTF-8 code-point width, so
    // any smaller headroom can miss a wider next character and skip the word-boundary trim, leaving a
    // mid-word fragment on the free homepage view. Reducing +4 to +1 previously left both suites green.
    const text = `${'word '.repeat(399)}ab${'中'.repeat(50)}`; // cut lands at exactly 2000 bytes
    const out = buildExcerpt(text);
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(EXCERPT_MAX_BYTES);
    expect(out.endsWith('中')).toBe(false);   // not a mid-word fragment
    expect(out.endsWith('ab')).toBe(false);
    expect(out.endsWith('word')).toBe(true);  // trimmed to the last whole word
  });

  it('…and the follower is ASTRAL, so the probe needs FOUR bytes and not three', () => {
    // The case above uses a 3-byte follower, so it pins `+4` no harder than `+3` — a fixture that
    // passes for a reason narrower than the rule it states. The emoji-dense page is the one
    // `excerpt.ts` cites in its own docstring, and it is where the last byte of headroom is load-bearing:
    // with an astral follower, `+1`/`+2`/`+3` all miss the truncation and return the mid-word fragment.
    const text = `${'word '.repeat(399)}abcde${'\u{1F600}'.repeat(50)}`; // cut lands at exactly 2000 bytes
    const out = buildExcerpt(text);
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(EXCERPT_MAX_BYTES);
    expect(out.endsWith('abcde'), 'truncation must not be missed').toBe(false);
    expect(out.endsWith('\u{1F600}')).toBe(false);
    expect(out.endsWith('word')).toBe(true);
  });
});
