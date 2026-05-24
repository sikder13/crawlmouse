import type { SiteGraph } from '../graph.js';

export function computeDepth(graph: SiteGraph, homepageUrl: string): Map<string, number> {
  const depths = new Map<string, number>();
  if (!graph.hasNode(homepageUrl)) return depths;
  depths.set(homepageUrl, 0);
  const queue: string[] = [homepageUrl];
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
