import { describe, it, expect } from 'vitest';
import type { CrawlHealth } from '@crawlmouse/types';
import { computeConfidenceBand, estimateSiteTotal } from './confidence-band.js';

function mkHealth(overrides: Partial<CrawlHealth> = {}): CrawlHealth {
  return {
    discovered: 10,
    fetchedOk: 10,
    blocked: 0,
    dead: 0,
    attempted: 10,
    coveragePct: 1,
    blockRate: 0,
    partial: false,
    confidence: 'high',
    ...overrides,
  };
}

function band(lower: number, upper: number): [number, number] {
  return [lower, upper];
}

describe('estimateSiteTotal (§2 site-size estimate honesty)', () => {
  it('uses the sitemap URL count when the sitemap is larger than what was crawled', () => {
    const h = mkHealth({ fetchedOk: 50, discovered: 60 });
    expect(estimateSiteTotal(h, 1200)).toEqual({ estimatedTotal: 1200, method: 'sitemap' });
  });

  it('falls back to a conservative frontier estimate (discovered) when there is no usable sitemap', () => {
    const h = mkHealth({ fetchedOk: 50, discovered: 80 });
    expect(estimateSiteTotal(h, null)).toEqual({ estimatedTotal: 80, method: 'frontier' });
  });

  it('ignores a sitemap not larger than the crawl (stale/partial), using the frontier instead', () => {
    const h = mkHealth({ fetchedOk: 50, discovered: 80 });
    expect(estimateSiteTotal(h, 40)).toEqual({ estimatedTotal: 80, method: 'frontier' });
  });

  it('returns null/none when the crawl was complete and no larger sitemap exists', () => {
    const h = mkHealth({ fetchedOk: 50, discovered: 50 });
    expect(estimateSiteTotal(h, null)).toEqual({ estimatedTotal: null, method: 'none' });
    // sitemap equal to (not larger than) the crawl is not usable either.
    expect(estimateSiteTotal(h, 50)).toEqual({ estimatedTotal: null, method: 'none' });
  });

  it('never inflates: a non-null estimate is always greater than the crawled count', () => {
    const h = mkHealth({ fetchedOk: 50, discovered: 80 });
    for (const sm of [null, 10, 1200]) {
      const { estimatedTotal } = estimateSiteTotal(h, sm);
      if (estimatedTotal !== null) expect(estimatedTotal).toBeGreaterThan(h.fetchedOk);
    }
  });
});

describe('computeConfidenceBand (§2 band; replaces the blunt low-confidence cap)', () => {
  const est = { estimatedTotal: 1200, method: 'sitemap' as const };

  it('keeps the point estimate equal to the (uncapped) score and carries its grade', () => {
    const b = computeConfidenceBand(89, 'A-', mkHealth({ confidence: 'low' }), est);
    expect(b.pointEstimate).toBe(89);
    expect(b.grade).toBe('A-');
  });

  it('widens the band by confidence: high ±2, medium ±5, low ±12', () => {
    expect(band(...xy(computeConfidenceBand(80, 'B+', mkHealth({ confidence: 'high' }), est)))).toEqual([78, 82]);
    expect(band(...xy(computeConfidenceBand(80, 'B+', mkHealth({ confidence: 'medium' }), est)))).toEqual([75, 85]);
    expect(band(...xy(computeConfidenceBand(80, 'B+', mkHealth({ confidence: 'low' }), est)))).toEqual([68, 92]);
  });

  it('clamps the band to [0, 100]', () => {
    expect(xy(computeConfidenceBand(99, 'A', mkHealth({ confidence: 'high' }), est))).toEqual([97, 100]);
    expect(xy(computeConfidenceBand(3, 'F', mkHealth({ confidence: 'low' }), est))).toEqual([0, 15]);
  });

  it('isEstimate: true on a partial crawl or any non-high confidence, false only on a clean high-confidence crawl', () => {
    expect(computeConfidenceBand(80, 'B+', mkHealth({ confidence: 'high', partial: false }), est).isEstimate).toBe(false);
    expect(computeConfidenceBand(80, 'B+', mkHealth({ confidence: 'high', partial: true }), est).isEstimate).toBe(true);
    expect(computeConfidenceBand(80, 'B+', mkHealth({ confidence: 'medium', partial: false }), est).isEstimate).toBe(true);
    expect(computeConfidenceBand(80, 'B+', mkHealth({ confidence: 'low', partial: false }), est).isEstimate).toBe(true);
  });

  it('reports the basis: crawled = fetchedOk plus the estimate method/total', () => {
    const b = computeConfidenceBand(80, 'B+', mkHealth({ fetchedOk: 42, confidence: 'medium' }), {
      estimatedTotal: 100,
      method: 'frontier',
    });
    expect(b.basis).toEqual({ crawled: 42, estimatedTotal: 100, method: 'frontier' });
    expect(b.confidence).toBe('medium');
  });

  it('is deterministic: identical inputs produce an identical band', () => {
    const a = computeConfidenceBand(73.5, 'B-', mkHealth({ confidence: 'low', fetchedOk: 7 }), est);
    const b = computeConfidenceBand(73.5, 'B-', mkHealth({ confidence: 'low', fetchedOk: 7 }), est);
    expect(a).toEqual(b);
  });
});

