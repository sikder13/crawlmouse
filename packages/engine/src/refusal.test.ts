import { describe, it, expect } from 'vitest';
import { decideRefusal, type RefusalEvidence } from './refusal.js';
import { MIN_GRADEABLE_PAGES } from './constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a Stage 4 — THE REFUSAL GATE.
//
// One gate, four categorical triggers. Every one is a fact about the EVIDENCE WE HOLD, never a
// judgement about the site — which is why none of them needs the 5.1b calibration panel. A site we
// could not read is not a bad site, and printing a letter implies we know which.
//
// Measured on the live corpus (212 completed audits, 2026-08-04): 39 too few pages, 4 nothing read,
// 34 zero observed edges, 22 high confidence on unknown coverage. 51 audits would lose their letter
// entirely; 64 (30.2%) change verdict once the confidence cap is included.
//
// THE SPLIT MATTERS. Three triggers withhold the LETTER — without pages, without a successful fetch or
// without an observed edge there is nothing to grade. The fourth does not: unknown coverage means we
// cannot claim to have seen enough of the site, which caps CONFIDENCE rather than erasing a
// measurement we genuinely made.
// ─────────────────────────────────────────────────────────────────────────────

/** A healthy audit: every trigger clear. Each test perturbs exactly one field. */
const HEALTHY: RefusalEvidence = {
  gradeablePageCount: 120,
  observedEdgeCount: 3400,
  fetchedOkCount: 130,
  // Σ`coverage.excluded` — pages the classifier removed from the graded population. REQUIRED: the
  // below-floor branch cannot tell "the site is small" from "we excluded most of it" without it, and
  // `gradeablePageCount + excludedPageCount` is the ONLY population the exclusion tally can account
  // for, which is what makes every number the copy prints reconcile.
  excludedPageCount: 10,
  estimateSource: 'sitemap',
  crawlTruncated: false,
};

