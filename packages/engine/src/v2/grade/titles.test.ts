import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { hostileText, UNSHOWN } from '../packets/test-support/hostile.js';
import { blogSite } from '../../../fixtures/v2/grade/sites.js';
import { gradeCheck } from './index.js';
import { detectorOutcomes, MAX_TITLE_CHARS, NOTHING_WRITTEN, TITLES, titleOf } from './outcomes.js';
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

describe('the redirect_chain title (F-162)', () => {
  // A blog whose home page links to /old, which answers at /new/ after two redirects, and to /loop,
  // whose redirects come back round: a loop has no "where it redirects" to link to.
  const { input, access } = blogSite(
    2,
    0,
    {},
    [
      {
        path: '/old',
        facts: { final_url: 'https://a.test/new/', redirect: { hops: 2, loop: false } },
      },
      { path: '/loop', status: 301, facts: { redirect: { hops: 3, loop: true } } },
    ],
    ['/old', '/loop'],
  );
  const grades = gradeCheck(input);
  const { outcomes } = detectorOutcomes(grades, access, input.structure, [], NOTHING_WRITTEN);
  const titleAt = (path: string) => {
    const o = outcomes.find(
      (x) =>
        x.state === 'detected' && x.fix.type === 'redirect_chain' && x.fix.title.includes(path),
    );
    return o?.state === 'detected' ? o.fix.title : null;
  };

  it('names a loop as a loop to break, at the URL the links lead to', () => {
    expect(titleAt('/loop')).toBe('Break the redirect loop at https://a.test/loop');
  });

  it('keeps "Link straight to where … redirects" for a chain that ends', () => {
    expect(titleAt('/old')).toBe('Link straight to where https://a.test/old redirects');
  });

  it('chooses the loop title from the record’s condition, for any subject', () => {
    expect(titleOf('redirect_chain', 'https://a.test/x', ['redirect_loop'])).toBe(
      'Break the redirect loop at https://a.test/x',
    );
    expect(titleOf('redirect_chain', 'https://a.test/x', [])).toBe(
      'Link straight to where https://a.test/x redirects',
    );
  });
});
