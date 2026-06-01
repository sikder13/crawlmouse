import { describe, it, expect } from 'vitest';
import Graph from 'graphology';
import { anchorHHI, genericAnchorFraction, perTargetHHI } from './anchor.js';
import type { SiteGraph } from '../graph.js';

function makeGraph(nodes: string[], edges: { from: string; to: string; anchor: string; generic?: boolean }[]): SiteGraph {
  const g: SiteGraph = new Graph({ type: 'directed', multi: false, allowSelfLoops: false });
  for (const n of nodes) g.addNode(n, { urlHash: '', statusCode: 200 });
  for (const e of edges) g.addDirectedEdge(e.from, e.to, { anchorText: e.anchor, isGenericAnchor: !!e.generic });
  return g;
}

describe('anchorHHI', () => {
  it('is 1.0 when one anchor dominates', () => {
    expect(anchorHHI(['shoes', 'shoes', 'shoes'])).toBeCloseTo(1);
  });
  it('is low when anchors are diverse', () => {
    expect(anchorHHI(['a', 'b', 'c', 'd'])).toBeCloseTo(0.25);
  });
  it('is 0 for empty', () => {
    expect(anchorHHI([])).toBe(0);
  });
});

describe('perTargetHHI', () => {
  it('flags over-optimized targets', () => {
    const g2 = makeGraph(
      ['/', '/x', '/y', '/z', '/p'],
      [
        { from: '/', to: '/p', anchor: 'shoes' },
        { from: '/x', to: '/p', anchor: 'shoes' },
        { from: '/y', to: '/p', anchor: 'shoes' },
        { from: '/z', to: '/p', anchor: 'other' },
      ],
    );
    const result = perTargetHHI(g2);
    expect(result.get('/p')).toBeGreaterThan(0.5);
  });

  it('does NOT flag image-heavy inbound links (empty anchors) as over-optimized', () => {
    // 7 image/icon links (empty anchor) + 3 "shoes" links. Dropping the empties
    // would make this look 100% concentrated on "shoes"; counting each empty as a
    // unique bucket keeps HHI low (~0.16), so it is correctly not flagged.
    const nodes = ['/p', '/t', ...Array.from({ length: 10 }, (_, i) => `/s${i}`)];
    const edges = [
      ...Array.from({ length: 7 }, (_, i) => ({ from: `/s${i}`, to: '/p', anchor: '' })),
      ...Array.from({ length: 3 }, (_, i) => ({ from: `/s${i + 7}`, to: '/p', anchor: 'shoes' })),
    ];
    const result = perTargetHHI(makeGraph(nodes, edges));
    expect(result.get('/p')!).toBeLessThan(0.5);
  });

  it('does NOT flag a gallery whose inbound links are all images', () => {
    const nodes = ['/p', ...Array.from({ length: 5 }, (_, i) => `/img${i}`)];
    const edges = Array.from({ length: 5 }, (_, i) => ({ from: `/img${i}`, to: '/p', anchor: '   ' }));
    const result = perTargetHHI(makeGraph(nodes, edges));
    expect(result.get('/p')!).toBeLessThan(0.5);
  });
});

describe('genericAnchorFraction', () => {
  it('computes fraction of edges marked generic', () => {
    const g = makeGraph(
      ['/', '/a', '/b'],
      [
        { from: '/', to: '/a', anchor: 'A', generic: false },
        { from: '/', to: '/b', anchor: 'Click here', generic: true },
      ],
    );
    expect(genericAnchorFraction(g)).toBeCloseTo(0.5);
  });
});
