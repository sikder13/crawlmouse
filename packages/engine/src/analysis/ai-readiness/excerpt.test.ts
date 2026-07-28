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
    expect(ex.length).toBeLessThanOrEqual(EXCERPT_MAX_BYTES);
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
