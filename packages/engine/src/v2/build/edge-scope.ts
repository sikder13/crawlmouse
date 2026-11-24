/**
 * The bound on the link edges a check's build holds (F-248). A crawled page can link to hundreds of
 * addresses: en.wikipedia.org's 445 pages carried 226,572 edges and developer.mozilla.org's 500 pages
 * 215,324, and holding them all ran the build out of the function's 2,048 MB. Every other real site
 * QA checked held at most 22,951 (staging, 24 Nov 2026).
 *
 * At or under MAX_CHECK_EDGES nothing changes: the build reads every edge, as before. Over it, each
 * source page keeps at most its share of edges, edges to the crawl's own pages first (`rowAddresses`:
 * a row's URL, or where it landed), then edges to addresses the crawl never fetched, in the order the
 * worker recorded them; the total held is at most MAX_CHECK_EDGES whatever the pages or links. A page
 * whose edges were cut keeps its true `links_out` on its row, so the detectors read its links as not
 * fully recorded (`linksIncomplete` in detectors/scope.ts) and claim no orphan they cannot prove.
 */
import type { CrawlPage, LinkEdge } from '@crawlmouse/types/v2';
import { canonicalizeUrl } from '../../url-canonical.js';

export const MAX_CHECK_EDGES = 50_000;
/** Of a page's share over the bound, what links to the crawl's own pages may take. */
const OWN_SHARE = 0.8;

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

/** What a page over the bound may keep: to the crawl's own pages, and to the rest. */
export interface EdgeQuota {
  own: number;
  other: number;
}

/** The per-page quota for a check of `pages` rows over the bound `cap`. */
export function edgeQuota(pages: number, cap: number = MAX_CHECK_EDGES): EdgeQuota {
  const each = Math.floor(cap / Math.max(1, pages));
  const own = Math.floor(each * OWN_SHARE);
  return { own, other: each - own };
}

/**
 * A batch's edges within the quota, given what each source page has kept so far (`kept`, updated):
 * edges to `addresses` take the page's `own` share, the rest its `other` share, in recorded order.
 */
export function boundedEdges(
  edges: readonly LinkEdge[],
  addresses: ReadonlySet<string>,
  quota: EdgeQuota,
  kept: Map<string, EdgeQuota>,
): LinkEdge[] {
  const out: LinkEdge[] = [];
  for (const e of edges) {
    const k = kept.get(e.from_url) ?? { own: 0, other: 0 };
    const own = addresses.has(e.to_url);
    if (own ? k.own >= quota.own : k.other >= quota.other) continue;
    if (own) k.own++;
    else k.other++;
    kept.set(e.from_url, k);
    out.push(e);
  }
  return out;
}
