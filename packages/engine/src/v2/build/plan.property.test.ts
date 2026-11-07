/**
 * The planners over generated sites (fast-check): the crawl planner run to completion against a site
 * the test defines, the staged sample's bounds and contents, and the render candidates.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CrawlBatchResult } from '@crawlmouse/types/v2';
import {
  CHECK,
  accessBatch,
  accessRow,
  crawlBatch,
  crawlRow,
  edge,
  SITE,
} from '../../../fixtures/v2/build/rows.js';
import { assemble } from './assemble.js';
import { readBatches } from './batches.js';
import {
  CRAWL_BATCH_URLS,
  nextCrawlBatch,
  renderCandidates,
  sample,
  STAGE1_MAX_PAGES,
  STAGE1_TEMPLATES,
  STAGE2_MAX_PAGES,
} from './plan.js';
import type { Seed } from './types.js';

const HOME = 'https://s.test';

/** A site: page i links to the pages in links[i]; some pages are only in the sitemap. */
const site = fc.integer({ min: 1, max: 220 }).chain((n) =>
  fc.record({
    n: fc.constant(n),
    links: fc.array(fc.array(fc.nat(n - 1), { maxLength: 6 }), { minLength: n, maxLength: n }),
    sitemap: fc.array(fc.nat(n - 1), { maxLength: 30 }),
    cap: fc.integer({ min: 1, max: 260 }),
    templates: fc.integer({ min: 1, max: 40 }),
  }),
);

type Site = { n: number; links: number[][]; sitemap: number[]; templates: number };
const url = (s: Site, i: number) => (i === 0 ? HOME : `${HOME}/t${i % s.templates}/page-${i}`);

/** Runs the crawl planner against the site to the end, as CC-20b would, returning every batch. */
function crawl(s: Site, cap: number) {
  const seeds: Seed[] = [
    { url: HOME, source: 'homepage', lastmod: null },
    ...s.sitemap.map((i) => ({ url: url(s, i), source: 'sitemap' as const, lastmod: null })),
  ];
  const batches: CrawlBatchResult[] = [];
  const asked: string[][] = [];
  for (let guard = 0; guard < 100; guard++) {
    const next = nextCrawlBatch(seeds, batches, cap);
    if (next === null) break;
    asked.push(next);
    const index = new Map(Array.from({ length: s.n }, (_, i) => [url(s, i), i]));
    const pages = next.map((u) => crawlRow({ url: u, outcome: 'fetched', status: 200 }));
    const edges = next.flatMap((u) =>
      [...new Set(s.links[index.get(u)!]!)].map((t) => edge(u, url(s, t))),
    );
    const found = [...new Set(edges.map((e) => e.to_url))];
    batches.push(crawlBatch(batches.length, pages, edges, found));
  }
  return { asked, batches, seeds };
}

/** The URLs a breadth-first walk from the homepage and the sitemap reaches. */
function reachable(s: Site): Set<string> {
  const seen = new Set([0, ...s.sitemap]);
  const queue = [...seen];
  while (queue.length) {
    for (const t of s.links[queue.shift()!]!) {
      if (seen.has(t)) continue;
      seen.add(t);
      queue.push(t);
    }
  }
  return new Set([...seen].map((i) => url(s, i)));
}

describe('nextCrawlBatch', () => {
  it(`asks for at most ${CRAWL_BATCH_URLS} URLs a batch, never past the cap, never one twice, homepage first`, () => {
    fc.assert(
      fc.property(site, (s) => {
        const { asked } = crawl(s, s.cap);
        const all = asked.flat();
        expect(asked.every((b) => b.length >= 1 && b.length <= CRAWL_BATCH_URLS)).toBe(true);
        expect(all.length).toBeLessThanOrEqual(s.cap);
        expect(new Set(all).size).toBe(all.length);
        expect(all[0]).toBe(HOME);
      }),
    );
  });

  it('reaches every URL the homepage and sitemap lead to, when the cap allows', () => {
    fc.assert(
      fc.property(site, (s) => {
        const reach = reachable(s);
        const { asked } = crawl(s, reach.size + 1);
        expect(new Set(asked.flat())).toEqual(reach);
      }),
    );
  });
});

