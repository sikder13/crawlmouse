/**
 * Structure scoring (A5). The structure dimension rewards a HEALTHY authority
 * topology: a small set of well-linked hub pages that concentrate PageRank, and
 * that the user can actually reach from the homepage within a few clicks.
 *
 * This deliberately REPLACES the old `1 - pageRankGini` formulation, which had the
 * sign backwards: a low Gini means PageRank is spread evenly across every page,
 * which is what a FLAT, hub-less, fragmented site looks like — and the old code
 * scored that as "good". Real, well-siloed sites concentrate authority on category
 * / hub pages; that concentration is a positive signal, not a defect. Over-
 * concentration (one lone hub with everything else orphaned) saturates this score
 * at 1, but that pathology is caught separately by orphanRatio, which carries the
 * heaviest weight in the grade.
 */

// Local clamp. grade.ts has its own private clamp; we duplicate the one-liner here
// rather than export it so each module owns its numeric guard and there is no
// cross-module coupling for a trivial helper.
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

/** Fraction of the link graph treated as the "top hubs" tier. */
const TOP_HUB_FRACTION = 0.05;

/**
 * The top-5% PageRank share a site should reach to earn full marks. A perfectly flat
 * graph's top-5% share equals 5% (the baseline); we rescale [baseline .. TARGET] to
 * [0 .. 1], so a site only scores well once its hubs hold meaningfully more authority
 * than an even spread would give them.
 */
const TARGET_TOP_SHARE = 0.5;

/**
 * 0..1 — how much PageRank authority concentrates on the top hub tier, rescaled so a
 * flat (hub-less) graph scores ~0 and a graph with real, dominant hubs scores ~1.
 */
export function hubConcentrationScore(ranks: Map<string, number>): number {
  const N = ranks.size;
  // Degenerate: with fewer than two nodes there is no topology to judge. Return a
  // neutral 1 — the A3 coverage cap is what governs the grade of a tiny crawl, so
  // this dimension must not independently drag (or inflate) it.
  if (N < 2) return 1;

  const topCount = Math.max(1, Math.ceil(TOP_HUB_FRACTION * N));
  const values = Array.from(ranks.values());
  const total = values.reduce((s, v) => s + v, 0);
  // No authority at all (every rank 0), or a non-finite total (a NaN/Infinity rank — not
  // reachable from graphology-pagerank, but a caller could pass one): nothing meaningful to
  // concentrate, and the [0,1] contract must never leak a NaN. Degrade to the neutral 1.
  if (!Number.isFinite(total) || total <= 0) return 1;

  // Share of total PageRank held by the topCount largest-ranked pages.
  const sorted = [...values].sort((a, b) => b - a);
  const topSum = sorted.slice(0, topCount).reduce((s, v) => s + v, 0);
  const topShare = topSum / total;

  // A perfectly FLAT graph gives each node 1/N, so the top-5% tier holds exactly
  // topCount/N of the authority. That is the "no hubs" baseline -> score 0.
  const baseline = topCount / N;

  // Tiny graphs where the baseline already meets/exceeds the target (so the rescale
  // would divide by <= 0) cannot fail this test by construction -> full marks.
  if (baseline >= TARGET_TOP_SHARE) return 1;

  // Rescale [baseline .. TARGET] -> [0 .. 1]. Flat graph ~0 (no hubs); concentration
  // toward real hubs -> 1; over-concentration saturates at 1 and is penalized instead
  // by orphanRatio (a single lone hub leaves the rest of the site orphaned).
  return clamp((topShare - baseline) / (TARGET_TOP_SHARE - baseline), 0, 1);
}

/**
 * 0..1 — fraction of the top hub tier that is actually reachable from the homepage
 * within `maxDepth` clicks. A site can concentrate authority correctly yet still bury
 * its hubs too deep to be useful; this catches that. Hubs with no defined depth (truly
 * unreachable) count against the score.
 */
export function hubReachabilityScore(
  ranks: Map<string, number>,
  depths: Map<string, number>,
  maxDepth: number,
): number {
  const N = ranks.size;
  // Degenerate graph -> neutral 1 (see hubConcentrationScore).
  if (N < 2) return 1;

  const topCount = Math.max(1, Math.ceil(TOP_HUB_FRACTION * N));
  const hubs = Array.from(ranks.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topCount)
    .map(([url]) => url);

  let reachable = 0;
  for (const u of hubs) {
    const d = depths.get(u);
    // Defined depth (reachable from the homepage) AND within the healthy click budget.
    if (d !== undefined && d <= maxDepth) reachable += 1;
  }
  return reachable / hubs.length;
}
