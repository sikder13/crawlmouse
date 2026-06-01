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
