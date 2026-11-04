/**
 * The content checks against labels on real pages from the production audit corpus
 * (fixtures/v2/content/labels.json: features only; the excerpts the labels were made from are kept
 * outside the repository). The labels were made by the session that implemented the checks, from a
 * machine-made text view of each saved page, against the criteria the file carries; they are not an
 * independent person's. A check fires when it judges a page `fail`. Precision is the share of its
 * firings labelled `fail`; pass accuracy the share of its passes labelled `pass`. Pages labelled
 * `unsure` are left out.
 *
 * The counts are pinned, both as labelled now and as first read before the recorded corrections. The
 * features were read with the reader whose digest the file records, and the digest is checked, so a
 * change to the reader fails here until the features are regenerated (generate.ts) and the counts
 * re-pinned. A check Quotable counts must fire, pass, and be right on at least 95 % of each.
 */
import type { ContentCheck } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import labels from '../../../fixtures/v2/content/labels.json' with { type: 'json' };
import { readerDigest } from '../../../fixtures/v2/grade/guard.js';
import { CONTENT_CHECKS } from './checks.js';
import { MIN_PASS_ACCURACY, MIN_PRECISION, tallies, validated, type Tally } from './label-set.js';

const CHECKS = Object.keys(CONTENT_CHECKS) as ContentCheck[];

describe('the content checks on the labelled pages', () => {
  const t = tallies();

  it('the features were read with the reader as it is now', () => {
    expect(labels.reader_sha256, 'regenerate labels.json with generate.ts').toBe(readerDigest());
  });

  it('the label set: 141 pages, the counts per check as labelled now', () => {
    expect(labels.pages).toHaveLength(141);
    expect(t).toEqual({
      direct_answer_150: {
        labelled: 109,
        failing: 11,
        fires: 0,
        confirmed: 0,
        passes: 63,
        passes_confirmed: 51,
      },
      question_headings: {
        labelled: 113,
        failing: 31,
        fires: 21,
        confirmed: 20,
        passes: 27,
        passes_confirmed: 26,
      },
      schema_with_description: {
        labelled: 113,
        failing: 17,
        fires: 16,
        confirmed: 16,
        passes: 67,
        passes_confirmed: 64,
      },
      author_and_date: {
        labelled: 141,
        failing: 2,
        fires: 2,
        confirmed: 2,
        passes: 61,
        passes_confirmed: 61,
      },
      specs_as_text: {
        labelled: 113,
        failing: 0,
        fires: 0,
        confirmed: 0,
        passes: 28,
        passes_confirmed: 26,
      },
    } satisfies Record<ContentCheck, Tally>);
  });

  it('the counts as first read, before the 9 recorded corrections', () => {
    expect(labels.pages.flatMap((p) => p.corrections)).toHaveLength(9);
    expect(tallies(true)).toEqual({
      direct_answer_150: {
        labelled: 109,
        failing: 11,
        fires: 0,
        confirmed: 0,
        passes: 63,
        passes_confirmed: 51,
      },
      question_headings: {
        labelled: 112,
        failing: 36,
        fires: 20,
        confirmed: 19,
        passes: 27,
        passes_confirmed: 21,
      },
      schema_with_description: {
        labelled: 113,
        failing: 16,
        fires: 16,
        confirmed: 15,
        passes: 67,
        passes_confirmed: 64,
      },
      author_and_date: {
        labelled: 141,
        failing: 3,
        fires: 2,
        confirmed: 2,
        passes: 61,
        passes_confirmed: 60,
      },
      specs_as_text: {
        labelled: 113,
        failing: 0,
        fires: 0,
        confirmed: 0,
        passes: 28,
        passes_confirmed: 26,
      },
    } satisfies Record<ContentCheck, Tally>);
  });

  it.each(CHECKS.filter((c) => CONTENT_CHECKS[c].scored))(
    `%s counts in Quotable, so it fires, passes, and is right on ${MIN_PRECISION * 100} % and ${MIN_PASS_ACCURACY * 100} % of each`,
    (check) => {
      expect(validated(t[check])).toBe(true);
    },
  );

  it('the bar: a check that never fires or never passes, or falls under either share, is not validated', () => {
    const ok: Tally = {
      labelled: 40,
      failing: 20,
      fires: 20,
      confirmed: 19,
      passes: 20,
      passes_confirmed: 19,
    };
    expect(validated(ok)).toBe(true);
    expect(validated({ ...ok, fires: 0, confirmed: 0 })).toBe(false);
    expect(validated({ ...ok, passes: 0, passes_confirmed: 0 })).toBe(false);
    expect(validated({ ...ok, confirmed: 18 })).toBe(false); // 18/20 = 0.90
    expect(validated({ ...ok, passes_confirmed: 18 })).toBe(false);
  });

  it('every page carries a URL, a fetch date, the hash of its excerpt, and a reason for each label', () => {
    for (const p of labels.pages) {
      expect(p.url).toMatch(/^https:\/\//);
      expect(Date.parse(p.fetched_at)).not.toBeNaN();
      expect(p.excerpt_sha256).toMatch(/^[0-9a-f]{64}$/);
      for (const l of Object.values(p.labels)) expect(l.reason.length).toBeGreaterThan(0);
    }
  });

  it('every correction names its check, its first label and reason, the label it became, and a known cause', () => {
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
});
