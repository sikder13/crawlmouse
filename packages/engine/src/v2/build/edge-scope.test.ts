import type { CrawlBatchResult, LinkEdge } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { recordedBuild } from '../../../fixtures/v2/build/recorded.js';
import { buildCheck } from './build.js';
import {
  boundedEdges,
  LARGE_MEMORY_MB,
  MAX_OTHER_EDGES_PER_PAGE,
  MAX_OWN_EDGES,
  noEdgesKept,
  otherEdgesPerPage,
  OwnEdgesOverBound,
  ownEdgeBound,
  rowAddresses,
} from './edge-scope.js';

const isCrawl = (b: unknown): b is CrawlBatchResult => (b as { kind?: string }).kind === 'crawl';
const edge = (from: string, to: string, generic = false): LinkEdge => ({
  check_id: 'c0000000-0000-4000-8000-000000000001',
  from_url: from,
  to_url: to,
  anchor_text: generic ? 'click here' : 'a',
  is_generic_anchor: generic,
  js_only: false,
});

/**
 * The recorded check, each crawled page also linking to `n` addresses never fetched and to `generic`
 * more with generic anchor text ("click here"), its `links_out` raised to match, as the worker would
 * record it. The generic links make the generic-anchor detector decide on these pages.
 */
function withUncrawledLinks(n: number, generic = 0): ReturnType<typeof recordedBuild> {
  const input = recordedBuild();
  const at = (p: { url: string }, kind: string, i: number) =>
    `${new URL(p.url).origin}/never-crawled/${kind}-${p.url.length}-${i}`;
  return {
    ...input,
    batches: input.batches.map((b) =>
      isCrawl(b)
        ? {
            ...b,
            pages: b.pages.map((p) =>
              p.outcome === 'fetched' && p.links_out !== null
                ? { ...p, links_out: p.links_out + n + generic }
                : p,
            ),
            link_edges: [
              ...b.link_edges,
              ...b.pages
                .filter((p) => p.outcome === 'fetched')
                .flatMap((p) => [
                  ...Array.from({ length: n }, (_, i) => edge(p.url, at(p, 'n', i))),
                  ...Array.from({ length: generic }, (_, i) => edge(p.url, at(p, 'g', i), true)),
                ]),
            ],
          }
        : b,
    ),
  };
}

const withoutPacket = <T extends { packet: unknown }>(f: T) => ({ ...f, packet: null });

/** As the build step does over the bound: each batch's edges through `boundedEdges`, in order. */
function bounded(input: ReturnType<typeof recordedBuild>) {
  const addresses = new Set(rowAddresses(input.batches.filter(isCrawl).flatMap((b) => b.pages)));
  const kept = noEdgesKept();
  return {
    ...input,
    batches: input.batches.map((b) => {
      if (!isCrawl(b)) return b;
      const link_edges = boundedEdges(b.link_edges, addresses, kept);
      const dropped = b.link_edges.length - link_edges.length;
      return { ...b, link_edges, ...(dropped > 0 && { link_edges_dropped: dropped }) };
    }),
  };
}

