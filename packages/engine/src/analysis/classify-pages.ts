import type { PageClassification, PageKind } from '@crawlmouse/types';
import { classifyUrlKind } from './page-kind.js';
import { hammingDistance, SIMHASH_HAMMING_K } from './simhash.js';
import { MIN_GRADEABLE_TEXT_CHARS } from '../constants.js';

/**
 * SPEC 5.1a §5 — page classification. Pure: no network, no clock, no crawl state.
 *
 * WHAT IT IS FOR (M9, owner-ruled). A classified-out page leaves the GRADEABLE POPULATION — the
 * numerator *and* the denominator of the orphan, depth and anchor statistics — but STAYS IN THE GRAPH
 * as a connectivity node. Both halves matter and they pull in opposite directions:
 *
 *  - A content page reachable only through a tag archive is NOT an orphan. Crawlers follow archive
 *    links. Dropping archives from the graph would manufacture exactly the false orphans this spec
 *    exists to eliminate.
 *  - A tweet stub must not dilute the orphan ratio either. Leaving it in the denominator is how a site
 *    with 400 status stubs and 40 real pages reads as well-linked.
 *
 * So: excluded from the population, retained in the graph. Navigational pages may still appear as hubs
 * in the structure dimension, and should — a category page genuinely is architecture.
 *
 * LAYERED CHEAPEST-FIRST, first exclusion wins, and every layer records WHY. A page is `content` only
 * if every layer passes.
 */

export interface ClassifyInput {
  /** Canonical page identity. */
  url: string;
  /** sha256 identity hash, used as the `duplicateOf` reference. */
  urlHash: string;
  /** Main-content characters after density filtering; undefined when extraction degraded. */
  mainTextChars?: number;
  /** Dedup-grade SimHash, or null when the document is too short for a k=3 verdict. */
  simhash?: string | null;
  /** `noindex` from a meta robots tag or the X-Robots-Tag header. */
  noindex?: boolean;
}

export interface ClassifyOptions {
  /** The homepage is always gradeable; it is the BFS root and cannot be excluded by a URL rule. */
  homepageUrl: string;
  /**
   * CMS-specific path overlay (`getAdjustments(cms).excludeFromOrphans`). Consulted THROUGH this
   * classifier rather than beside it: two overlapping rule sets consulted independently is the FU-12k
   * defect class — one concept, two computations, guaranteed to drift.
   */
  isCmsExcluded: (url: string) => boolean;
}

/**
 * Classify every crawled page. Returns a map keyed by canonical URL.
 *
 * DETERMINISM: pages are processed in canonical-URL ASC order, never in crawl-arrival order, so the
 * duplicate REPRESENTATIVE (the first member of a cluster) is a function of the URL set alone. Arrival
 * order is a forbidden input (§6.6), and picking the representative by arrival would have smuggled it
 * back in — the same page would be `content` or `duplicate` depending on network timing.
 */
export function classifyPages(pages: ClassifyInput[], opts: ClassifyOptions): Map<string, PageClassification> {
  const out = new Map<string, PageClassification>();
  /** Representatives seen so far: simhash -> urlHash of the page that claimed it. */
  const representatives: { simhash: string; urlHash: string }[] = [];

  for (const page of [...pages].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))) {
    out.set(page.url, classifyOne(page, opts, representatives));
  }
  return out;
}

function make(kind: PageKind, reason: string, simhash: string | null, duplicateOf: string | null): PageClassification {
  return { kind, gradeable: kind === 'content', reason, templateKey: '', simhash, duplicateOf };
}

function classifyOne(
  page: ClassifyInput,
  opts: ClassifyOptions,
  representatives: { simhash: string; urlHash: string }[],
): PageClassification {
  const simhash = page.simhash ?? null;

  // The homepage is gradeable unconditionally. It is the BFS root for depth and the orphan seed, so
  // excluding it would leave every other page unreachable and produce a wildly wrong grade — the exact
  // shape depth.ts already carries a fallback for.
  if (page.url === opts.homepageUrl) return make('content', 'homepage', simhash, null);

  // ── Layer 1 (§5.1): URL and query-parameter rules. Cheapest, and no page fetch needed. ──
  const urlKind = classifyUrlKind(page.url);
  if (urlKind) return make(urlKind, `url_rule:${urlKind}`, simhash, null);

  // ── Layer 1b (§5.1, M8): the CMS-specific overlay, consulted through the same entry point. ──
  if (opts.isCmsExcluded(page.url)) return make('utility', 'cms_utility_path', simhash, null);

  // ── Layer 2 (§5.2): directive signals. The owner told search engines to ignore this page. ──
  if (page.noindex) return make('utility', 'directive:noindex', simhash, null);

  // ── Layer 3 (§5.3): thin content. CONSERVATIVE BIAS — a real contact page must never be excluded
  // as junk, so the floor sits far below SPEC 05's 200-char "readable" gate. When extraction degraded
  // (undefined rather than 0) we keep the page: absence of a signal is not evidence of thinness. ──
  if (page.mainTextChars !== undefined && page.mainTextChars < MIN_GRADEABLE_TEXT_CHARS) {
    return make('thin', `thin:${page.mainTextChars}<${MIN_GRADEABLE_TEXT_CHARS}`, simhash, null);
  }

  // ── Layer 4 (§5.4): near-duplicate collapsing. Only reachable with a dedup-grade hash, which is
  // null for documents too short for a k=3 verdict — so short pages are never collapsed. ──
  if (simhash) {
    for (const rep of representatives) {
      if (hammingDistance(simhash, rep.simhash) <= SIMHASH_HAMMING_K) {
        return make('duplicate', `duplicate_of:${rep.urlHash.slice(0, 12)}`, simhash, rep.urlHash);
      }
    }
    representatives.push({ simhash, urlHash: page.urlHash });
  }

  return make('content', 'content', simhash, null);
}
