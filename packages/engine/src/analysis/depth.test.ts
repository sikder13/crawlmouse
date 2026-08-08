import { describe, it, expect } from 'vitest';
import Graph from 'graphology';
import { computeDepth } from './depth.js';
import type { SiteGraph } from '../graph.js';

function makeGraph(nodes: string[], edges: [string, string][]): SiteGraph {
  const g: SiteGraph = new Graph({ type: 'directed', multi: false, allowSelfLoops: false });
  for (const n of nodes) g.addNode(n, { urlHash: '', statusCode: 200 });
  for (const [a, b] of edges) g.addDirectedEdge(a, b, { anchorText: '', isGenericAnchor: false });
  return g;
}

describe('computeDepth', () => {
  it('assigns depth 0 to homepage and BFS distance to others', () => {
    const g = makeGraph(
      ['/', '/a', '/b', '/c'],
      [['/', '/a'], ['/a', '/b'], ['/b', '/c']],
    );
    const d = computeDepth(g, '/');
    expect(d.get('/')).toBe(0);
    expect(d.get('/a')).toBe(1);
    expect(d.get('/b')).toBe(2);
    expect(d.get('/c')).toBe(3);
  });

  it('takes shortest path when multiple paths exist', () => {
    const g = makeGraph(['/', '/a', '/b'], [['/', '/a'], ['/a', '/b'], ['/', '/b']]);
    expect(computeDepth(g, '/').get('/b')).toBe(1);
  });

  it('leaves unreachable pages undefined', () => {
    const g = makeGraph(['/', '/orphan'], []);
    const d = computeDepth(g, '/');
    expect(d.has('/orphan')).toBe(false);
  });

  it('falls back to graph roots when the homepage node is absent', () => {
    // Homepage 403'd / served non-HTML, but sitemap pages crawled fine. Rooting
    // only at the missing homepage would mark every page unreachable; instead BFS
    // from in-degree-0 sources so reachability reflects the real structure.
    const g = makeGraph(['/a', '/b', '/c'], [['/a', '/b'], ['/b', '/c']]);
    const d = computeDepth(g, '/missing-homepage');
    expect(d.get('/a')).toBe(0);
    expect(d.get('/b')).toBe(1);
    expect(d.get('/c')).toBe(2);
  });

  it('still produces depths for a fully cyclic graph with no source node', () => {
    const g = makeGraph(['/a', '/b'], [['/a', '/b'], ['/b', '/a']]);
    const d = computeDepth(g, '/missing');
    // No in-degree-0 root exists; fall back to any node so the graph is covered.
    expect(d.size).toBe(2);
  });

  it('returns an empty map for an empty graph', () => {
    const g = makeGraph([], []);
    expect(computeDepth(g, '/').size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M6 DETERMINISM — the root set, pinned. ADDED AFTER A SURVIVING MUTATION: dropping `.sort()` from
// the root selection passed all 826 engine tests, though the comment beside it makes a specific
// causal claim — that `graph.nodes()[0]` was whichever page finished first, "which shifted every
// depth on the site with the network". Depth feeds the grade, so an unpinned claim there is a
// documented failure mode with no guard behind it.
// ─────────────────────────────────────────────────────────────────────────────
describe('root selection is independent of node insertion order', () => {
  // Two in-degree-0 roots feeding a shared subtree: which root BFS starts from decides the depths.
  const edges: [string, string][] = [['/r1', '/mid'], ['/r2', '/mid'], ['/mid', '/leaf']];
  const nodes = ['/r2', '/mid', '/leaf', '/r1'];

  it('produces identical depths when nodes are inserted in the opposite order, with no homepage root', () => {
    const forward = computeDepth(makeGraph(nodes, edges), '/absent');
    const reversed = computeDepth(makeGraph([...nodes].reverse(), edges), '/absent');
    expect([...reversed.entries()].sort()).toEqual([...forward.entries()].sort());
  });

  it('produces identical depths in a FULLY CYCLIC graph, where the sorted-first fallback is the only choice', () => {
    // Every node has in-degree >= 1, so the in-degree-0 root set is empty and the fallback decides.
    const cyc: [string, string][] = [['/a', '/b'], ['/b', '/c'], ['/c', '/a']];
    const cycNodes = ['/c', '/a', '/b'];
    const forward = computeDepth(makeGraph(cycNodes, cyc), '/absent');
    const reversed = computeDepth(makeGraph([...cycNodes].reverse(), cyc), '/absent');
    expect([...reversed.entries()].sort()).toEqual([...forward.entries()].sort());
  });
});
