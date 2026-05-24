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
  for (const p of pages) {
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
