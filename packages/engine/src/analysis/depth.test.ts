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
});
