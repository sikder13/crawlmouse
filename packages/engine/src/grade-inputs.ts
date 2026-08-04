import type { SiteGraph } from './graph.js';
import type { GradeInputs } from './grade.js';
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
  /**
   * SPEC 5.1a Stage 4: internal links actually OBSERVED into the gradeable population. Zero means
   * every ratio above was computed over an empty edge set and measured nothing — which is a
   * different statement from a ratio that measured zero, and the one `computeGrade` needs in order
   * to stop an empty graph scoring full marks.
   */
  observedEdgeCount: number;
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
/**
 * The ONLY sanctioned way to turn a `GraphAnalysis` into `GradeInputs`.
 *
 * This exists because the spread it replaces was duplicated at three call sites — the base grade, the
 * projection re-grade and a test helper — so every new input had to be added in three places, and
 * missing one produced no error at all. Stage 4 found that the hard way: wiring the evidence
 * denominators into two of the three made the projection disagree with the grade it was projecting
 * from, and the symptom was an unrelated-looking assertion about a null free fix.
 *
 * A derivation that must be kept in sync by hand is not a single source of truth. Add new inputs HERE.
 */
export function gradeInputsFrom(ga: GraphAnalysis, pageCount?: number): GradeInputs {
  return {
    orphanRatio: ga.orphanRatio,
    pagesBeyondDepth3Fraction: ga.pagesBeyondDepth3Fraction,
    unreachableFraction: ga.unreachableFraction,
    meanAnchorHHI: ga.meanAnchorHHI,
    genericAnchorFraction: ga.genericAnchorFraction,
    hubConcentration: ga.hubConcentration,
    hubReachability: ga.hubReachability,
    observedEdgeCount: ga.observedEdgeCount,
    gradeablePageCount: ga.gradeableCount,
    ...(pageCount === undefined ? {} : { pageCount }),
  };
}

export function deriveGradeInputs(graph: SiteGraph, opts: DeriveGradeInputsOpts): GraphAnalysis {
  const { homepageUrl, isGradeable, jsRendered } = opts;

  // THE POPULATION. Every ratio below is over this set, while every GRAPH operation (in-degree, BFS,
  // PageRank) runs over all nodes. `detectOrphans` reads in-degree from the full graph, so a content
  // page whose only inbound link comes from an excluded archive is correctly NOT an orphan.
  const gradeableNodes = graph.nodes().filter(isGradeable);
  const gradeableCount = gradeableNodes.length;
  const denom = gradeableCount > 0 ? gradeableCount : 1;

  // Stage 4: count the edges that could have informed ANY ratio below — those arriving at a page in
  // the graded population. Counted here, beside the population itself, because this is the single
  // derivation both the base grade and the projection re-grade share; deriving it at either call
  // site would let one of them drift.
  let observedEdgeCount = 0;
  graph.forEachEdge((_edge, _attrs, _source, target) => {
    if (isGradeable(target)) observedEdgeCount += 1;
  });

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
  // Both anchor metrics are restricted to gradeable TARGETS. An over-optimized-anchor finding against
  // a tag archive is noise, and averaging archives into the mean moves the score for a page nobody is
  // being advised about. Owner ruling: the two must share one population — two halves of one grade
  // component computed over different sets is a latent bug generator.
  const hhiMap = new Map([...perTargetHHI(graph)].filter(([url]) => isGradeable(url)));
  const meanAnchorHHI = hhiMap.size > 0 ? Array.from(hhiMap.values()).reduce((a, b) => a + b, 0) / hhiMap.size : 0;
  const genericFrac = genericAnchorFraction(graph, isGradeable);

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
    observedEdgeCount,
    depths,
    ranks,
    hhiMap,
  };
}
