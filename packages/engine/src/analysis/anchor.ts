import type { SiteGraph } from '../graph.js';

export function anchorHHI(anchors: string[]): number {
  if (anchors.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const a of anchors) {
    const k = a.trim().toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const total = anchors.length;
  let hhi = 0;
  for (const c of counts.values()) hhi += Math.pow(c / total, 2);
  return hhi;
}

export function perTargetHHI(graph: SiteGraph): Map<string, number> {
  const out = new Map<string, number>();
  graph.forEachNode((node) => {
    const anchors: string[] = [];
    graph.forEachInEdge(node, (_e, attrs) => {
      if (attrs.anchorText) anchors.push(attrs.anchorText);
    });
    if (anchors.length >= 3) out.set(node, anchorHHI(anchors));
  });
  return out;
}

export function genericAnchorFraction(graph: SiteGraph): number {
  let total = 0;
  let generic = 0;
  graph.forEachEdge((_e, attrs) => {
    total += 1;
    if (attrs.isGenericAnchor) generic += 1;
  });
  return total === 0 ? 0 : generic / total;
}
