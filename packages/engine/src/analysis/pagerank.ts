import pagerank from 'graphology-pagerank';
import type { SiteGraph } from '../graph.js';

export function computePageRank(graph: SiteGraph): Map<string, number> {
  const scores = pagerank(graph, { alpha: 0.85, maxIterations: 100, tolerance: 1e-6 });
  return new Map(Object.entries(scores));
}

export function giniCoefficient(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const total = sorted.reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  let cumulative = 0;
  for (let i = 0; i < n; i++) cumulative += (i + 1) * sorted[i]!;
  return (2 * cumulative) / (n * total) - (n + 1) / n;
}