describe('Stage 4 refusal gate — four categorical triggers', () => {
  it('grades a healthy audit, with no triggers and no caveat', () => {
    const d = decideRefusal(HEALTHY);
    expect(d.refused).toBe(false);
    expect(d.triggers).toEqual([]);
    expect(d.confidenceCapped).toBe(false);
    expect(d.unevaluable).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TWO SHAPES, ONE REFUSAL, DIFFERENT TRUTHS. Both fall below the floor, and saying the wrong one is
  // a falsehood in the honesty gate — the worst possible place for one.
  // ───────────────────────────────────────────────────────────────────────────
  it('says the SITE IS TOO SMALL when the crawl completed and still fell below the floor', () => {
    // A legitimate 3-page brochure, read in full. "We couldn't read enough of your site" would be
    // simply untrue: we read all of it. The measurement, not the evidence, is what is missing.
    //
    // The brochure excludes NOTHING, so its content-bearing population is its 3 graded pages and the
    // site really is small. Inheriting HEALTHY's exclusion count would describe a site whose pages we
    // removed — the exclusion shape — and calling that "too small" is the falsehood this gate exists
    // to prevent.
    const d = decideRefusal({
      ...HEALTHY,
      gradeablePageCount: MIN_GRADEABLE_PAGES - 2,
      excludedPageCount: 0,
      crawlTruncated: false,
    });
    expect(d.refused).toBe(true);
    expect(d.triggers).toContain('site_too_small_to_measure');
    expect(d.triggers).not.toContain('too_few_gradeable_pages');
  });

  it('says the EVIDENCE IS INSUFFICIENT when the crawl was truncated below the floor', () => {
    // A large site we barely reached. Here "we didn't read enough" is exactly right.
    const d = decideRefusal({ ...HEALTHY, gradeablePageCount: MIN_GRADEABLE_PAGES - 2, crawlTruncated: true });
    expect(d.refused).toBe(true);
    expect(d.triggers).toContain('too_few_gradeable_pages');
    expect(d.triggers).not.toContain('site_too_small_to_measure');
  });

  it('does NOT claim a site is small when truncation is unknown', () => {
    // The negative control on the split. An un-instrumented crawl never established that we saw the
    // whole site, so it takes the insufficient-evidence branch rather than asserting a fact about
    // the site's size that we never measured.
    const d = decideRefusal({ ...HEALTHY, gradeablePageCount: MIN_GRADEABLE_PAGES - 2, crawlTruncated: null });
    expect(d.triggers).toContain('too_few_gradeable_pages');
    expect(d.triggers).not.toContain('site_too_small_to_measure');
  });

  it('withholds the letter when NOTHING was successfully read', () => {
    // leetcode.com: 50 pages attempted, 50 blocked, 0 OK — and we printed C/60.00.
    const d = decideRefusal({ ...HEALTHY, fetchedOkCount: 0 });
    expect(d.refused).toBe(true);
    expect(d.triggers).toContain('nothing_read');
  });

  it('withholds the letter when no internal link was observed among graded pages', () => {
    // The 88.00 cluster: 34 audits, 30 at high confidence, 10 graded A/A−/B+/B — on an empty graph.
    const d = decideRefusal({ ...HEALTHY, observedEdgeCount: 0 });
    expect(d.refused).toBe(true);
    expect(d.triggers).toContain('no_observed_links');
  });

  it('keeps the letter but caps confidence when coverage is unknowable', () => {
    // Unknown coverage is not "no evidence" — it is a real measurement of an unknown fraction of the
    // site. Erasing the grade would overcorrect; claiming HIGH confidence in it is the actual defect.
    const d = decideRefusal({ ...HEALTHY, estimateSource: 'none' });
    expect(d.refused).toBe(false);
    expect(d.confidenceCapped).toBe(true);
    expect(d.triggers).toEqual([]);
  });

  it('reports EVERY trigger that fired, not just the first', () => {
    // A dead host trips several at once, and a user told only the first would fix it and still be
    // refused. The list is the explanation, so it has to be complete.
    const d = decideRefusal({
      gradeablePageCount: 0,
      observedEdgeCount: 0,
      fetchedOkCount: 0,
      excludedPageCount: 0,
      estimateSource: 'none',
      crawlTruncated: true,
    });
    expect(d.refused).toBe(true);
    // Sorted so the assertion does not depend on emission order. ('no_observed_links' precedes
    // 'nothing_read' because '_' sorts before 't'.)
    expect([...d.triggers].sort()).toEqual(['no_observed_links', 'nothing_read', 'too_few_gradeable_pages']);
    expect(d.confidenceCapped).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // UNKNOWN IS NOT ZERO. This is the same distinction the whole stage exists to make, and it is easy
  // to get wrong in exactly one direction: 6 of the 212 audits pre-date the crawl-health
  // instrumentation and carry a NULL fetched-OK count. Absent instrumentation is not evidence of a
  // dead host, and refusing there would repeat the conflation while looking like rigour.
  // ───────────────────────────────────────────────────────────────────────────
  it('does NOT refuse when the fetch count is UNKNOWN rather than zero', () => {
    const d = decideRefusal({ ...HEALTHY, fetchedOkCount: null });
    expect(d.triggers).not.toContain('nothing_read');
    expect(d.refused).toBe(false);
  });

  it('names the unknown as its own state instead of silently dropping it', () => {
    // Silence would be the third possible reading of the same value, and §9's whole complaint about
    // the 60.00 clamp is that one number meant three things with none of them surfaced.
    const d = decideRefusal({ ...HEALTHY, fetchedOkCount: null });
    expect(d.unevaluable).toContain('nothing_read');
  });

  it('still refuses on OTHER triggers while the fetch count is unknown', () => {
    // The negative control for the rule above: "unknown is not zero" must not become "unknown
    // suppresses every check", which would hand un-instrumented audits a free pass.
    const d = decideRefusal({ ...HEALTHY, fetchedOkCount: null, observedEdgeCount: 0 });
    expect(d.refused).toBe(true);
    expect(d.triggers).toEqual(['no_observed_links']);
    expect(d.unevaluable).toContain('nothing_read');
  });

  it('is a pure function of the evidence — same input, same decision', () => {
    expect(JSON.stringify(decideRefusal(HEALTHY))).toBe(JSON.stringify(decideRefusal(HEALTHY)));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE FIX — THE POPULATION THE FLOOR READS MUST BE ONE THE EXCLUSION TALLY CAN ACCOUNT FOR.
//
// The first attempt fed the gate `coverage.fetched`, which is "every URL fetched, ANY status" and
// includes non-200 and off-host pages. `coverage.excluded` is tallied only over same-host-200 pages.
// Two different populations, so the numbers did not reconcile, and a reviewer measured the
// consequence: a genuine 3-page brochure with 10 broken links reads fetched 13 / gradeable 3 /
// excluded [] and was routed to the exclusion branch — told its pages were excluded when NONE were.
// That regressed the very case the hotfix was written to preserve, into the invented-cause class it
// was written to delete. Measured live: 4 of the 15 rows carrying coverage already have
// `fetched > gradeable + Σexcluded` (freepltn is 24 unaccounted).
//
// THE POPULATION IS NOW `gradeable + Σexcluded` — the same-host-200 pages, exactly what the exclusion
// tally accounts for. Two things follow BY CONSTRUCTION rather than by a second guard:
//   · `excludedTotal > 0` whenever the exclusion branch fires (gradeable < floor <= gradeable + excl)
//   · the shortfall the copy narrates IS `excludedTotal`, so every printed number reconciles.
// Non-200, off-host and failed fetches never enter the decision, and are never narrated as exclusions.
// ─────────────────────────────────────────────────────────────────────────────
describe('the floor reads a population the exclusions can account for', () => {
  const completed = { ...HEALTHY, crawlTruncated: false, gradeablePageCount: 1 };

  it('a genuinely small site is small — even when many fetches failed', () => {
    // The reviewer's 3-page brochure with 10 broken links. Under the first attempt this was routed to
    // the exclusion branch and told pages were excluded when none were.
    const d = decideRefusal({ ...completed, gradeablePageCount: 3, excludedPageCount: 0 });
    expect(d.triggers).toContain('site_too_small_to_measure');
    expect(d.triggers).not.toContain('too_few_gradeable_after_exclusion');
  });

  it('a large site whose pages were excluded takes the exclusion branch', () => {
    // quotes.toscrape.com: 1 gradeable + 213 excluded = 214 content-bearing pages.
    const d = decideRefusal({ ...completed, excludedPageCount: 213 });
    expect(d.triggers).toContain('too_few_gradeable_after_exclusion');
    expect(d.triggers).not.toContain('site_too_small_to_measure');
  });

  it('the boundary is the floor CONSTANT, over the reconciling population', () => {
    expect(decideRefusal({ ...completed, gradeablePageCount: 1, excludedPageCount: MIN_GRADEABLE_PAGES - 1 }).triggers)
      .toContain('too_few_gradeable_after_exclusion');
    expect(decideRefusal({ ...completed, gradeablePageCount: 1, excludedPageCount: MIN_GRADEABLE_PAGES - 2 }).triggers)
      .toContain('site_too_small_to_measure');
  });

  it('THE EXCLUSION BRANCH IMPLIES excludedTotal > 0 — swept, never a guard we could forget', () => {
    // The property that makes the copy honest: it can only fire when something really was excluded,
    // so it can never narrate an exclusion that did not happen.
    for (const gradeable of [0, 1, 2, 3, 4]) {
      for (const excluded of [0, 1, 2, 5, 20, 213]) {
        const d = decideRefusal({ ...completed, gradeablePageCount: gradeable, excludedPageCount: excluded });
        if (d.triggers.includes('too_few_gradeable_after_exclusion')) {
          expect(excluded, `fired with excludedTotal=${excluded}`).toBeGreaterThan(0);
          expect(gradeable + excluded).toBeGreaterThanOrEqual(MIN_GRADEABLE_PAGES);
        }
      }
    }
  });

  it('a TRUNCATED crawl is unchanged, whatever the exclusions say', () => {
    const d = decideRefusal({ ...HEALTHY, gradeablePageCount: 1, excludedPageCount: 213, crawlTruncated: true });
    expect(d.triggers).toContain('too_few_gradeable_pages');
    expect(d.triggers).not.toContain('too_few_gradeable_after_exclusion');
  });

  it('unknown exclusion accounting falls back to the small-site branch', () => {
    const d = decideRefusal({ ...completed, excludedPageCount: null });
    expect(d.triggers).toContain('site_too_small_to_measure');
    expect(d.triggers).not.toContain('too_few_gradeable_after_exclusion');
  });

  it('the three below-floor triggers stay MUTUALLY EXCLUSIVE — swept', () => {
    const below = ['site_too_small_to_measure', 'too_few_gradeable_after_exclusion', 'too_few_gradeable_pages'] as const;
    for (const truncated of [false, true, null]) {
      for (const excluded of [null, 0, 1, 4, 5, 213]) {
        for (const gradeable of [0, 1, 4]) {
          const d = decideRefusal({ ...HEALTHY, gradeablePageCount: gradeable, crawlTruncated: truncated, excludedPageCount: excluded });
          const fired = below.filter((t) => d.triggers.includes(t));
          expect(fired, `truncated=${truncated} excl=${excluded} grade=${gradeable} fired ${fired.join('+')}`).toHaveLength(1);
        }
      }
    }
  });

  it('does not fire at all when the graded population clears the floor', () => {
    const d = decideRefusal({ ...HEALTHY, gradeablePageCount: MIN_GRADEABLE_PAGES, crawlTruncated: false, excludedPageCount: 200 });
    expect(d.refused).toBe(false);
    expect(d.triggers).toEqual([]);
  });
});