function xy(b: { lower: number; upper: number }): [number, number] {
  return [b.lower, b.upper];
}

// ─────────────────────────────────────────────────────────────────────────────
// GATE 4 / R1-NB2 — THE ESTIMATE BASIS COUNTS PAGES CRAWLED, NOT PAGES GRADED.
//
// `basis.crawled` is `health.fetchedOk` and it is rendered as "based on N of ~M pages" ABOVE a grade
// computed over the GRADEABLE population. Before Stage 2 those two numbers were nearly equal, so
// nothing turned on the distinction. Stage 2 classification makes them diverge by MULTIPLES — the
// branch's own measurement is an 11-page blog fetching 11 and grading 3.
//
// The sentence is not false: it says *crawled*, and crawled is what it prints. What it is, is §7.1's
// "three counts, always distinguished" left unfixed on the majority path — a banner where a reader
// naturally reads the number as the basis of the letter above it. Changing the copy is a §7 decision
// for 5.1b; what belongs here is a PIN, so the two counts cannot be quietly swapped for each other
// by an edit that looks like a simplification.
// ─────────────────────────────────────────────────────────────────────────────
describe('the confidence band’s basis names the CRAWLED count, and only that', () => {
  const health = (over: Partial<CrawlHealth> = {}): CrawlHealth => ({
    discovered: 40, fetchedOk: 11, blocked: 0, dead: 0, attempted: 11,
    coveragePct: 1, blockRate: 0, partial: false, confidence: 'high',
    ...over,
  });

  it('carries fetchedOk — the count of pages we successfully read', () => {
    const band = computeConfidenceBand(81.39, 'B', health(), { estimatedTotal: 40, method: 'sitemap' });
    expect(band.basis.crawled).toBe(11);
  });

  it('does not silently become the graded population — the two diverge by multiples now', () => {
    // The 11-fetched / 3-gradeable shape measured on a real small blog. `computeConfidenceBand` is
    // not even GIVEN the gradeable count, which is the structural reason it cannot drift — asserted
    // here so a future signature change that hands it one is a deliberate act, not an accident.
    const band = computeConfidenceBand(81.39, 'B', health(), { estimatedTotal: 40, method: 'sitemap' });
    expect(band.basis.crawled).not.toBe(3);
    expect(computeConfidenceBand.length).toBe(4);
  });

  it('moves with fetchedOk and with nothing else', () => {
    const a = computeConfidenceBand(81.39, 'B', health({ fetchedOk: 11 }), { estimatedTotal: 40, method: 'sitemap' });
    const b = computeConfidenceBand(81.39, 'B', health({ fetchedOk: 7 }), { estimatedTotal: 40, method: 'sitemap' });
    expect([a.basis.crawled, b.basis.crawled]).toEqual([11, 7]);
    // The estimate half is reproduced verbatim from its own provenance, never re-derived here.
    expect(a.basis.estimatedTotal).toBe(40);
    expect(a.basis.method).toBe('sitemap');
  });
});
