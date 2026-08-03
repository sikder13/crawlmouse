import { describe, it, expect } from 'vitest';
import {
  diffAudit,
  countFindings,
  formatFindingDeltas,
  crawlDigest,
  diffCrawlComposition,
  formatCompositionDelta,
  SCORE_DELTA_THRESHOLD,
  type GradeSnapshot,
} from './backtest-diff.js';

// SPEC 01 v2 §8 cutover gate: the backtest grades ONE crawl output under v1 and v2 and diffs THOSE.
// These pin the pure diff math (the half that decides whether a swing "blocks the flip"). The
// crawl-once-grade-twice engine seam itself is pinned in packages/engine/src/analyze-crawl.test.ts.

describe('backtest diff — v1 vs v2 over one crawl (SPEC 01 §8)', () => {
  it('counts findings by category', () => {
    const counts = countFindings([
      { category: 'orphan' },
      { category: 'orphan' },
      { category: 'unreachable_page' },
    ]);
    expect(counts).toEqual({ orphan: 2, unreachable_page: 1 });
  });

  it('diffs v2 minus v1 score + per-category finding counts and flags a large swing', () => {
    // The canonical §0 win: v2 retires unreachable_page and removes false orphans, score rises.
    const v1: GradeSnapshot = { score: 64.86, grade: 'C', findingCounts: { orphan: 5, unreachable_page: 9 } };
    const v2: GradeSnapshot = { score: 76.09, grade: 'B-', findingCounts: { orphan: 2 } };
    const d = diffAudit(v1, v2);
    expect(d.scoreDelta).toBeCloseTo(11.23, 2);
    expect(d.gradeChanged).toBe(true);
    expect(d.findingDeltas).toEqual({ orphan: -3, unreachable_page: -9 });
    expect(d.large).toBe(true); // |11.23| > 5 -> must be explained before the flip
  });

  it('omits unchanged categories and treats a small swing as not-large', () => {
    const v1: GradeSnapshot = { score: 90, grade: 'A', findingCounts: { orphan: 1, deep_page: 2 } };
    const v2: GradeSnapshot = { score: 92, grade: 'A', findingCounts: { orphan: 1, deep_page: 2, incomplete_crawl: 1 } };
    const d = diffAudit(v1, v2);
    expect(d.scoreDelta).toBe(2);
    expect(d.gradeChanged).toBe(false);
    expect(d.findingDeltas).toEqual({ incomplete_crawl: 1 });
    expect(d.large).toBe(false);
  });

  it('does not flag a delta sitting exactly on the threshold (strictly greater)', () => {
    const v1: GradeSnapshot = { score: 70, grade: 'C-', findingCounts: {} };
    const v2: GradeSnapshot = { score: 70 + SCORE_DELTA_THRESHOLD, grade: 'B', findingCounts: {} };
    expect(diffAudit(v1, v2).large).toBe(false);
  });

  it('formats finding deltas compactly, with a dash for none', () => {
    expect(formatFindingDeltas({ orphan: -3, incomplete_crawl: 1 })).toBe('orphan:-3, incomplete_crawl:+1');
    expect(formatFindingDeltas({})).toBe('—');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a Stage 0.5 — crawl COMPOSITION diffing.
//
// The pre-5.1 harness graded ONE crawl output under v1 and v2, so its axis was the grading half and
// every crawl-half change cancelled out identically on both sides. SPEC 5.1a's Stages 1 and 3 live
// ENTIRELY in the crawl half, so that axis reports Δ0.00 while production grades move. These pin the
// primitive the re-axed harness needs: a stable digest over the fetched URL set, and a set difference
// that names which pages moved (the same instrument SPEC 5.1 §6.7 persists per audit).
// ─────────────────────────────────────────────────────────────────────────────

describe('crawl composition digest (SPEC 5.1a §6.7 instrument)', () => {
  it('is independent of the order the URLs were fetched in', () => {
    // The whole point: arrival order is a forbidden input (§6.6). Two crawls that reached the same
    // pages in different orders are the SAME composition and must digest identically.
    const a = crawlDigest(['https://x.test/b', 'https://x.test/a', 'https://x.test/c']);
    const b = crawlDigest(['https://x.test/c', 'https://x.test/b', 'https://x.test/a']);
    expect(a).toBe(b);
  });

  it('is independent of duplicates in the input', () => {
    expect(crawlDigest(['https://x.test/a', 'https://x.test/a', 'https://x.test/b']))
      .toBe(crawlDigest(['https://x.test/b', 'https://x.test/a']));
  });

  it('changes when a single URL differs', () => {
    const base = crawlDigest(['https://x.test/a', 'https://x.test/b']);
    expect(crawlDigest(['https://x.test/a', 'https://x.test/c'])).not.toBe(base);
  });

  it('changes when one URL is added — the 419-vs-418-page case (E3)', () => {
    const base = crawlDigest(['https://x.test/a', 'https://x.test/b']);
    expect(crawlDigest(['https://x.test/a', 'https://x.test/b', 'https://x.test/c'])).not.toBe(base);
  });

  it('does not collide when the same characters are split across URLs differently', () => {
    // Without a per-URL terminator both of these concatenate to "abc" and digest identically, so two
    // genuinely different samples would be certified "same composition". Behavioural, so it kills the
    // mutation on its own rather than leaning on the hand-computed pin below.
    expect(crawlDigest(['ab', 'c'])).not.toBe(crawlDigest(['a', 'bc']));
  });

  it('is a hex digest of fixed width, and empty is distinguishable from non-empty', () => {
    expect(crawlDigest(['https://x.test/a'])).toMatch(/^[0-9a-f]{64}$/);
    expect(crawlDigest([])).toMatch(/^[0-9a-f]{64}$/);
    expect(crawlDigest([])).not.toBe(crawlDigest(['https://x.test/a']));
  });

  it('is pinned to an independently computable value, not to its own output', () => {
    // Assert against a hand-computed constant so a refactor of the digest cannot silently redefine
    // "same composition" while every relative test above still agrees with itself. The construction
    // is sha256 over the sorted unique URLs joined by \n, with a trailing \n per line.
    // Computed OUTSIDE this module: node -e "…createHash('sha256'); for (u of sorted) h.update(u+'\n')…"
    expect(crawlDigest(['https://x.test/b', 'https://x.test/a']))
      .toBe('4b901ee62adad7066af40afcd86959d7fd396ee207ee1f1a05ffbd4b24b620b5');
  });
});

describe('crawl composition diff — the crawl-half signal the old axis could not see', () => {
  it('reports identical composition with an empty set difference', () => {
    const d = diffCrawlComposition(['https://x.test/a', 'https://x.test/b'], ['https://x.test/b', 'https://x.test/a']);
    expect(d.identical).toBe(true);
    expect(d.onlyInBase).toEqual([]);
    expect(d.onlyInHead).toEqual([]);
    expect(d.baseCount).toBe(2);
    expect(d.headCount).toBe(2);
  });

  it('names which pages entered and left the sample, sorted', () => {
    const d = diffCrawlComposition(
      ['https://x.test/keep', 'https://x.test/gone', 'https://x.test/also-gone'],
      ['https://x.test/keep', 'https://x.test/new'],
    );
    expect(d.identical).toBe(false);
    expect(d.onlyInBase).toEqual(['https://x.test/also-gone', 'https://x.test/gone']);
    expect(d.onlyInHead).toEqual(['https://x.test/new']);
    expect(d.baseCount).toBe(3);
    expect(d.headCount).toBe(2);
    expect(d.baseDigest).not.toBe(d.headDigest);
  });

  it('THE STAGE 0.5 CLAIM: an identical grade does NOT imply identical crawl composition', () => {
    // Measured in production: the two 2026-07-21 duskroute.com runs both scored 61.20 from
    // discovered sets of 2526 and 2979 URLs (docs/tickets/2026-07-09-…-honesty.md, addendum A1).
    // diffAudit sees a perfect match; the composition diff sees the truth. This is precisely the
    // blindness that made the old harness unable to observe a crawl-half change.
    const same: GradeSnapshot = { score: 61.2, grade: 'C', findingCounts: { orphan: 4 } };
    const gradeDiff = diffAudit(same, same);
    expect(gradeDiff.scoreDelta).toBe(0);
    expect(gradeDiff.gradeChanged).toBe(false);
    expect(gradeDiff.findingDeltas).toEqual({});

    const composition = diffCrawlComposition(['https://d.test/a', 'https://d.test/b'], ['https://d.test/a', 'https://d.test/z']);
    expect(composition.identical).toBe(false);
    expect(composition.onlyInBase).toEqual(['https://d.test/b']);
    expect(composition.onlyInHead).toEqual(['https://d.test/z']);
  });

  it('bounds how many moved URLs it renders, and says how many it withheld', () => {
    // No silent truncation: a 500-page swing must not print 500 rows, and must not pretend it printed
    // everything either.
    const base = Array.from({ length: 12 }, (_, i) => `https://x.test/b${i}`);
    const head = Array.from({ length: 12 }, (_, i) => `https://x.test/h${i}`);
    // 12 left + 12 entered = 24 moved; 3 rendered, so 21 withheld and it must say so.
    const rendered = formatCompositionDelta(diffCrawlComposition(base, head), 3);
    expect(rendered).toContain('−12/+12');
    expect(rendered).toContain('+21 more');
    expect(rendered).toContain('/b0');
    expect(rendered).not.toContain('/b9');
  });

  it('renders identical composition as an unambiguous marker', () => {
    expect(formatCompositionDelta(diffCrawlComposition(['https://x.test/a'], ['https://x.test/a']), 3))
      .toBe('identical');
  });
});
