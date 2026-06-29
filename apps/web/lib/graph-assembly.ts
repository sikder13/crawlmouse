import type { GraphData, GraphNode, GraphEdge } from '@crawlmouse/types';

// Tunable graph caps (SPEC 02 v1.2). A force-directed graph stays readable to a few hundred nodes and
// becomes an unreadable hairball past that — readability is the point. Free is capped more aggressively
// (a natural Pro upsell); Pro sees a fuller graph. Edges are additionally capped for render performance.
export const FREE_GRAPH_NODE_CAP = 150;
export const PRO_GRAPH_NODE_CAP = 600;
export const GRAPH_EDGE_CAP = 1500;

/** DB-shaped graph inputs (from the persisted gradeable `pages` + resolved `links`). */
export interface RawGraphNode {
  url: string;
  title: string | null;
  depth: number | null;
  isOrphan: boolean;
  pagerank: number; // raw 0..1 (Page.pagerank)
  inboundCount: number; // in_degree
  outboundCount: number; // out_degree
}
export interface RawGraphEdge {
  fromUrl: string;
  toUrl: string;
}

export interface AssembleGraphOpts {
  /** The audit's start URL (matched against node.url; a depth-0 node is the canonical fallback). */
  homepageUrl: string;
  /** The site tripped the JS/SPA detector (the js_rendered finding) — drives the per-node reachability signal. */
  siteJsRendered: boolean;
  nodeCap: number; // FREE_GRAPH_NODE_CAP or PRO_GRAPH_NODE_CAP
  isFreeTier: boolean; // drives capReason ('free_tier' vs 'readability')
  edgeCap?: number; // default GRAPH_EDGE_CAP
}

const byUrlAsc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const edgeKey = (e: RawGraphEdge): string => `${e.fromUrl}\n${e.toUrl}`;

/**
 * Assemble a CAPPED, DETERMINISTIC `GraphData` from the static crawl's persisted nodes/edges. No new
 * fetch and no JS rendering — `jsOnly` is a reachability signal (see GraphNode.jsOnly), not literal JS.
 * Same input → same output.
 *
 * Selection: top-`nodeCap` by (pagerank desc, url asc); the homepage is ALWAYS included (swapped in for
 * the lowest-ranked node otherwise — it's the anchor of the visual). Edges are deduped to unique directed
 * pairs, kept only between included nodes, then capped to `edgeCap` by (endpoint-pagerank-sum desc, from
 * asc, to asc). The true pre-cap totals are always reported so the UI can say "showing N of M".
 */
export function assembleGraph(nodes: RawGraphNode[], edges: RawGraphEdge[], opts: AssembleGraphOpts): GraphData {
  const { homepageUrl, siteJsRendered, nodeCap, isFreeTier } = opts;
  const edgeCap = opts.edgeCap ?? GRAPH_EDGE_CAP;

  const totalNodes = nodes.length;
  // Dedup links → unique directed pairs (a page may link another via several anchors = several link rows,
  // but the graph has one edge). totalEdges is the true pre-cap unique-edge count.
  const uniqueEdges = new Map<string, RawGraphEdge>();
  for (const e of edges) if (!uniqueEdges.has(edgeKey(e))) uniqueEdges.set(edgeKey(e), e);
  const totalEdges = uniqueEdges.size;

  const isHome = (n: RawGraphNode): boolean => n.url === homepageUrl || n.depth === 0;

  // Deterministic ranking: pagerank desc, then url asc to break ties.
  const ranked = [...nodes].sort((a, b) => b.pagerank - a.pagerank || byUrlAsc(a.url, b.url));
  let selected = ranked.slice(0, nodeCap);

  // The homepage anchors the visual — always keep it. If the cap excluded it, swap it in for the
  // lowest-ranked selected node.
  if (nodeCap < totalNodes && !selected.some(isHome)) {
    const home = ranked.find(isHome);
    if (home) selected = [...selected.slice(0, Math.max(0, nodeCap - 1)), home];
  }

  const selectedUrls = new Set(selected.map((n) => n.url));
  const rawPr = new Map(nodes.map((n) => [n.url, n.pagerank]));
  const maxPr = selected.reduce((m, n) => Math.max(m, n.pagerank), 0);

  const outNodes: GraphNode[] = selected
    .map((n) => ({
      id: n.url,
      url: n.url,
      title: n.title,
      depth: n.depth,
      isHomepage: isHome(n),
      isOrphan: n.isOrphan,
      pagerank: maxPr > 0 ? n.pagerank / maxPr : 0, // max-normalized node size (top hub = 1)
      jsOnly: siteJsRendered && n.inboundCount === 0, // reachability signal (see GraphNode.jsOnly doc)
      inboundCount: n.inboundCount,
      outboundCount: n.outboundCount,
    }))
    .sort((a, b) => b.pagerank - a.pagerank || byUrlAsc(a.url, b.url));

  // Edges only between included nodes, deterministically ordered, then edge-capped for performance.
  const amongSelected = [...uniqueEdges.values()]
    .filter((e) => selectedUrls.has(e.fromUrl) && selectedUrls.has(e.toUrl))
    .sort((a, b) => {
      const pa = (rawPr.get(a.fromUrl) ?? 0) + (rawPr.get(a.toUrl) ?? 0);
      const pb = (rawPr.get(b.fromUrl) ?? 0) + (rawPr.get(b.toUrl) ?? 0);
      return pb - pa || byUrlAsc(a.fromUrl, b.fromUrl) || byUrlAsc(a.toUrl, b.toUrl);
    });
  const outEdges: GraphEdge[] = amongSelected.slice(0, edgeCap).map((e) => ({ from: e.fromUrl, to: e.toUrl, nofollow: false }));

  const nodesCapped = selected.length < totalNodes;
  const edgesCapped = outEdges.length < totalEdges;
  let capReason: GraphData['capReason'] = 'none';
  if (nodesCapped) capReason = isFreeTier ? 'free_tier' : 'readability';
  else if (edgesCapped) capReason = 'performance';

  return {
    nodes: outNodes,
    edges: outEdges,
    totalNodes,
    totalEdges,
    capped: nodesCapped || edgesCapped,
    capReason,
  };
}
