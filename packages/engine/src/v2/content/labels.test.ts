/**
 * The content checks against labels on real pages from the production audit corpus
 * (fixtures/v2/content/labels.json: features only; the excerpts the labels were made from are kept
 * outside the repository). The labels were made by the session that implemented the checks, from a
 * machine-made text view of each saved page, against the criteria the file carries; they are not an
 * independent person's. A check fires when it judges a page `fail`. Precision is the share of its
 * firings labelled `fail`; pass accuracy the share of its passes labelled `pass`. Pages labelled
 * `unsure`, and pages not labelled for the check, are left out.
 *
 * The counts are pinned: as labelled now, as first read before the recorded corrections, and for the
 * rule variants measured and not kept. The features were read with the reader whose digest the file
 * records, and the digest is checked, so a change to the reader fails here until the features are
 * regenerated (generate.ts) and the counts re-pinned. A check Quotable counts must clear the bar in
 * label-set.ts.
 */
import type { ContentCheck } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import labels from '../../../fixtures/v2/content/labels.json' with { type: 'json' };
import { readerDigest } from '../../../fixtures/v2/grade/guard.js';
import { CONTENT_CHECKS } from './checks.js';
import {
  lowerBound,
  MIN_PASS_ACCURACY,
  MIN_PRECISION,
  rulingTallies,
  tallies,
  validated,
  variantTallies,
  type Tally,
} from './label-set.js';

const CHECKS = Object.keys(CONTENT_CHECKS) as ContentCheck[];
const T = (
  labelled: number,
  applies: number,
  failing: number,
  fires: number,
  confirmed: number,
  passes: number,
  passes_confirmed: number,
): Tally => ({ labelled, applies, failing, fires, confirmed, passes, passes_confirmed });

describe('the content checks on the labelled pages', () => {
  const t = tallies();

  it('the features were read with the reader as it is now', () => {
    expect(labels.reader_sha256, 'regenerate labels.json with generate.ts').toBe(readerDigest());
  });

  it('the label set: 141 pages, the counts per check as labelled now', () => {
    expect(labels.pages).toHaveLength(141);
    expect(t).toEqual({
      direct_answer_150: T(109, 81, 11, 0, 0, 63, 51),
      question_headings: T(107, 55, 31, 21, 20, 23, 22),
      schema_with_description: T(113, 81, 17, 16, 16, 67, 64),
      author_and_date: T(141, 63, 2, 2, 2, 61, 61),
      specs_as_text: T(113, 26, 0, 0, 0, 28, 26),
    });
  });

  it('the counts as first read, before the 11 recorded corrections', () => {
    expect(labels.pages.flatMap((p) => p.corrections)).toHaveLength(11);
    expect(tallies(true)).toEqual({
      direct_answer_150: T(109, 81, 11, 0, 0, 63, 51),
      question_headings: T(112, 60, 36, 20, 19, 27, 21),
      schema_with_description: T(113, 80, 16, 16, 15, 67, 64),
      author_and_date: T(141, 63, 3, 2, 2, 61, 60),
      specs_as_text: T(113, 26, 0, 0, 0, 28, 26),
    });
  });

  it('the rule variants measured and not kept, on the labels as they stand', () => {
    expect(variantTallies()).toEqual({
      section_questions: T(107, 55, 31, 23, 21, 21, 21),
      schema_on_shell: T(113, 81, 17, 18, 16, 67, 64),
    });
  });

  it('the open ruling, counted both ways: question_headings clears the bar only if a call to action is a content heading', () => {
    const r = rulingTallies();
    expect(r).toEqual({
      cta_is_content: T(113, 61, 31, 21, 20, 27, 26),
      cta_is_not: T(113, 61, 37, 21, 20, 27, 22),
    });
    expect([validated(r.cta_is_content), validated(r.cta_is_not)]).toEqual([true, false]);
  });

  it.each(CHECKS)(
    '%s: held, with its reason, exactly when it clears the bar and is not counted',
    (check) => {
      const d = CONTENT_CHECKS[check];
      expect(d.held !== null).toBe(validated(t[check]) && !d.scored);
    },
  );

  it.each(CHECKS.filter((c) => CONTENT_CHECKS[c].scored))(
    `%s counts in Quotable, so it fires, passes, and is right on ${MIN_PRECISION * 100} % and ${MIN_PASS_ACCURACY * 100} % of each`,
    (check) => {
      expect(validated(t[check])).toBe(true);
    },
  );

  it('the bar: a check that never fires or never passes, or falls under either share, is not validated', () => {
    const ok = T(40, 40, 20, 20, 19, 20, 19);
    expect(validated(ok)).toBe(true);
    expect(validated({ ...ok, fires: 0, confirmed: 0 })).toBe(false);
    expect(validated({ ...ok, passes: 0, passes_confirmed: 0 })).toBe(false);
    expect(validated({ ...ok, confirmed: 18 })).toBe(false); // 18/20 = 0.90
    expect(validated({ ...ok, passes_confirmed: 18 })).toBe(false);
  });

  it('the exact one-sided 95 % lower bound: 2 of 2 is 0.05^(1/2) = 0.2236; 0 of n is 0; no trials, none', () => {
    expect(lowerBound(2, 2)).toBeCloseTo(Math.sqrt(0.05), 10);
    expect(lowerBound(0, 7)).toBe(0);
    expect(lowerBound(0, 0)).toBe(null);
    // 1 of 2: P(X ≥ 1) = 1 − (1 − p)² = 0.05, so p = 1 − √0.95 = 0.02532
    expect(lowerBound(1, 2)).toBeCloseTo(1 - Math.sqrt(0.95), 8);
  });

  it('every page carries a URL, a fetch date, the hash of its excerpt, and a reason for each label', () => {
    for (const p of labels.pages) {
      expect(p.url).toMatch(/^https:\/\//);
      expect(Date.parse(p.fetched_at)).not.toBeNaN();
      expect(p.excerpt_sha256).toMatch(/^[0-9a-f]{64}$/);
      for (const l of Object.values(p.labels)) expect(l.reason.length).toBeGreaterThan(0);
    }
  });

  it('every correction names its check, first label and reason, the label it became, and a known cause', () => {
    for (const p of labels.pages) {
      for (const c of p.corrections) {
        expect(c.check in p.labels).toBe(true);
        expect(p.labels[c.check as keyof typeof p.labels]!.label).toBe(c.to);
        expect(c.from.label).not.toBe(c.to);
        expect(c.from.reason.length).toBeGreaterThan(0);
        expect(Object.keys(labels.causes)).toContain(c.cause);
      }
    }
  });

  it('the six pages whose question headings are all calls to action are unsure for question_headings', () => {
    const cta = labels.pages.flatMap((p) =>
      p.corrections.filter((c) => c.cause === 'criteria_silent_on_cta').map((c) => ({ p, c })),
    );
    expect(cta).toHaveLength(6);
    // the first reading went both ways on them
    expect(cta.map(({ c }) => c.from.label).sort()).toEqual([
      'fail',
      'fail',
      'fail',
      'fail',
      'pass',
      'pass',
    ]);
    for (const { p } of cta) expect(p.labels.question_headings!.label).toBe('unsure');
  });
});

describe("a check's confidence", () => {
  it.each(CHECKS)(
    '%s: likely when it counts in Quotable, inconclusive when it does not',
    (check) => {
      const d = CONTENT_CHECKS[check];
      expect(d.confidence).toBe(d.scored ? 'likely' : 'inconclusive');
    },
  );
});
