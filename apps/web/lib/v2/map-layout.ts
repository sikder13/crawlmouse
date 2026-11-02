/**
 * The link map's layout on the web side: the adapter from the crawl state to the layout's input.
 * The layout itself is the engine's (packages/engine/src/v2/layout/force-layout.ts), the one module
 * the server and the crawl screen's Web Worker both run, re-exported here for the screens.
 */
import type { LayoutNode } from '@crawlmouse/engine/v2/layout';
import type { MapNode } from './progress';

export * from '@crawlmouse/engine/v2/layout';

/** A site's home page: the origin and nothing after its slash. */
const HOME = /^https?:\/\/[^/]+\/$/;

/**
 * The layout's input from the crawl state: each page a link path from the home page reaches, with
 * its parent and click depth, and each page classified orphan or JavaScript-only. A page the crawl
 * fetched before any link reached it (from the sitemap, say) is not drawn until one does, so it
 * appears beside the page whose link reached it.
 */
export function layoutInput(nodes: readonly MapNode[]): LayoutNode[] {
  const byUrl = new Map(nodes.map((n) => [n.url, n]));
  const depth = new Map<string, number | null>();
  const depthOf = (url: string, guard: number): number | null => {
    if (depth.has(url)) return depth.get(url)!;
    const n = byUrl.get(url);
    let d: number | null = null;
    if (n && HOME.test(url)) d = 0;
    else if (n?.from && byUrl.has(n.from) && guard < nodes.length) {
      const up = depthOf(n.from, guard + 1);
      d = up === null ? null : up + 1;
    }
    depth.set(url, d);
    return d;
  };
  return nodes
    .map((n) => ({
      id: n.url,
      parent: n.from && byUrl.has(n.from) ? n.from : null,
      depth: depthOf(n.url, 0),
      kind: n.kind,
      via: n.via,
    }))
    .filter((n) => n.depth !== null || n.kind !== 'page')
    .map((n) => (n.depth === null ? { ...n, parent: null } : n));
}