describe('the bound on the edges a build holds (F-248)', () => {
  const input = withUncrawledLinks(60, 200);
  const all = buildCheck(input);
  const cut = buildCheck(bounded(input));

  it('cuts only edges to addresses the crawl never fetched, to its per-page share', () => {
    const own = (es: readonly LinkEdge[]) =>
      es.filter((e) => !e.to_url.includes('/never-crawled/') || e.is_generic_anchor);
    expect(own(cut.link_edges)).toEqual(own(all.link_edges));
    const elsewhere = new Map<string, number>();
    for (const e of cut.link_edges)
      if (e.to_url.includes('/never-crawled/') && !e.is_generic_anchor)
        elsewhere.set(e.from_url, (elsewhere.get(e.from_url) ?? 0) + 1);
    expect(new Set(elsewhere.values())).toEqual(new Set([MAX_OTHER_EDGES_PER_PAGE]));
    expect(cut.link_edges.length).toBeLessThan(all.link_edges.length);
  });

  it('gives the grade the whole graph gives, and the same page facts and fixes', () => {
    expect(cut.check.technical_seo).toEqual(all.check.technical_seo);
    expect(cut.check.ai_readability).toEqual(all.check.ai_readability);
    // `internal_links` counts the edges left out too (`link_edges_dropped`).
    expect(cut.check.structure).toEqual(all.check.structure);
    expect(cut.page_results).toEqual(all.page_results);
    // A packet's text counts the links the page recorded, which over the bound are the ones held.
    expect(cut.fixes.map(withoutPacket)).toEqual(all.fixes.map(withoutPacket));
  });

  it('keeps the generic-anchor fixes the uncut graph finds (review of bc85d7db)', () => {
    const generic = all.fixes.filter((f) => f.type === 'generic_anchor_text');
    expect(generic.length).toBeGreaterThan(0);
    expect(cut.fixes.filter((f) => f.type === 'generic_anchor_text').map(withoutPacket)).toEqual(
      generic.map(withoutPacket),
    );
  });

  it('stops, by name, when the own-page edges alone pass their bound', () => {
    const pages = Array.from({ length: 500 }, (_, i) => `https://example.com/p${i}`);
    const addresses = new Set(rowAddresses(pages.map((url) => ({ url, final_url: null }))));
    const kept = noEdgesKept();
    const edges = pages.flatMap((from, f) =>
      Array.from({ length: 300 }, (_, i) => edge(from, pages[(f + i + 1) % 500]!)),
    );
    expect(() => boundedEdges(edges, addresses, kept, 100_000)).toThrow(OwnEdgesOverBound);
    expect(boundedEdges(edges.slice(0, 1000), addresses, noEdgesKept(), 100_000)).toHaveLength(
      1000,
    );
  });

  it('answers for a row under its URL and where it landed', () => {
    expect(
      rowAddresses([
        { url: 'https://example.com/a', final_url: 'https://example.com/b-moved' },
        { url: 'https://example.com/c', final_url: null },
      ]),
    ).toEqual(['https://example.com/a', 'https://example.com/b-moved', 'https://example.com/c']);
  });
});

// Inbox 079 and 080: a 2,000-page check needs about 200,000 own-page edges, which build in 4 GB and
// not in 2 GB (measured: 1,818 MiB at 200,000; 2,358 MiB with 20 edges elsewhere a page). The bound
// follows the memory the function has, and a large check keeps fewer edges elsewhere.
describe('the bound by memory and by page cap (2,000 pages)', () => {
  it('holds 250,000 own-page edges with 4 GB, and 100,000 otherwise or when memory is unknown', () => {
    expect(ownEdgeBound(4096)).toBe(250_000);
    expect(ownEdgeBound(LARGE_MEMORY_MB)).toBe(250_000);
    expect(ownEdgeBound(LARGE_MEMORY_MB - 1)).toBe(MAX_OWN_EDGES);
    expect(ownEdgeBound(2048)).toBe(100_000);
    expect(ownEdgeBound(null)).toBe(100_000);
  });

  it('keeps 5 edges elsewhere a page on a check of more than 500 pages, and 20 up to 500', () => {
    expect(otherEdgesPerPage(500)).toBe(MAX_OTHER_EDGES_PER_PAGE);
    expect(otherEdgesPerPage(501)).toBe(5);
    expect(otherEdgesPerPage(2000)).toBe(5);
    const page = 'https://shop.test/p';
    const elsewhere = Array.from({ length: 30 }, (_, i) => ({
      check_id: 'c',
      from_url: page,
      to_url: `https://shop.test/never/${i}`,
      anchor_text: 'Article',
      is_generic_anchor: false,
      js_only: false,
    }));
    expect(boundedEdges(elsewhere, new Set([page]), noEdgesKept(), 10, 5)).toHaveLength(5);
  });

  it('names the bound it stopped at', () => {
    const own = Array.from({ length: 4 }, (_, i) => ({
      check_id: 'c',
      from_url: 'https://shop.test/a',
      to_url: `https://shop.test/b${i}`,
      anchor_text: 'B',
      is_generic_anchor: false,
      js_only: false,
    }));
    const addresses = new Set(own.map((e) => e.to_url));
    expect(() => boundedEdges(own, addresses, noEdgesKept(), 3, 5)).toThrow(
      /more than 3 link edges/,
    );
  });
});
