import pagerank from 'graphology-pagerank';
import type { SiteGraph } from '../graph.js';

// Standard PageRank parameters. alpha=0.85 is the canonical damping factor;
// the library stops early once successive iterations differ by < tolerance,
// so maxIterations is only a safety ceiling (convergence on a 2k-node graph
// is well under this).
const PAGERANK_DAMPING = 0.85;
const PAGERANK_MAX_ITERATIONS = 100;
const PAGERANK_TOLERANCE = 1e-6;

export function computePageRank(graph: SiteGraph): Map<string, number> {
  // graphology-pagerank throws "failed to converge" on an empty graph. An empty
  // graph is a real outcome (every seed blocked / non-HTML / failed), so return
  // an empty ranking instead of aborting the whole audit.
  if (graph.order === 0) return new Map();
  const scores = pagerank(graph, {
    alpha: PAGERANK_DAMPING,
    maxIterations: PAGERANK_MAX_ITERATIONS,
    tolerance: PAGERANK_TOLERANCE,
  });
  return new Map(Object.entries(scores));
}

// NOTE: the grade's structure score no longer uses Gini (see analysis/structure.ts — it now
// rewards hub concentration + reachability, fixing the old sign-inverted `1 - gini`). This is
// retained as a reusable, separately-tested statistic; it is intentionally not wired into the grade.
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
