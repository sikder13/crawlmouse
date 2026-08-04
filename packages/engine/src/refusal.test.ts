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
    const d = decideRefusal({ ...HEALTHY, gradeablePageCount: MIN_GRADEABLE_PAGES - 2, crawlTruncated: false });
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
