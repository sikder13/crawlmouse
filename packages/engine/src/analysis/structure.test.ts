import { describe, it, expect } from 'vitest';
import { buildGraph } from '../graph.js';
import { computePageRank } from './pagerank.js';
import { computeDepth } from './depth.js';
import { hubConcentrationScore, hubReachabilityScore } from './structure.js';
import type { CrawledPage, CrawledLink } from '../crawler.js';

// Helpers to build a real graph -> real PageRank -> real depths, so these tests
// exercise the SAME pipeline audit.ts uses (not a hand-faked rank map). This is
// the key A5 regression: the OLD structure score rewarded a FLAT PageRank spread
// (low Gini) and penalized healthy hub concentration — exactly backwards.

const page = (url: string): CrawledPage => ({
  url,
  urlHash: url, // hash value is irrelevant to graph topology / PageRank here
  title: url,
  statusCode: 200,
});

const link = (from: string, to: string): CrawledLink => ({
  fromUrl: from,
  toUrl: to,
  anchorText: 'x',
  isGenericAnchor: false,
});

// A healthy SILO: home -> one money hub -> many shallow leaves. The hub also links
// back to home and the leaves link back to the hub, so authority concentrates on
// the hub (and home), exactly the structure a well-organized site should have.
function siloedGraph(leafCount: number) {
  const pages: CrawledPage[] = [page('h'), page('hub')];
  const links: CrawledLink[] = [link('h', 'hub'), link('hub', 'h')];
  for (let i = 0; i < leafCount; i++) {
    const leaf = `leaf${i}`;
    pages.push(page(leaf));
    links.push(link('hub', leaf)); // hub -> leaf (leaf is one click below the hub)
    links.push(link(leaf, 'hub')); // leaf -> hub (feeds authority back to the hub)
  }
  return buildGraph(pages, links);
}

// A FRAGMENTED site: a home page plus N near-equal pages with NO links between the
// N pages (home links to each so they aren't orphaned). PageRank is spread almost
// evenly across the N — there is no real hub — so hub concentration must be LOW.
function fragmentedGraph(n: number) {
  const pages: CrawledPage[] = [page('h')];
  const links: CrawledLink[] = [];
  for (let i = 0; i < n; i++) {
    const p = `p${i}`;
    pages.push(page(p));
    links.push(link('h', p)); // home -> each (so none is an orphan)
  }
  return buildGraph(pages, links);
}

describe('hubConcentrationScore', () => {
  it('returns HIGH for a siloed graph (authority concentrates on a real hub)', () => {
    const g = siloedGraph(40);
    const ranks = computePageRank(g);
    const score = hubConcentrationScore(ranks);
    expect(score).toBeGreaterThan(0.6);
  });

  it('returns LOW for a fragmented graph (~10 mutually-unlinked near-equal pages)', () => {
    const g = fragmentedGraph(10);
    const ranks = computePageRank(g);
    const score = hubConcentrationScore(ranks);
    // No real hubs: the top-5% share barely exceeds the flat baseline -> near 0.
    expect(score).toBeLessThan(0.3);
  });

  it('rewards concentration over fragmentation (silo strictly beats fragmented)', () => {
    const siloScore = hubConcentrationScore(computePageRank(siloedGraph(40)));
    const fragScore = hubConcentrationScore(computePageRank(fragmentedGraph(40)));
    expect(siloScore).toBeGreaterThan(fragScore);
  });

  it('returns 1 for a degenerate 0-node graph (no throw)', () => {
    expect(hubConcentrationScore(new Map())).toBe(1);
  });

  it('returns 1 for a degenerate 1-node graph (no throw)', () => {
    expect(hubConcentrationScore(new Map([['only', 1]]))).toBe(1);
  });

  it('returns 1 when there is no authority to concentrate (all-zero ranks)', () => {
    // Pins the `total <= 0 -> neutral 1` guard so a mutation to `return 0` is caught.
    expect(hubConcentrationScore(new Map([['a', 0], ['b', 0], ['c', 0]]))).toBe(1);
  });

  it('never returns NaN when a rank is non-finite (defensive)', () => {
    // Not reachable from the real pipeline (graphology-pagerank emits finite values), but the
    // [0,1] contract must hold for any caller — a NaN total must degrade to the neutral 1.
    // Use >=20 nodes so the flat baseline (topCount/N) stays below TARGET and execution
    // actually reaches the share computation (a 2-node map would short-circuit on baseline>=TARGET).
    const ranks = new Map<string, number>([['a', NaN]]);
    for (let i = 0; i < 19; i++) ranks.set(`p${i}`, 0.5);
    expect(hubConcentrationScore(ranks)).toBe(1);
  });
});

describe('hubReachabilityScore', () => {
  it('returns 1 when the hubs are SHALLOW (reachable within MAX_HEALTHY_DEPTH)', () => {
    const g = siloedGraph(40);
    const ranks = computePageRank(g);
    const depths = computeDepth(g, 'h');
    // Hub sits at depth 1 from home; maxDepth 3 -> every hub reachable.
    expect(hubReachabilityScore(ranks, depths, 3)).toBe(1);
  });

  it('returns LOW when the top-ranked hubs are buried DEEPER than maxDepth', () => {
    const g = siloedGraph(40);
    const ranks = computePageRank(g);
    const depths = computeDepth(g, 'h');
    // Set maxDepth to -1 so NOTHING is within it -> none of the hubs reachable.
    expect(hubReachabilityScore(ranks, depths, -1)).toBe(0);
  });

  it('counts only hubs whose depth is defined AND <= maxDepth', () => {
    const ranks = new Map([
      ['a', 0.9], // top hub
      ['b', 0.05],
      ['c', 0.05],
      // 3 nodes, ceil(0.05*3)=1 hub -> only 'a' counts
    ]);
    const depthsReachable = new Map([['a', 2]]);
    expect(hubReachabilityScore(ranks, depthsReachable, 3)).toBe(1);
    const depthsUnreachable = new Map<string, number>(); // 'a' has no depth (unreachable)
    expect(hubReachabilityScore(ranks, depthsUnreachable, 3)).toBe(0);
  });

  it('returns 1 for a degenerate 0/1-node graph (no throw)', () => {
    expect(hubReachabilityScore(new Map(), new Map(), 3)).toBe(1);
    expect(hubReachabilityScore(new Map([['only', 1]]), new Map([['only', 0]]), 3)).toBe(1);
  });
});
