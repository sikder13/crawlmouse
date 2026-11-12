import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { hostileText, UNSHOWN } from '../packets/test-support/hostile.js';
import { MAX_TITLE_CHARS, TITLES, titleOf } from './outcomes.js';
import type { FixType } from '@crawlmouse/types/v2';

const TITLED = Object.keys(TITLES) as FixType[];

describe('titleOf', () => {
  it('leaves an ordinary subject as the title wrote it', () => {
    expect(titleOf('orphan_pages', 'https://a.test/x')).toBe(
      'Link to https://a.test/x from another page',
    );
  });

  it('cuts a title past its bound and marks the cut', () => {
    const title = titleOf('orphan_pages', `https://a.test/${'x'.repeat(400)}`);
    expect([...title]).toHaveLength(MAX_TITLE_CHARS + 1);
    expect(title.endsWith('…')).toBe(true);
  });

  it('is one line with nothing invisible in it, whatever the subject holds (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...TITLED), hostileText(), (type, subject) => {
        // a template title reads its subject as a template key, which starts with a slash
        const title = titleOf(type, `/${subject}`);
        expect(UNSHOWN.test(title)).toBe(false);
        expect([...title].length).toBeLessThanOrEqual(MAX_TITLE_CHARS + 1);
      }),
    );
  });
});
