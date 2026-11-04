/**
 * The content checks against a person's labels on real pages from the production audit corpus
 * (fixtures/v2/content/labels.json: features only; the excerpts the labels were made from are kept
 * outside the repository). A check fires when it judges a page `fail`. Precision is the share of its
 * firings the person also judged `fail`: a firing on a page the person judged `pass`, or judged the
 * check not to apply to, is a false alarm. Pages the person marked `unsure` are left out.
 *
 * The counts are pinned, so a change to a rule or the reader shows here; every check that fires at
 * all must keep a precision of at least 95 %. A check that never fires has no precision to measure:
 * the counts say so rather than a ratio.
 */
import type { ContentCheck } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import labels from '../../../fixtures/v2/content/labels.json' with { type: 'json' };
import { MIN_PRECISION, tallies } from './label-set.js';

describe('the content checks on the labelled pages', () => {
  const t = tallies();

  it('the label set: 141 pages, the counts per check as measured', () => {
    expect(labels.pages).toHaveLength(141);
    expect(t).toEqual({
      direct_answer_150: { labelled: 109, failing: 11, fires: 0, confirmed: 0 },
      question_headings: { labelled: 113, failing: 31, fires: 20, confirmed: 19 },
      schema_with_description: { labelled: 113, failing: 17, fires: 16, confirmed: 16 },
      author_and_date: { labelled: 141, failing: 2, fires: 2, confirmed: 2 },
      specs_as_text: { labelled: 113, failing: 0, fires: 0, confirmed: 0 },
    });
  });

  it.each(Object.keys(t) as ContentCheck[])(
    `%s: every firing is at least ${MIN_PRECISION * 100} % right, or it does not fire`,
    (check) => {
      const { fires, confirmed } = t[check];
      if (fires > 0) expect(confirmed / fires).toBeGreaterThanOrEqual(MIN_PRECISION);
    },
  );

  it('every page carries a URL, a fetch date and the hash of the excerpt its labels were made from', () => {
    for (const p of labels.pages) {
      expect(p.url).toMatch(/^https:\/\//);
      expect(Date.parse(p.fetched_at)).not.toBeNaN();
      expect(p.excerpt_sha256).toMatch(/^[0-9a-f]{64}$/);
      for (const l of Object.values(p.labels)) expect(l.reason.length).toBeGreaterThan(0);
    }
  });
});
