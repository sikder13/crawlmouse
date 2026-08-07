import type { CoverageAccounting, Finding, PageClassification, PageKind } from '@crawlmouse/types';
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
  /** URLs reachable from the homepage by FOLLOWING LINKS (i.e. `GraphAnalysis.depths` keys). */
  linkReachableUrls: Set<string>;
  /** The already-computed estimate + provenance. Reproduced, never recomputed. */
  estimate: SiteTotalEstimate;
}

/**
 * SPEC 5.1a §7.2 — "reachable by following links", measured ONE HOP PAST THE FETCH BOUNDARY.
 *
 * GATE 4 / B-A. This used to be `new Set(ga.depths.keys())` at the call site. `depths` is BFS over
 * `buildGraph`, and `buildGraph` drops every edge whose TARGET was not fetched — so "reachable by
 * following links" silently meant "reachable AND fetched in the crawl we happened to afford". On a
 * site where every page links to every other page (zero orphans by any definition) that reported 36
 * of 41 declared pages unreachable at pageCap 5, 31 at cap 10 and 0 at cap 41: a critical, quantified
 * claim about the SITE that was really a measurement of OUR BUDGET, leading the findings on a graded
 * audit. `FREE_PAGE_CAP` is 500 and sitemaps are collected to 10 000, so every site declaring more
 * than we fetch was exposed to it.
 *
 * The sentence we publish is "can't be reached by following links". That is a claim about the SITE's
 * link structure, and the evidence for it is a LINK — not a fetch. So a declared URL that any
 * reachable page links to is reached, whether or not our budget stretched to fetching it.
 *
 * ONE HOP, DELIBERATELY, and computed in two phases against the ORIGINAL reachable set rather than by
 * growing the set while iterating. Two reasons, and the second is the load-bearing one:
 *
 *  - We only ever observe the outbound links of pages we FETCHED, so a page we did not fetch
 *    contributes no further hops. There is no second hop to take.
 *  - Growing the set in place would make membership depend on the ORDER `links` arrives in, which
 *    §6.6 forbids outright. Two phases make the result a pure function of the two inputs.
 *
 * WHAT THIS STILL CANNOT SEE, stated rather than implied: a page linked ONLY from a page we never
 * fetched is still counted unreached. That residue is inherent — inbound evidence can only come from
 * pages we read — but it is no longer the systematic case, because a site with ordinary navigation
 * links its pages from every page we fetch.
 */
export function linkReachableUrls(
  bfsReachable: Iterable<string>,
  links: readonly { fromUrl: string; toUrl: string }[],
): Set<string> {
  const fetchedAndReachable = new Set(bfsReachable);
  const reachable = new Set(fetchedAndReachable);
  for (const l of links) {
    if (fetchedAndReachable.has(l.fromUrl)) reachable.add(l.toUrl);
  }
  return reachable;
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
  let sitemapUnreached: number | null = null;
  let sitemapRobotsExcluded: number | null = null;
  if (input.sitemapDeclaredUrls !== null) {
    const declared = new Set(input.sitemapDeclaredUrls);
    const ownerExcluded = new Set(input.robotsExcludedSitemapUrls);
    sitemapDeclared = declared.size;
    // Counted over the DECLARED set, so a robots.txt naming paths the sitemap never listed cannot
    // inflate it.
    sitemapRobotsExcluded = [...declared].filter((u) => ownerExcluded.has(u)).length;
    sitemapUnreached = [...declared].filter(
      // Disallowed URLs are skipped entirely: we never fetched them, so we hold no evidence about
      // their inbound links, and "unreachable" would be a claim rather than a measurement.
      (u) => !ownerExcluded.has(u) && !input.linkReachableUrls.has(u),
    ).length;
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
    sitemapUnreached,
    sitemapRobotsExcluded,
    estimatedTotal,
    estimateSource: method,
    coverageRatio,
  };
}

/**
 * SPEC 5.1a D4 — how loudly the sitemap delta speaks, or `null` when it has nothing to say.
 *
 * CRITICAL when the unreachable pages STRICTLY OUTNUMBER the reachable ones — i.e. more of the site
 * the owner declared cannot be reached by clicking than can. That is a CATEGORICAL comparison of the
 * two halves against each other, deliberately not a tuned fraction: SPEC 5.1a admits no new
 * calibrated thresholds (the calibrated coverage-ratio threshold is 5.1b), and "we picked 60%" invites
 * an argument about 55 or 65 that comparing the two halves simply ends.
 *
 * A 50/50 split is not "most of your site", so it stays MEDIUM. The boundary is pinned by test.
 */
export function sitemapDeltaSeverity(coverage: CoverageAccounting): Finding['severity'] | null {
  const unreached = coverage.sitemapUnreached;
  if (unreached === null || unreached === 0 || coverage.sitemapDeclared === null) return null;
  // Reachable is measured against the pages we were ALLOWED to reach, so the owner's own
  // robots exclusions sit outside the comparison on both sides.
  const considered = coverage.sitemapDeclared - (coverage.sitemapRobotsExcluded ?? 0);
  const reachable = considered - unreached;
  return unreached > reachable ? 'critical' : 'medium';
}

/**
 * D4 — the finding itself. THE SITEMAP DELTA IS A FINDING, NOT A CAVEAT.
 *
 * On the acceptance case (freepltn: 1 of 821 declared pages reachable) "820 of the 821 pages in your
 * sitemap can't be reached by following links" is the single most useful thing we can tell the owner,
 * and it remains true whether or not a grade follows. It is emitted FIRST so it leads the list, and it
 * survives a refusal — findings are not withheld by the refusal gate, precisely so a site we declined
 * to grade still learns the most important thing we found out about it.
 */
export function sitemapUnreachedFinding(coverage: CoverageAccounting): Finding | null {
  const severity = sitemapDeltaSeverity(coverage);
  if (severity === null || coverage.sitemapUnreached === null || coverage.sitemapDeclared === null) return null;
  const considered = coverage.sitemapDeclared - (coverage.sitemapRobotsExcluded ?? 0);
  return {
    category: 'sitemap_unreached',
    severity,
    payload: {
      unreached: coverage.sitemapUnreached,
      declared: coverage.sitemapDeclared,
      // The reachable count is carried explicitly rather than left to be re-derived by every surface
      // that renders this — the same one-source-of-truth rule the estimate follows above.
      reachable: considered - coverage.sitemapUnreached,
      robotsExcluded: coverage.sitemapRobotsExcluded ?? 0,
    },
  };
}
