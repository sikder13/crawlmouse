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
  /** SPEC 5.1a M9: size of the gradeable POPULATION — the denominator of every ratio above. */
  gradeableCount: number;
  depths: Map<string, number>;
  ranks: Map<string, number>;
  hhiMap: Map<string, number>;
}

export interface DeriveGradeInputsOpts {
  /** Canonical homepage identity — the BFS root for depth + the orphan seed. */
  homepageUrl: string;
  /**
   * SPEC 5.1a M9 — the gradeable-POPULATION predicate (replaces the old `isExcluded`, whose sense was
   * inverted and whose effect was numerator-only).
   *
   * A node for which this is false leaves the numerator AND the denominator of the orphan, depth and
   * anchor statistics, but STAYS IN THE GRAPH: in-degree, BFS depth and PageRank are all computed over
   * every node. Both halves are required and they pull opposite ways — drop archives from the graph
   * and a post reachable only through one becomes a false orphan; leave stubs in the denominator and a
   * junk-diluted site reads as well-linked.
   */
  isGradeable: (u: string) => boolean;
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
  const { homepageUrl, isGradeable, jsRendered } = opts;

  // THE POPULATION. Every ratio below is over this set, while every GRAPH operation (in-degree, BFS,
  // PageRank) runs over all nodes. `detectOrphans` reads in-degree from the full graph, so a content
  // page whose only inbound link comes from an excluded archive is correctly NOT an orphan.
  const gradeableNodes = graph.nodes().filter(isGradeable);
  const gradeableCount = gradeableNodes.length;
  const denom = gradeableCount > 0 ? gradeableCount : 1;

  const orphanResult = detectOrphans(graph, homepageUrl);
  const rawOrphanSet = new Set(orphanResult.orphans);
  const filteredOrphans = orphanResult.orphans.filter(isGradeable);
  const filteredOrphanSet = new Set(filteredOrphans);
  const orphanRatio = gradeableCount > 0 ? filteredOrphans.length / gradeableCount : 0;

  // Depth + reachability. Count "too deep" and "unreachable" only over pages that actually count
  // toward the score: skip CMS utility paths entirely, and skip raw orphans from the unreachable
  // tally (an orphan is unreachable by definition and already penalized via orphanRatio — counting
  // it in both dimensions would double-penalize the same defect).
  // Depth is measured over the FULL graph — a post three archives deep is genuinely four clicks away,
  // and computing depth over the gradeable subgraph alone would report it unreachable. Only the
  // COUNTING is restricted to the population.
  const depths = computeDepth(graph, homepageUrl);
  let beyond3 = 0;
  let unreachable = 0;
  for (const node of gradeableNodes) {
    const d = depths.get(node);
    if (d === undefined) {
      if (!rawOrphanSet.has(node)) unreachable += 1;
    } else if (d > MAX_HEALTHY_DEPTH) {
      beyond3 += 1;
    }
  }
  const pagesBeyondDepth3Fraction = beyond3 / denom;
  const unreachableFraction = unreachable / denom;

  // Anchor analysis.
  // Anchor concentration is restricted to gradeable TARGETS: an over-optimized-anchor finding against
  // a tag archive is noise, and averaging archives into the mean moves the score for a page nobody is
  // being advised about. `genericAnchorFraction` stays site-wide — it describes how the site writes
  // anchors, which is a property of the whole site including its navigation.
  const hhiMap = new Map([...perTargetHHI(graph)].filter(([url]) => isGradeable(url)));
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
    gradeableCount,
    depths,
    ranks,
    hhiMap,
  };
}
