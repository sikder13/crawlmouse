import { describe, it, expect } from 'vitest';
import Graph from 'graphology';
import { computePageRank, giniCoefficient } from './pagerank.js';
import type { SiteGraph } from '../graph.js';

function makeGraph(edges: [string, string][]): SiteGraph {
  const g: SiteGraph = new Graph({ type: 'directed', multi: false, allowSelfLoops: false });
  for (const [a, b] of edges) {
    if (!g.hasNode(a)) g.addNode(a, { urlHash: '', statusCode: 200 });
    if (!g.hasNode(b)) g.addNode(b, { urlHash: '', statusCode: 200 });
    g.addDirectedEdge(a, b, { anchorText: '', isGenericAnchor: false });
  }
  return g;
}

describe('computePageRank', () => {
  it('produces values summing to ~1', () => {
    const g = makeGraph([['/', '/a'], ['/', '/b'], ['/a', '/b']]);
    const ranks = computePageRank(g);
    const sum = Array.from(ranks.values()).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1, 2);
  });

  it('ranks well-linked pages higher than orphans', () => {
    const g = makeGraph([['/', '/a'], ['/', '/b'], ['/a', '/b']]);
    g.addNode('/orphan', { urlHash: '', statusCode: 200 });
    const ranks = computePageRank(g);
    expect(ranks.get('/b')! > ranks.get('/orphan')!).toBe(true);
  });

  it('returns an empty map for an empty graph instead of throwing', () => {
    const g: SiteGraph = new Graph({ type: 'directed', multi: false, allowSelfLoops: false });
    expect(() => computePageRank(g)).not.toThrow();
    expect(computePageRank(g).size).toBe(0);
  });

  it('handles a single isolated node without throwing', () => {
    const g: SiteGraph = new Graph({ type: 'directed', multi: false, allowSelfLoops: false });
    g.addNode('/only', { urlHash: '', statusCode: 200 });
    expect(() => computePageRank(g)).not.toThrow();
    expect(computePageRank(g).get('/only')).toBeCloseTo(1, 5);
  });
});

describe('giniCoefficient', () => {
  it('is 0 for perfectly equal distribution', () => {
    expect(giniCoefficient([1, 1, 1, 1])).toBeCloseTo(0, 2);
  });
  it('is high for unequal distribution', () => {
    expect(giniCoefficient([10, 0, 0, 0])).toBeGreaterThan(0.7);
  });
});