/** A crawled site of `n` pages in `t` templates, a few challenged, with stage-1 rows when asked. */
function crawled(
  n: number,
  t: number,
  challenged: number[],
  verdicts?: (u: string) => 'allowed' | 'rate_limited',
) {
  const s: Site = {
    n,
    links: Array.from({ length: n }, (_, i) =>
      i === 0 ? Array.from({ length: n - 1 }, (_, j) => j + 1) : [],
    ),
    sitemap: [],
    templates: t,
  };
  const rows = Array.from({ length: n }, (_, i) =>
    crawlRow({
      url: url(s, i),
      outcome: 'fetched',
      status: 200,
      response: challenged.includes(i) ? 'challenged' : 'served',
    }),
  );
  const edges = rows.slice(1).map((r) => edge(HOME, r.url));
  const batches: unknown[] = [crawlBatch(0, rows, edges)];
  const input = {
    check: { id: CHECK, site_id: SITE, page_cap: 500 } as never,
    homepage_url: HOME,
    seeds: [],
    render: null,
  };
  const at = () =>
    assemble(input, readBatches(batches, { id: CHECK, site_id: SITE }, 'unreleased'));
  const first = sample(at());
  if (!verdicts) return { first, later: first, at };
  let id = 0;
  const tests = first.stage1.flatMap((p) => [
    accessRow(++id, p.url, 'OAI-SearchBot', verdicts(p.url)),
    accessRow(++id, p.url, null, 'allowed', 'control'),
  ]);
  batches.push(accessBatch(1, tests));
  return { first, later: sample(at()), at };
}

const shape = fc.record({
  n: fc.integer({ min: 1, max: 120 }),
  t: fc.integer({ min: 1, max: 40 }),
  challenged: fc.array(fc.integer({ min: 1, max: 119 }), { maxLength: 4 }),
});

describe('sample', () => {
  it(`holds the homepage, up to ${STAGE1_TEMPLATES} templates and ${STAGE1_MAX_PAGES} pages in stage 1, all crawled`, () => {
    fc.assert(
      fc.property(shape, ({ n, t, challenged }) => {
        const { first, at } = crawled(
          n,
          t,
          challenged.filter((c) => c < n),
        );
        const pages = new Map(at().pages.map((p) => [p.url, p]));
        const templates = new Set([...pages.values()].map((p) => p.template_key));
        expect(first.stage1.length).toBeLessThanOrEqual(STAGE1_MAX_PAGES);
        expect(first.stage1[0]!.url).toBe(HOME);
        expect(first.stage1.every((p) => pages.has(p.url))).toBe(true);
        const covered = new Set(first.stage1.map((p) => p.template_key));
        expect(covered.size).toBeLessThanOrEqual(STAGE1_TEMPLATES);
        // With room for every template beside the homepage and two challenged pages, all are covered.
        if (templates.size + 2 <= STAGE1_MAX_PAGES) expect(covered).toEqual(templates);
        expect(first.stage2_needed).toBeNull();
      }),
    );
  });

  it(`adds stage 2 only when a stage-1 verdict differs from the homepage's, up to ${STAGE2_MAX_PAGES} pages in all`, () => {
    fc.assert(
      fc.property(shape, fc.boolean(), ({ n, t }, differ) => {
        const blocked = `${HOME}/t1/page-1`;
        const { later } = crawled(n, t, [], (u) =>
          differ && u === blocked ? 'rate_limited' : 'allowed',
        );
        const differs = differ && later.stage1.some((p) => p.url === blocked);
        expect(later.stage2_needed).toBe(differs);
        expect(later.stage2.length > 0).toBe(differs && n > later.stage1.length);
        const all = [...later.stage1, ...later.stage2].map((p) => p.url);
        expect(all.length).toBeLessThanOrEqual(STAGE2_MAX_PAGES);
        expect(new Set(all).size).toBe(all.length);
      }),
    );
  });

  it('offers only sampled pages as render candidates', () => {
    fc.assert(
      fc.property(shape, ({ n, t }) => {
        const { first, at } = crawled(n, t, []);
        const plan = renderCandidates(at(), first.stage1, [], new Map());
        const sampled = new Set(first.stage1.map((p) => p.url));
        expect(plan.candidates.every((c) => sampled.has(c.url))).toBe(true);
        expect(plan.candidates.length).toBe(sampled.size);
      }),
    );
  });
});
