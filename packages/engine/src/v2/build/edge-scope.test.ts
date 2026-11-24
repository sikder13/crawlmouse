import type { CrawlBatchResult, LinkEdge } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { recordedBuild } from '../../../fixtures/v2/build/recorded.js';
import { buildCheck } from './build.js';
import {
  boundedEdges,
  edgeQuota,
  MAX_CHECK_EDGES,
  rowAddresses,
  type EdgeQuota,
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

/** As the build step does over the bound: each batch's edges within the quota, in batch order. */
function bounded(input: ReturnType<typeof recordedBuild>, cap: number) {
  const crawl = input.batches.filter(isCrawl);
  const addresses = new Set(rowAddresses(crawl.flatMap((b) => b.pages)));
  const quota = edgeQuota(
    crawl.reduce((n, b) => n + b.pages.length, 0),
    cap,
  );
  const kept = new Map<string, EdgeQuota>();
  return {
    ...input,
    batches: input.batches.map((b) =>
      isCrawl(b) ? { ...b, link_edges: boundedEdges(b.link_edges, addresses, quota, kept) } : b,
    ),
  };
}

describe('the bound on the edges a build holds (F-248)', () => {
  it('holds at most the bound for 500 pages of 1,000 edges each, edges to its own pages first', () => {
    const pages = Array.from({ length: 500 }, (_, i) => `https://example.com/p${i}`);
    const addresses = new Set(rowAddresses(pages.map((url) => ({ url, final_url: null }))));
    const quota = edgeQuota(pages.length);
    const kept = new Map<string, EdgeQuota>();
    let held = 0;
    let own = 0;
    for (let batch = 0; batch < 10; batch++) {
      const edges = pages
        .slice(batch * 50, batch * 50 + 50)
        .flatMap((from, f) =>
          Array.from({ length: 1000 }, (_, i) =>
            edge(from, i % 2 ? pages[(f + i) % 500]! : `https://example.com/elsewhere/${i}`),
          ),
        );
      const out = boundedEdges(edges, addresses, quota, kept);
      held += out.length;
      own += out.filter((e) => addresses.has(e.to_url)).length;
    }
    expect(held).toBeLessThanOrEqual(MAX_CHECK_EDGES);
    expect(held).toBe(500 * (quota.own + quota.other));
    expect(own).toBe(500 * quota.own);
    expect(quota.own).toBeGreaterThan(quota.other);
  });

  it('over the bound, claims no orphan it cannot prove, where dropping every such edge would', () => {
    const input = withUncrawledLinks(40);
    const all = input.batches.filter(isCrawl).reduce((n, b) => n + b.link_edges.length, 0);
    const cut = buildCheck(bounded(input, Math.floor(all / 4)));
    expect(cut.link_edges.length).toBeLessThanOrEqual(Math.floor(all / 4));
    expect(cut.page_results.filter((p) => p.is_orphan)).toEqual([]);
    // The contrast: keep only edges to the crawl's own pages, and a page with no inbound link is
    // called an orphan, though pages the crawl left unread may link to it.
    const crawl = input.batches.filter(isCrawl);
    const addresses = new Set(rowAddresses(crawl.flatMap((b) => b.pages)));
    const ownOnly = buildCheck({
      ...input,
      batches: input.batches.map((b) =>
        isCrawl(b) ? { ...b, link_edges: b.link_edges.filter((e) => addresses.has(e.to_url)) } : b,
      ),
    });
    expect(ownOnly.page_results.filter((p) => p.is_orphan).length).toBeGreaterThan(0);
  });

  it('answers for a row under its URL and where it landed', () => {
    const addresses = rowAddresses([
      { url: 'https://example.com/a', final_url: 'https://example.com/b-moved' },
      { url: 'https://example.com/c', final_url: null },
    ]);
    expect(addresses).toEqual([
      'https://example.com/a',
      'https://example.com/b-moved',
      'https://example.com/c',
    ]);
  });
});
