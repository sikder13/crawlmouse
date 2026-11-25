/**
 * The bound on the link edges a check's build holds (F-248). A crawled page can link to hundreds of
 * addresses: en.wikipedia.org's 445 pages carried 226,572 edges and developer.mozilla.org's 500 pages
 * 215,324, and holding them all ran the build out of the function's 2,048 MB. Every other real site
 * QA checked held at most 22,951 (staging, 24 Nov 2026).
 *
 * At or under MAX_CHECK_EDGES nothing changes: the build reads every edge, as before. Over it:
 *   - every edge between the crawl's own pages is kept (`rowAddresses`: a row's URL, or where it
 *     landed). Those are the edges the grade reads (the graph, its orphans, depth and PageRank), so
 *     the grade is the one the whole graph gives;
 *   - every edge with generic anchor text is kept, wherever it points: the generic-anchor detector
 *     counts a page's generic links against its `links_out`, so it decides as it would uncut, except
 *     that a page keeping fewer links can be `indeterminate` where it was `not_detected`;
 *   - any other edge to an address the crawl never fetched is kept only up to `maxOther` per
 *     source page (otherEdgesPerPage: 20, or 5 on a check of more than 500 pages), in the order the
 *     worker recorded them. Such edges
 *     reach no grade; they tell the detectors the crawl left pages unread (`unfetched`). The loader
 *     records how many it left out (`link_edges_dropped`), and `internal_links` counts them;
 *   - when the edges kept whole (to own pages, or generic) pass `maxOwn` (ownEdgeBound: 250,000
 *     with 3.5 GiB of memory or more, 100,000 otherwise), the build is not attempted
 *     (OwnEdgesOverBound): a graph that large is not held, and no grade is given from part
 *     of one.
 */
import type { CrawlPage, LinkEdge } from '@crawlmouse/types/v2';
import { canonicalizeUrl } from '../../url-canonical.js';

export const MAX_CHECK_EDGES = 50_000;
export const MAX_OTHER_EDGES_PER_PAGE = 20;
/** Edges elsewhere kept a page on a check of more than LARGE_CHECK_PAGES pages (inbox 079). */
export const LARGE_CHECK_OTHER_EDGES_PER_PAGE = 5;
export const LARGE_CHECK_PAGES = 500;
/**
 * The own-page edges a build holds at most with 2,048 MB, the function's size until 24 Nov: at 2,000
 * pages it built at 1,765 MiB (#165's harness).
 */
export const MAX_OWN_EDGES = 100_000;
/**
 * With 4 GB (inbox 080): 2,000 pages × 100 own links, the densest staging site's (react.dev, 104 a
 * page), built at 1,818 MiB, and at 2,358 MiB with 20 edges elsewhere a page.
 */
export const MAX_OWN_EDGES_LARGE_MEMORY = 250_000;
/** The memory from which a build holds MAX_OWN_EDGES_LARGE_MEMORY: 3.5 GiB, short of 4 GB. */
export const LARGE_MEMORY_MB = 3_584;

/** The own-page edges a build may hold with `memoryMb` of memory; unknown memory is the smaller. */
export const ownEdgeBound = (memoryMb: number | null): number =>
  memoryMb !== null && memoryMb >= LARGE_MEMORY_MB ? MAX_OWN_EDGES_LARGE_MEMORY : MAX_OWN_EDGES;

/** The edges elsewhere a build keeps a page, by the check's page cap. */
export const otherEdgesPerPage = (pageCap: number): number =>
  pageCap > LARGE_CHECK_PAGES ? LARGE_CHECK_OTHER_EDGES_PER_PAGE : MAX_OTHER_EDGES_PER_PAGE;

export class OwnEdgesOverBound extends Error {
  constructor(
    readonly own: number,
    readonly bound: number = MAX_OWN_EDGES,
  ) {
    super(`the crawl's own pages hold more than ${bound} link edges`);
    this.name = 'OwnEdgesOverBound';
  }
}

const spell = (url: string): string | null => {
  try {
    return canonicalizeUrl(url);
  } catch {
    return null;
  }
};

/** Every address a crawl row answers for: its URL and, when it landed elsewhere, where it landed. */
export function rowAddresses(rows: readonly Pick<CrawlPage, 'url' | 'final_url'>[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    out.push(r.url);
    const landed = r.final_url === null ? null : spell(r.final_url);
    if (landed !== null && landed !== r.url) out.push(landed);
  }
  return out;
}

/** What has been kept so far over a whole check, across its batches. */
export interface EdgesKept {
  /** Edges kept whole: to the crawl's own pages, or with generic anchor text. */
  own: number;
  /** Per source page, its edges to addresses the crawl never fetched. */
  other: Map<string, number>;
}

export const noEdgesKept = (): EdgesKept => ({ own: 0, other: new Map() });

/**
 * A batch's edges over the bound: every edge to `addresses` or with generic anchor text, and up to
 * `maxOther` per source page of the rest. Throws OwnEdgesOverBound once the edges kept whole pass
 * `maxOwn`.
 */
export function boundedEdges(
  edges: readonly LinkEdge[],
  addresses: ReadonlySet<string>,
  kept: EdgesKept,
  maxOwn: number = MAX_OWN_EDGES,
  maxOther: number = MAX_OTHER_EDGES_PER_PAGE,
): LinkEdge[] {
  const out: LinkEdge[] = [];
  for (const e of edges) {
    if (addresses.has(e.to_url) || e.is_generic_anchor) {
      if (++kept.own > maxOwn) throw new OwnEdgesOverBound(kept.own, maxOwn);
      out.push(e);
      continue;
    }
    const n = kept.other.get(e.from_url) ?? 0;
    if (n >= maxOther) continue;
    kept.other.set(e.from_url, n + 1);
    out.push(e);
  }
  return out;
}
