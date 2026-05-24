import { describe, it, expect } from 'vitest';
import { buildGraph } from './graph.js';

const pages = [
  { url: 'https://x.com/', urlHash: 'h-home', statusCode: 200 },
  { url: 'https://x.com/a', urlHash: 'h-a', statusCode: 200 },
  { url: 'https://x.com/b', urlHash: 'h-b', statusCode: 200 },
  { url: 'https://x.com/c', urlHash: 'h-c', statusCode: 200 },
];
const links = [
  { fromUrl: 'https://x.com/', toUrl: 'https://x.com/a', anchorText: 'A', isGenericAnchor: false },
  { fromUrl: 'https://x.com/', toUrl: 'https://x.com/b', anchorText: 'B', isGenericAnchor: false },
  { fromUrl: 'https://x.com/a', toUrl: 'https://x.com/b', anchorText: 'B again', isGenericAnchor: false },
];

describe('buildGraph', () => {
  it('creates nodes for all pages and edges for all links to known pages', () => {
    const g = buildGraph(pages, links);
    expect(g.order).toBe(4);
    expect(g.size).toBe(3);
  });

  it('reports in/out degrees correctly', () => {
    const g = buildGraph(pages, links);
    expect(g.inDegree('https://x.com/b')).toBe(2);
    expect(g.outDegree('https://x.com/a')).toBe(1);
    expect(g.inDegree('https://x.com/c')).toBe(0);
  });

  it('drops edges pointing to unknown pages', () => {
    const linksWithGhost = [...links, { fromUrl: 'https://x.com/', toUrl: 'https://x.com/ghost', anchorText: '?', isGenericAnchor: false }];
    const g = buildGraph(pages, linksWithGhost);
    expect(g.size).toBe(3);
  });
});
