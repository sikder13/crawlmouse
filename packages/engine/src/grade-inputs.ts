import type { SiteGraph } from './graph.js';
import { detectOrphans } from './analysis/orphans.js';
import { computeDepth } from './analysis/depth.js';
import { perTargetHHI, genericAnchorFraction } from './analysis/anchor.js';
import { computePageRank } from './analysis/pagerank.js';
import { hubConcentrationScore, hubReachabilityScore } from './analysis/structure.js';
import { MAX_HEALTHY_DEPTH } from './constants.js';

/**
 * The graph-derived grade inputs PLUS the intermediates that findings emission (audit.ts) and the
 * SPEC 02 §3 projection (projection/) reuse. `orphanRatio` is already the JS-adjusted value fed to
 * `computeGrade` (0 on a JS-rendered site); `filteredOrphans` is the raw filtered orphan set for the
 * findings/ledger.
 */
export interface GraphAnalysis {
  // The seven graph-derived `GradeInputs` fields (ready to spread into computeGrade):
  orphanRatio: number;
  pagesBeyondDepth3Fraction: number;
  unreachableFraction: number;
  meanAnchorHHI: number;
  genericAnchorFraction: number;
  hubConcentration: number;
  hubReachability: number;
  // Intermediates reused by findings emission + the projection ledger (computed once):
  filteredOrphans: string[];
  rawOrphanSet: Set<string>;
  filteredOrphanSet: Set<string>;
  depths: Map<string, number>;
  ranks: Map<string, number>;
  hhiMap: Map<string, number>;
}

export interface DeriveGradeInputsOpts {
  /** Canonical homepage identity — the BFS root for depth + the orphan seed. */
  homepageUrl: string;
  /** CMS-utility-path exclusion predicate (e.g. /cart, /wp-admin) from getAdjustments. */
  isExcluded: (u: string) => boolean;
  /** A4 JS/SPA homepage: forces the grade's orphanRatio to 0 (false orphans suppressed). */
  jsRendered: boolean;
}

/**
 * Single source of truth for the graph → `GradeInputs` derivation. Extracted VERBATIM from
 * `analyzeCrawl` so the base grade AND the SPEC 02 §3 projection re-grade run the IDENTICAL
 * derivation — otherwise a per-fix marginal delta would be polluted by derivation drift, not the
 * fix. Behavior-preserving: same expressions, same order, same values. Pure (no network).
 */
export function deriveGradeInputs(graph: SiteGraph, opts: DeriveGradeInputsOpts): GraphAnalysis {
  const { homepageUrl, isExcluded, jsRendered } = opts;

  const orphanResult = detectOrphans(graph, homepageUrl);
  const rawOrphanSet = new Set(orphanResult.orphans);
  const filteredOrphans = orphanResult.orphans.filter((u) => !isExcluded(u));
  const filteredOrphanSet = new Set(filteredOrphans);
  const orphanRatio = graph.order > 0 ? filteredOrphans.length / graph.order : 0;

  // Depth + reachability. Count "too deep" and "unreachable" only over pages that actually count
  // toward the score: skip CMS utility paths entirely, and skip raw orphans from the unreachable
  // tally (an orphan is unreachable by definition and already penalized via orphanRatio — counting
  // it in both dimensions would double-penalize the same defect).
  const depths = computeDepth(graph, homepageUrl);
  let beyond3 = 0;
  let unreachable = 0;
  for (const node of graph.nodes()) {
    if (isExcluded(node)) continue;
    const d = depths.get(node);
    if (d === undefined) {
      if (!rawOrphanSet.has(node)) unreachable += 1;
    } else if (d > MAX_HEALTHY_DEPTH) {
      beyond3 += 1;
    }
  }
  const denom = graph.order > 0 ? graph.order : 1;
  const pagesBeyondDepth3Fraction = beyond3 / denom;
  const unreachableFraction = unreachable / denom;

  // Anchor analysis.
  const hhiMap = perTargetHHI(graph);
  const meanAnchorHHI = hhiMap.size > 0 ? Array.from(hhiMap.values()).reduce((a, b) => a + b, 0) / hhiMap.size : 0;
  const genericFrac = genericAnchorFraction(graph);

  // PageRank + structure (A5). Structure rewards a healthy authority topology: PageRank concentrated
  // on a small hub tier, and those hubs reachable from the homepage within the healthy click budget.
  const ranks = computePageRank(graph);
  const hubConcentration = hubConcentrationScore(ranks);
  const hubReachability = hubReachabilityScore(ranks, depths, MAX_HEALTHY_DEPTH);

  // A4: on a JS-rendered homepage the static crawl can't see the real link graph, so the measured
  // orphanRatio is a false positive. Feed the grade a 0 orphan ratio; depth/anchor/structure unchanged.
  return {
    orphanRatio: jsRendered ? 0 : orphanRatio,
    pagesBeyondDepth3Fraction,
    unreachableFraction,
    meanAnchorHHI,
    genericAnchorFraction: genericFrac,
    hubConcentration,
    hubReachability,
    filteredOrphans,
    rawOrphanSet,
    filteredOrphanSet,
    depths,
    ranks,
    hhiMap,
  };
}
