import { describe, it, expect } from 'vitest';
import { buildGraph } from '../graph.js';
import { computePageRank } from './pagerank.js';
import { computeDepth } from './depth.js';
import { hubReachabilityScore, hubConcentrationScore } from './structure.js';
import { MAX_HEALTHY_DEPTH } from '../constants.js';
import type { CrawledPage, CrawledLink } from '../crawler.js';

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a M6 — an I1 violation INDEPENDENT of the frontier.
//
// `hubReachabilityScore` sorts PageRank entries descending and slices the top 5%. V8's sort is
// STABLE, so tied ranks keep their Map insertion order — which is graph node order, which is
// `crawlOut.pages` order, which is FETCH-COMPLETION order. Identical discovered set + different
// arrival order therefore yields a different hub set, a different reachability score, and a
// different grade through a component weighted 20.
//
// Fixing the frontier alone does NOT deliver I1: the frontier decides WHICH pages are fetched, and
// this decides what the grade does with them once fetched. Both have to be deterministic.
//
// These tests permute ARRIVAL ORDER ONLY. The page set, the links and the graph are identical in
// every permutation — the only thing that changes is the order the crawler happened to finish in.
// ─────────────────────────────────────────────────────────────────────────────

const HOME = 'https://s.test';
const page = (url: string): CrawledPage => ({ url, urlHash: `h${url}`, statusCode: 200 });
const link = (from: string, to: string): CrawledLink =>
  ({ fromUrl: from, toUrl: to, anchorText: 'go', isGenericAnchor: false });

/**
 * A deliberately SYMMETRIC site: many leaves with identical in-degree, so their PageRank values tie
 * exactly. Ties are where insertion order leaks — on an asymmetric graph the sort is total and the
 * defect is invisible, which is why the incumbent tests never caught it.
 */
const symmetricSite = (leaves: number) => {
  const urls = [HOME, ...Array.from({ length: leaves }, (_, i) => `${HOME}/p${String(i).padStart(3, '0')}`)];
  const links: CrawledLink[] = [];
  for (const u of urls.slice(1)) {
    links.push(link(HOME, u));
    links.push(link(u, HOME)); // identical shape for every leaf ⇒ identical rank
  }
  return { urls, links };
};

/** Rotate the page array — a pure arrival-order permutation, with no RNG so the test cannot flake. */
const rotate = <T>(xs: T[], n: number): T[] => [...xs.slice(n), ...xs.slice(0, n)];

describe('M6 — the grade must not depend on fetch-completion order', () => {
  const { urls, links } = symmetricSite(40);

  const scoresFor = (pageOrder: string[]) => {
    const graph = buildGraph(pageOrder.map(page), links);
    const ranks = computePageRank(graph);
    const depths = computeDepth(graph, HOME);
    return {
      concentration: hubConcentrationScore(ranks),
      reachability: hubReachabilityScore(ranks, depths, MAX_HEALTHY_DEPTH),
    };
  };

  it('hubReachabilityScore is identical across arrival-order permutations', () => {
    // THE M6 DEFECT. On today's engine this fails: tied PageRank values break by insertion order, so
    // a different completion order selects a different top-5% hub tier.
    const base = scoresFor(urls);
    for (const n of [1, 7, 13, 29]) {
      expect(scoresFor(rotate(urls, n)).reachability, `rotation ${n} changed reachability`)
        .toBe(base.reachability);
    }
  });

  it('hubConcentrationScore is identical across arrival-order permutations', () => {
    // I PREDICTED THIS WOULD ALREADY HOLD, on the reasoning that concentration sums VALUES and a sum
    // is order-free. That was wrong, and the test caught it: floating-point addition is not
    // associative, so PageRank iterated in a different node order returns slightly different values
    // (measured 0.9727594706314373 vs 0.972759470631438). The defect was therefore deeper than a
    // tie-break — the RANKS themselves depended on arrival order — which is why the fix is to insert
    // graph nodes in canonical-URL order rather than to patch each consumer.
    const base = scoresFor(urls);
    for (const n of [1, 7, 13, 29]) {
      expect(scoresFor(rotate(urls, n)).concentration).toBe(base.concentration);
    }
  });

  it('the SET of top hubs is itself stable, not merely the score', () => {
    // A score can coincide by luck while the underlying selection wanders. Pin the selection.
    const hubsFor = (pageOrder: string[]) => {
      const graph = buildGraph(pageOrder.map(page), links);
      const ranks = computePageRank(graph);
      const topCount = Math.max(1, Math.ceil(0.05 * ranks.size));
      return [...ranks.entries()].sort((a, b) => b[1] - a[1]).slice(0, topCount).map(([u]) => u).sort();
    };
    const base = hubsFor(urls);
    for (const n of [1, 7, 13, 29]) expect(hubsFor(rotate(urls, n))).toEqual(base);
  });
});

describe('M6 sibling — computeDepth root selection must not depend on arrival order', () => {
  it('picks the same fallback root for a fully cyclic graph in any arrival order', () => {
    // When the homepage node is absent AND every node has in-degree > 0, depth.ts falls back to
    // `graph.nodes()[0]` — the FIRST NODE INSERTED, i.e. whichever page the crawler finished first.
    // Every depth on the site then shifts with the network.
    const urls = [`${HOME}/a`, `${HOME}/b`, `${HOME}/c`, `${HOME}/d`];
    const links = urls.map((u, i) => link(u, urls[(i + 1) % urls.length]!)); // a→b→c→d→a
    const depthsFor = (order: string[]) => {
      const d = computeDepth(buildGraph(order.map(page), links), `${HOME}/absent-homepage`);
      return [...d.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([u, v]) => `${u}:${v}`);
    };
    const base = depthsFor(urls);
    for (const n of [1, 2, 3]) {
      expect(depthsFor(rotate(urls, n)), `rotation ${n} changed the depth map`).toEqual(base);
    }
  });
});
