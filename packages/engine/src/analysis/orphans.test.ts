import { describe, it, expect } from 'vitest';
import Graph from 'graphology';
import { detectOrphans } from './orphans.js';
import type { SiteGraph } from '../graph.js';

function makeGraph(nodes: string[], edges: [string, string][]): SiteGraph {
  const g: SiteGraph = new Graph({ type: 'directed', multi: false, allowSelfLoops: false });
  for (const n of nodes) g.addNode(n, { urlHash: '', statusCode: 200 });
  for (const [a, b] of edges) g.addDirectedEdge(a, b, { anchorText: '', isGenericAnchor: false });
  return g;
}

describe('detectOrphans', () => {
  it('classifies pages with in-degree 0 as orphans (except homepage)', () => {
    const g = makeGraph(
      ['https://x.com/', 'https://x.com/a', 'https://x.com/b', 'https://x.com/orphan'],
      [['https://x.com/', 'https://x.com/a'], ['https://x.com/a', 'https://x.com/b']],
    );
    const r = detectOrphans(g, 'https://x.com/');
    expect(r.orphans).toEqual(['https://x.com/orphan']);
    expect(r.orphanRatio).toBeCloseTo(1 / 4);
  });

  it('classifies pages with in-degree 1 or 2 as near-orphans', () => {
    const g = makeGraph(
      ['https://x.com/', 'https://x.com/a', 'https://x.com/b'],
      [['https://x.com/', 'https://x.com/a']],
    );
    const r = detectOrphans(g, 'https://x.com/');
    expect(r.nearOrphans).toEqual(['https://x.com/a']);
  });

  it('never marks the homepage as orphan', () => {
    const g = makeGraph(['https://x.com/'], []);
    const r = detectOrphans(g, 'https://x.com/');
    expect(r.orphans).not.toContain('https://x.com/');
  });
});
