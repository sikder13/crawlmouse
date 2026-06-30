import { describe, it, expect } from 'vitest';
import { assembleGraph, type RawGraphNode, type RawGraphEdge } from './graph-assembly';

const HOME = 'https://ex.com/';
function node(url: string, pagerank: number, over: Partial<RawGraphNode> = {}): RawGraphNode {
  return { url, title: url, depth: 1, isOrphan: false, pagerank, inboundCount: 1, outboundCount: 1, ...over };
}
const opts = (over: Partial<Parameters<typeof assembleGraph>[2]> = {}) => ({
  homepageUrl: HOME,
  siteJsRendered: false,
  nodeCap: 150,
  isFreeTier: true,
  ...over,
});

describe('assembleGraph (SPEC 02 v1.2 — capped, deterministic)', () => {
  it('returns the full graph uncapped when under the node cap; edges nofollow=false (display-only)', () => {
    const nodes = [node(HOME, 0.5, { depth: 0 }), node('https://ex.com/a', 0.3), node('https://ex.com/b', 0.2)];
    const edges: RawGraphEdge[] = [
      { fromUrl: HOME, toUrl: 'https://ex.com/a' },
      { fromUrl: 'https://ex.com/a', toUrl: HOME },
    ];
    const g = assembleGraph(nodes, edges, opts());
    expect(g.nodes).toHaveLength(3);
    expect(g.edges).toHaveLength(2);
    expect(g.totalNodes).toBe(3);
    expect(g.totalEdges).toBe(2);
    expect(g.capped).toBe(false);
    expect(g.capReason).toBe('none');
    expect(g.edges.every((e) => e.nofollow === false)).toBe(true);
  });

  it('flags the homepage and max-normalizes pagerank to node size (top hub = 1)', () => {
    const nodes = [node(HOME, 0.4, { depth: 0 }), node('https://ex.com/a', 0.2)];
    const g = assembleGraph(nodes, [], opts());
    const home = g.nodes.find((n) => n.url === HOME)!;
    const a = g.nodes.find((n) => n.url === 'https://ex.com/a')!;
    expect(home.isHomepage).toBe(true);
    expect(a.isHomepage).toBe(false);
    expect(home.pagerank).toBe(1);
    expect(a.pagerank).toBeCloseTo(0.5);
  });

  it('derives isHomepage from depth 0 when the URL does not match (canonical fallback)', () => {
    const nodes = [node('https://ex.com/seed', 0.5, { depth: 0 }), node('https://ex.com/a', 0.2)];
    const g = assembleGraph(nodes, [], opts({ homepageUrl: 'https://different.example/' }));
    expect(g.nodes.find((n) => n.url.endsWith('/seed'))!.isHomepage).toBe(true);
  });

  it('flags jsOnly ONLY on a JS-navigation site, for nodes with zero static inbound links', () => {
    const nodes = [
      node(HOME, 0.5, { depth: 0, inboundCount: 2 }),
      node('https://ex.com/unreachable', 0.1, { inboundCount: 0 }),
    ];
    const onJs = assembleGraph(nodes, [], opts({ siteJsRendered: true }));
    expect(onJs.nodes.find((n) => n.url.endsWith('/unreachable'))!.jsOnly).toBe(true);
    expect(onJs.nodes.find((n) => n.url === HOME)!.jsOnly).toBe(false); // has static inbound
    const offJs = assembleGraph(nodes, [], opts({ siteJsRendered: false }));
    expect(offJs.nodes.every((n) => n.jsOnly === false)).toBe(true); // never on a normal site
  });

  it('caps to top-N by pagerank (free_tier), ALWAYS keeps the homepage, edges only between included nodes', () => {
    const nodes = [
      node(HOME, 0.01, { depth: 0 }), // low pagerank but must survive
      node('https://ex.com/hub1', 0.9),
      node('https://ex.com/hub2', 0.8),
      node('https://ex.com/leaf', 0.05),
    ];
    const edges: RawGraphEdge[] = [
      { fromUrl: 'https://ex.com/hub1', toUrl: 'https://ex.com/hub2' }, // both kept
      { fromUrl: 'https://ex.com/hub1', toUrl: 'https://ex.com/leaf' }, // leaf dropped → edge dropped
    ];
    const g = assembleGraph(nodes, edges, opts({ nodeCap: 3, isFreeTier: true }));
    expect(g.nodes).toHaveLength(3);
    expect(g.nodes.some((n) => n.isHomepage)).toBe(true);
    expect(g.nodes.some((n) => n.url.endsWith('/leaf'))).toBe(false); // lowest non-home dropped
    expect(g.totalNodes).toBe(4);
    expect(g.capped).toBe(true);
    expect(g.capReason).toBe('free_tier');
    expect(g.edges).toHaveLength(1);
    expect(g.totalEdges).toBe(2);
  });

  it('uses capReason "readability" when node-capped on a non-free tier', () => {
    const nodes = [node(HOME, 0.5, { depth: 0 }), node('https://ex.com/a', 0.4), node('https://ex.com/b', 0.3)];
    const g = assembleGraph(nodes, [], opts({ nodeCap: 2, isFreeTier: false }));
    expect(g.capped).toBe(true);
    expect(g.capReason).toBe('readability');
  });

  it('caps edges for performance (nodes uncapped) and is deterministic', () => {
    const nodes = Array.from({ length: 5 }, (_, i) =>
      node(`https://ex.com/${i}`, (5 - i) / 5, i === 0 ? { depth: 0 } : {}),
    );
    const edges: RawGraphEdge[] = [];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) if (i !== j) edges.push({ fromUrl: `https://ex.com/${i}`, toUrl: `https://ex.com/${j}` });
    const g1 = assembleGraph(nodes, edges, opts({ nodeCap: 10, edgeCap: 5 }));
    const g2 = assembleGraph(nodes, edges, opts({ nodeCap: 10, edgeCap: 5 }));
    expect(g1.nodes).toHaveLength(5);
    expect(g1.edges).toHaveLength(5);
    expect(g1.capped).toBe(true);
    expect(g1.capReason).toBe('performance');
    expect(g1).toEqual(g2); // same input → same output
  });

  it('dedups duplicate directed links into one edge (true unique-edge total)', () => {
    const nodes = [node(HOME, 0.5, { depth: 0 }), node('https://ex.com/a', 0.2)];
    const edges: RawGraphEdge[] = [
      { fromUrl: HOME, toUrl: 'https://ex.com/a' },
      { fromUrl: HOME, toUrl: 'https://ex.com/a' }, // duplicate (2nd anchor) → one edge
    ];
    const g = assembleGraph(nodes, edges, opts());
    expect(g.edges).toHaveLength(1);
    expect(g.totalEdges).toBe(1);
  });
});
