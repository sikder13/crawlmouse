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
 *   - any other edge to an address the crawl never fetched is kept only up to
 *     MAX_OTHER_EDGES_PER_PAGE per source page, in the order the worker recorded them. Such edges
 *     reach no grade; they tell the detectors the crawl left pages unread (`unfetched`). The loader
 *     records how many it left out (`link_edges_dropped`), and `internal_links` counts them;
 *   - when the edges kept whole (to own pages, or generic) pass MAX_OWN_EDGES, the build is not
 *     attempted (OwnEdgesOverBound): a graph that large is not held, and no grade is given from part
 *     of one.
 */
import type { CrawlPage, LinkEdge } from '@crawlmouse/types/v2';
import { canonicalizeUrl } from '../../url-canonical.js';

export const MAX_CHECK_EDGES = 50_000;
export const MAX_OTHER_EDGES_PER_PAGE = 20;
export const MAX_OWN_EDGES = 100_000;

export class OwnEdgesOverBound extends Error {
  constructor(readonly own: number) {
    super(`the crawl's own pages hold more than ${MAX_OWN_EDGES} link edges`);
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
 * MAX_OTHER_EDGES_PER_PAGE per source page of the rest. Throws OwnEdgesOverBound once the edges kept
 * whole pass MAX_OWN_EDGES.
 */
export function boundedEdges(
  edges: readonly LinkEdge[],
  addresses: ReadonlySet<string>,
  kept: EdgesKept,
  maxOwn: number = MAX_OWN_EDGES,
): LinkEdge[] {
  const out: LinkEdge[] = [];
  for (const e of edges) {
    if (addresses.has(e.to_url) || e.is_generic_anchor) {
      if (++kept.own > maxOwn) throw new OwnEdgesOverBound(kept.own);
      out.push(e);
      continue;
    }
    const n = kept.other.get(e.from_url) ?? 0;
    if (n >= MAX_OTHER_EDGES_PER_PAGE) continue;
    kept.other.set(e.from_url, n + 1);
    out.push(e);
  }
  return out;
}
