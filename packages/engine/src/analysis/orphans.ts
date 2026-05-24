import type { SiteGraph } from '../graph.js';

export interface OrphanResult {
  orphans: string[];
  nearOrphans: string[];
  orphanRatio: number;
}

export function detectOrphans(graph: SiteGraph, homepageUrl: string): OrphanResult {
  const orphans: string[] = [];
  const nearOrphans: string[] = [];
  graph.forEachNode((node) => {
    if (node === homepageUrl) return;
    const inDeg = graph.inDegree(node);
    if (inDeg === 0) orphans.push(node);
    else if (inDeg <= 2) nearOrphans.push(node);
  });
  return {
    orphans,
    nearOrphans,
    orphanRatio: graph.order > 0 ? orphans.length / graph.order : 0,
  };
}
