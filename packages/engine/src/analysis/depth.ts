import type { SiteGraph } from '../graph.js';

export function computeDepth(graph: SiteGraph, homepageUrl: string): Map<string, number> {
  const depths = new Map<string, number>();
  if (graph.order === 0) return depths;

  // Normally BFS roots at the homepage. If the homepage node is absent (e.g. the
  // homepage 403'd or served non-HTML while sitemap pages crawled fine), rooting
  // only at the homepage would mark every page unreachable and produce a wildly
  // wrong F. Fall back to all source nodes (in-degree 0), or any node if the graph
  // is fully cyclic, so reachability still reflects the real link structure.
  let roots: string[];
  if (graph.hasNode(homepageUrl)) {
    roots = [homepageUrl];
  } else {
    roots = graph.nodes().filter((n) => graph.inDegree(n) === 0);
    if (roots.length === 0) roots = [graph.nodes()[0]!];
  }

  const queue: string[] = [];
  for (const r of roots) {
    depths.set(r, 0);
    queue.push(r);
  }
  while (queue.length > 0) {
    const node = queue.shift()!;
    const d = depths.get(node)!;
    graph.forEachOutNeighbor(node, (neighbor) => {
      if (!depths.has(neighbor)) {
        depths.set(neighbor, d + 1);
        queue.push(neighbor);
      }
    });
  }
  return depths;
}
