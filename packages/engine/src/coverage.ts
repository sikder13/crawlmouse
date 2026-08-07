import type { CoverageAccounting, PageClassification, PageKind } from '@crawlmouse/types';
import type { SiteTotalEstimate } from './confidence-band.js';

/**
 * SPEC 5.1a §7 — COVERAGE ACCOUNTING & ORPHAN TRIANGULATION.
 *
 * Pure: no clock, no network, no database. Every number here is a function of counts the crawl and
 * the graph already produced, so the same audit always yields the same accounting.
 *
 * TWO THINGS THIS MODULE DELIBERATELY DOES NOT DO.
 *
 * 1. It does not RE-DERIVE the site-size estimate. `estimateSiteTotal` already decides it and already
 *    carries provenance, so that decision is passed in and reproduced verbatim. A second derivation
 *    of a shared value is the `gradeInputsFrom` defect class: the copies agree until they don't, and
 *    nothing is watching the moment they stop.
 *
 * 2. It does not re-count the gradeable population. `gradeableCount` comes from the same
 *    `GraphAnalysis` every grade ratio is computed over, so the coverage a user reads and the
 *    denominator the grade used are the same number by construction rather than by coincidence.
 */

export interface CoverageInput {
  /** Every URL fetched, any status — blocked and dead fetches included. */
  fetchedCount: number;
  /** The graded population size, from `GraphAnalysis.gradeableCount`. NOT recomputed here. */
  gradeableCount: number;
  /** Every classified page, for the §7.3 exclusion tally. */
  classifications: Iterable<PageClassification>;
  /** Same-origin URLs the sitemap DECLARED (pre-robots, pre-trap, pre-cap), or null when none. */
  sitemapDeclaredUrls: string[] | null;
  /** Sitemap URLs the OWNER disallowed. A choice, never a defect — counted apart. */
  robotsExcludedSitemapUrls: string[];
  /** The already-computed estimate + provenance. Reproduced, never recomputed. */
  estimate: SiteTotalEstimate;
}

export function computeCoverageAccounting(input: CoverageInput): CoverageAccounting {
  // §7.3 — tally what was excluded, by kind. Sorted by count descending (then kind, so the order is
  // total and deterministic) because "we excluded 412 tag-archive pages" is the sentence a reader
  // needs first, and an unordered tally buries it.
  const byKind = new Map<PageKind, number>();
  for (const c of input.classifications) {
    if (c.gradeable) continue;
    byKind.set(c.kind, (byKind.get(c.kind) ?? 0) + 1);
  }
  const excluded = [...byKind.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));

  // §7.2 — orphan triangulation. Null (not zero) with no sitemap: zero would assert that every
  // declared page is reachable, about a declaration we never received.
  let sitemapDeclared: number | null = null;
  let sitemapRobotsExcluded: number | null = null;
  if (input.sitemapDeclaredUrls !== null) {
    const declared = new Set(input.sitemapDeclaredUrls);
    const ownerExcluded = new Set(input.robotsExcludedSitemapUrls);
    sitemapDeclared = declared.size;
    // Counted over the DECLARED set, so a robots.txt naming paths the sitemap never listed cannot
    // inflate it.
    sitemapRobotsExcluded = [...declared].filter((u) => ownerExcluded.has(u)).length;
  }

  const { estimatedTotal, method } = input.estimate;
  // Clamped at 1: a link-discovered site can legitimately exceed its own sitemap, and "we covered
  // 130% of your site" is not a coherent claim. When that happens the ESTIMATE was wrong, not the
  // coverage, and the estimate keeps its provenance so that is visible.
  const coverageRatio =
    estimatedTotal === null || estimatedTotal <= 0
      ? null
      : Math.min(1, input.gradeableCount / estimatedTotal);

  return {
    fetched: input.fetchedCount,
    gradeable: input.gradeableCount,
    excluded,
    sitemapDeclared,
    sitemapRobotsExcluded,
    estimatedTotal,
    estimateSource: method,
    coverageRatio,
  };
}

/*
 * D4 — `sitemapDeltaSeverity` and `sitemapUnreachedFinding` LIVED HERE AND ARE DELIBERATELY GONE.
 *
 * The finding read "N of the M pages in your sitemap can't be reached by following links". That is a
 * claim about the SITE, and the number behind it was a measurement of OUR CRAWL BUDGET: reachability
 * was differenced against a BFS over a graph that drops edges to unfetched targets, so "unreachable"
 * silently meant "not fetched in the crawl we could afford".
 *
 * Measured through the real crawler on a site with ZERO orphans by any definition — homepage, 40
 * section pages, 10 leaves each, every leaf two clicks from home:
 *
 *     pageCap    5   10   25    60   441
 *     unreached 400  400  400  230     0        (critical, LEADING the findings, on GRADED audits)
 *
 * and 400 of 601 declared at the real FREE_PAGE_CAP = 500 on an ordinary paginated blog whose sitemap
 * declares posts but not the `/page/N` archives — the default output of every major WordPress SEO
 * plugin. Sitemaps are collected to 10 000 URLs, so any site declaring more than we fetch was exposed.
 *
 * Two fix passes narrowed it and neither deleted it, and each replacement fixture certified the rule
 * on the one input class where it could not fail (first: leaves with no inbound link at any cap;
 * then: a complete graph, where one hop trivially reaches everything). The owner's ruling was that a
 * finding derived from our own page cap is a claim about the customer's site manufactured from our
 * budget — the exact class this spec deletes — so it does not ship. Measured dishonesty does not ship.
 *
 * NOT DELETED, HANDED OVER. 5.1b inherits the feature together with the constraint it must satisfy:
 * A SITEMAP-ORPHAN CLAIM MUST BE BUDGET-INDEPENDENT OR REFUSED. Both reviewers' fixtures and both
 * candidate designs are in `evidence/2026-08-07-d4-cut-and-b5-1-diagnosis.md`. Whatever is built
 * there, the acceptance fixture must be a PAGINATED HUB, not a complete graph.
 *
 * The freepltn shape that motivated D4 loses nothing honest: with one reachable page and no observed
 * edges into the graded population it refuses on `no_observed_links`, which is a measurement we
 * actually hold.
 */
