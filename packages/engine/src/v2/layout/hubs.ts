/**
 * The map a finished check stores: not every page, but the site's hubs and what they link to, laid
 * out by the same layout as the crawl screen (force-layout.ts).
 *
 * - A hub is a page with at least HUB_MIN_INBOUND inbound links. Hubs come first, most-linked first
 *   (URL breaks ties), then the pages hubs link to, in the same order, until HUB_MAP_CAP nodes.
 * - The home page (the page at depth 0) is always kept, and counts towards the cap.
 * - Each kept page hangs from its nearest kept ancestor on a breadth-first tree of the check's links
 *   from the home page, and its depth is its depth on that tree, so the two never disagree. `via`
 *   says whether the link that reached it on that tree was made by JavaScript.
 * - As on the crawl screen (apps/web/lib/v2/map-layout.ts, `layoutInput`), a page no link path from
 *   the home page reaches is left out unless it is an orphan or JavaScript-only, which the layout
 *   draws in the band across the top. A page left out is not a candidate, so it takes no place
 *   under the cap.
 *
 * The result depends only on the pages and links given, not on the order they are listed in; a URL
 * listed twice among the pages is refused, as the contract keys a check's pages by URL.
 */
import type { LinkEdge, PageResult } from '@crawlmouse/types/v2';
import type { LayoutNode } from './force-layout.js';

export const HUB_MIN_INBOUND = 3;
export const HUB_MAP_CAP = 150;

export type MapPage = Pick<PageResult, 'url' | 'depth' | 'links_in' | 'is_orphan' | 'js_only'>;
export type MapLink = Pick<LinkEdge, 'from_url' | 'to_url' | 'js_only'>;

const byUrl = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function hubsAndNeighbours(
  pages: readonly MapPage[],
  links: readonly MapLink[],
  cap: number = HUB_MAP_CAP,
): LayoutNode[] {
  const page = new Map(pages.map((p) => [p.url, p]));
  // A check has one PageResult per URL; a second would make the result depend on which came last.
  if (page.size !== pages.length) throw new Error('hubsAndNeighbours: a URL is listed twice');
  const mostLinked = (a: MapPage, b: MapPage) => b.links_in - a.links_in || byUrl(a.url, b.url);
  const outgoing = new Map<string, MapLink[]>();
  for (const l of [...links].sort(
    (a, b) => byUrl(a.from_url, b.from_url) || byUrl(a.to_url, b.to_url) || +a.js_only - +b.js_only,
  )) {
    if (!outgoing.has(l.from_url)) outgoing.set(l.from_url, []);
    outgoing.get(l.from_url)!.push(l);
  }

  const home = [...page.values()].filter((p) => p.depth === 0).sort(mostLinked)[0];
  // The breadth-first tree from the home page: each page's first link, in URL order.
  const reachedBy = new Map<string, MapLink | null>(home ? [[home.url, null]] : []);
  const depth = new Map<string, number>(home ? [[home.url, 0]] : []);
  for (let queue = home ? [home.url] : [], k = 0; k < queue.length; k++) {
    const from = queue[k]!;
    for (const l of outgoing.get(from) ?? []) {
      if (reachedBy.has(l.to_url)) continue;
      reachedBy.set(l.to_url, l);
      depth.set(l.to_url, depth.get(from)! + 1);
      queue.push(l.to_url);
    }
  }
  const kindOf = (p: MapPage) => (p.js_only ? 'js_only' : p.is_orphan ? 'orphan' : 'page');
  // A page no link path from home reaches is drawn only as an orphan or JavaScript-only page, so a
  // plain one is not a candidate: it would take a place under the cap and then not be drawn.
  const drawn = (p: MapPage) => depth.has(p.url) || kindOf(p) !== 'page';
  const kept = new Set<string>(home ? [home.url] : []);
  const hubs = [...page.values()]
    .filter((p) => p.links_in >= HUB_MIN_INBOUND && p !== home && drawn(p))
    .sort(mostLinked);
  for (const hub of hubs) if (kept.size < cap) kept.add(hub.url);
  const neighbours = [
    ...new Set(
      hubs
        .filter((h) => kept.has(h.url))
        .flatMap((h) => (outgoing.get(h.url) ?? []).map((l) => l.to_url)),
    ),
  ]
    .map((u) => page.get(u))
    .filter((p): p is MapPage => p !== undefined && !kept.has(p.url) && drawn(p))
    .sort(mostLinked);
  for (const n of neighbours) if (kept.size < cap) kept.add(n.url);

  const keptAncestor = (u: string): string | null => {
    for (let l = reachedBy.get(u); l; l = reachedBy.get(l.from_url)) {
      if (kept.has(l.from_url)) return l.from_url;
    }
    return null;
  };

  const nodes: LayoutNode[] = [];
  for (const u of [...kept].sort(byUrl)) {
    const p = page.get(u)!;
    const kind = kindOf(p);
    const reached = depth.has(u);
    const by = reachedBy.get(u);
    nodes.push({
      id: u,
      parent: reached ? keptAncestor(u) : null,
      depth: depth.get(u) ?? null,
      kind,
      via: by ? (by.js_only ? 'javascript' : 'link') : null,
    });
  }
  return nodes;
}
