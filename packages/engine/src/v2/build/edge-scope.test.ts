import type { CrawlBatchResult, LinkEdge } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { recordedBuild } from '../../../fixtures/v2/build/recorded.js';
import { buildCheck } from './build.js';
import {
  boundedEdges,
  MAX_OTHER_EDGES_PER_PAGE,
  noEdgesKept,
  OwnEdgesOverBound,
  rowAddresses,
} from './edge-scope.js';

const isCrawl = (b: unknown): b is CrawlBatchResult => (b as { kind?: string }).kind === 'crawl';
const edge = (from: string, to: string): LinkEdge => ({
  check_id: 'c0000000-0000-4000-8000-000000000001',
  from_url: from,
  to_url: to,
  anchor_text: 'a',
  is_generic_anchor: false,
  js_only: false,
});

/** The recorded check, its crawled pages each also linking to `n` addresses never fetched. */
function withUncrawledLinks(n: number): ReturnType<typeof recordedBuild> {
  const input = recordedBuild();
  return {
    ...input,
    batches: input.batches.map((b) =>
      isCrawl(b)
        ? {
            ...b,
            link_edges: [
              ...b.link_edges,
              ...b.pages
                .filter((p) => p.outcome === 'fetched')
                .flatMap((p) =>
                  Array.from({ length: n }, (_, i) =>
                    edge(p.url, `${new URL(p.url).origin}/never-crawled/${p.url.length}-${i}`),
                  ),
                ),
            ],
          }
        : b,
    ),
  };
}

/** As the build step does over the bound: each batch's edges through `boundedEdges`, in order. */
function bounded(input: ReturnType<typeof recordedBuild>) {
  const addresses = new Set(rowAddresses(input.batches.filter(isCrawl).flatMap((b) => b.pages)));
  const kept = noEdgesKept();
  return {
    ...input,
    batches: input.batches.map((b) =>
      isCrawl(b) ? { ...b, link_edges: boundedEdges(b.link_edges, addresses, kept) } : b,
    ),
  };
}

describe('the bound on the edges a build holds (F-248)', () => {
  const input = withUncrawledLinks(60);
  const all = buildCheck(input);
  const cut = buildCheck(bounded(input));

  it('cuts only edges to addresses the crawl never fetched, to its per-page share', () => {
    const own = (es: readonly LinkEdge[]) =>
      es.filter((e) => !e.to_url.includes('/never-crawled/'));
    expect(own(cut.link_edges)).toEqual(own(all.link_edges));
    const elsewhere = new Map<string, number>();
    for (const e of cut.link_edges)
      if (e.to_url.includes('/never-crawled/'))
        elsewhere.set(e.from_url, (elsewhere.get(e.from_url) ?? 0) + 1);
    expect(new Set(elsewhere.values())).toEqual(new Set([MAX_OTHER_EDGES_PER_PAGE]));
    expect(cut.link_edges.length).toBeLessThan(all.link_edges.length);
  });

  it('gives the grade the whole graph gives, and the same page facts and fixes', () => {
    expect(cut.check.technical_seo).toEqual(all.check.technical_seo);
    expect(cut.check.ai_readability).toEqual(all.check.ai_readability);
    // `internal_links` counts the edges held, so it alone may differ.
    expect({ ...cut.check.structure!, internal_links: 0 }).toEqual({
      ...all.check.structure!,
      internal_links: 0,
    });
    expect(cut.page_results).toEqual(all.page_results);
    expect(cut.fixes).toEqual(all.fixes);
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
