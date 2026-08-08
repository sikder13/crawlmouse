import Graph from 'graphology';
import type { CrawledPage, CrawledLink } from './crawler.js';

export interface PageNodeAttrs {
  urlHash: string;
  title?: string;
  statusCode: number;
}

export interface LinkEdgeAttrs {
  anchorText: string;
  isGenericAnchor: boolean;
}

export type SiteGraph = Graph<PageNodeAttrs, LinkEdgeAttrs>;

export function buildGraph(pages: CrawledPage[], links: CrawledLink[]): SiteGraph {
  const g: SiteGraph = new Graph({ type: 'directed', multi: false, allowSelfLoops: false });
  // SPEC 5.1a M6 — nodes are inserted in canonical-URL order, NEVER in the order they were fetched.
  //
  // This is the root cause of an I1 violation that has nothing to do with the frontier. Node
  // insertion order is `crawlOut.pages` order, which is FETCH-COMPLETION order; graphology preserves
  // it, `graphology-pagerank` iterates in it, and floating-point addition is not associative — so the
  // same graph summed in a different order produces slightly different ranks (measured:
  // 0.9727594706314373 vs 0.972759470631438 on a symmetric fixture). That difference flows straight
  // into hubConcentration, which is 0.6 of the structure component.
  //
  // Sorting here removes arrival order from the graph entirely, which fixes the rank values, the hub
  // tie-break and the depth fallback root at their common source. The explicit tie-breaks downstream
  // are belt-and-braces for callers that build a graph another way.
  for (const p of [...pages].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))) {
    g.addNode(p.url, { urlHash: p.urlHash, title: p.title, statusCode: p.statusCode });
  }
  for (const l of links) {
    if (!g.hasNode(l.fromUrl) || !g.hasNode(l.toUrl)) continue;
    if (l.fromUrl === l.toUrl) continue;
    if (g.hasEdge(l.fromUrl, l.toUrl)) continue;
    g.addDirectedEdge(l.fromUrl, l.toUrl, { anchorText: l.anchorText, isGenericAnchor: l.isGenericAnchor });
  }
  return g;
}
