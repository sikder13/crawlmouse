import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_BATCH_CONCURRENCY } from '../config.js';
import type { Fetcher } from '../fetch/fetcher.js';
import { FLOOR_GAP_MS } from '../politeness/limiter.js';
import { siteKeyOf } from '../politeness/site-key.js';
import { Sites } from '../politeness/sites.js';
import { outcome } from '../test-support/outcome.js';
import { VirtualClock } from '../test-support/virtual-clock.js';
import { BUDGET_CEILINGS, MAX_URLS_PER_BATCH, type BatchRequest } from './request.js';
import { runBatch } from './run.js';
import { RobotsCache } from './site-rules.js';

/**
 * N batches at once, each on a site of its own, sharing one process's politeness state as the server
 * runs them (one Sites, one RobotsCache, one clock). Generated over the number of batches (up to
 * MAX_BATCH_CONCURRENCY), each site's pages and each request's latency, in virtual time.
 *
 * Two properties, each checked against what the fetcher itself saw, not against the worker's report:
 * - every request to a site starts at least FLOOR_GAP_MS after the previous request to that site;
 * - each batch's result holds exactly its own URLs, under its own check id, and nothing of another's.
 */

const checkId = (i: number) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
/** A registrable domain per batch, so each batch is a site of its own to the limiter. */
const hostOf = (i: number) => `site-${i}.example${i}.com`;

const sitePlan = fc.record({
  pages: fc.integer({ min: 1, max: MAX_URLS_PER_BATCH }),
  // Per-request latency in ms, in virtual time; past 500 the limiter's slow-host rule can apply.
  latencies: fc.array(fc.integer({ min: 0, max: 1500 }), { minLength: 1, maxLength: 8 }),
  notFoundEvery: fc.integer({ min: 0, max: 7 }),
  // A Crawl-delay in whole seconds in this site's robots.txt, or none: a site's own gap, never another's.
  crawlDelayS: fc.constantFrom(0, 0, 1, 2),
});

function page(host: string, n: number, pages: number): string {
  const links = [0, n + 1, (n * 3) % pages]
    .filter((k) => k < pages)
    .map((k) => `<a href="https://${host}/p/${k}">page ${k}</a>`)
    .join('');
  return `<!doctype html><html><head><title>${host} ${n}</title></head><body><p>${host} page ${n}</p>${links}</body></html>`;
}

interface Plan {
  pages: number;
  latencies: number[];
  notFoundEvery: number;
  crawlDelayS: number;
}

/**
 * Runs one crawl batch per plan at once, each on its own site, with one Sites, RobotsCache and clock
 * as the server shares them. Returns each site's request starts as the fetcher saw them, by site key.
 */
async function crawlAll(plans: Plan[]) {
  const clock = new VirtualClock();
  const starts = new Map<string, number[]>();
  let call = 0;
  const fetcher: Fetcher = async (url, identity, limits) => {
    const host = new URL(url).hostname;
    const i = Number(/^site-(\d+)\./.exec(host)![1]);
    const plan = plans[i]!;
    const key = siteKeyOf(url);
    starts.set(key, [...(starts.get(key) ?? []), clock.now()]);
    const startedAt = clock.now();
    await clock.sleep(plan.latencies[call++ % plan.latencies.length]!);
    const path = new URL(url).pathname;
    if (path === '/robots.txt' && plan.crawlDelayS > 0) {
      return outcome({
        url,
        identity,
        startedAt,
        status: 200,
        finalUrl: url,
        headers: { 'content-type': 'text/plain' },
        body: `User-agent: *\nAllow: /\nCrawl-delay: ${plan.crawlDelayS}\n`,
        maxBytes: limits.maxBytes,
      });
    }
    const m = /^\/p\/(\d+)$/.exec(path);
    const missing = !m || (plan.notFoundEvery > 0 && Number(m[1]) % plan.notFoundEvery === 0);
    return outcome({
      url,
      identity,
      startedAt,
      status: missing ? 404 : 200,
      finalUrl: url,
      headers: { 'content-type': missing ? 'text/plain' : 'text/html' },
      body: missing ? 'not found' : page(host, Number(m![1]), plan.pages),
      maxBytes: limits.maxBytes,
    });
  };
  const deps = {
    clock,
    sites: new Sites(clock),
    fetcher,
    robotsCache: new RobotsCache(clock),
  };
  const reqs = plans.map(
    (p, i) =>
      ({
        kind: 'crawl' as const,
        check_id: checkId(i),
        site_id: '00000000-0000-4000-8000-0000000000a1',
        batch: 1,
        nonce: 'n'.repeat(16),
        jwt: 'x',
        budget: BUDGET_CEILINGS,
        urls: Array.from({ length: p.pages }, (_, k) => `https://${hostOf(i)}/p/${k}`),
      }) satisfies BatchRequest,
  );

  const results = await clock.run(Promise.all(reqs.map((r) => runBatch(r, deps))));
  return { starts, results, reqs, clock };
}

describe('batches at once on distinct sites', () => {
  it('keep every site at or above the floor and never mix rows between batches (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(sitePlan, { minLength: 2, maxLength: MAX_BATCH_CONCURRENCY }),
        async (plans) => {
          const { starts, results, reqs } = await crawlAll(plans);

          // The floor, per site, start to start, as the fetcher saw the requests.
          expect([...starts.keys()].sort()).toEqual(
            plans.map((_, i) => siteKeyOf(`https://${hostOf(i)}/`)).sort(),
          );
          plans.forEach((plan, i) => {
            const ts = starts.get(siteKeyOf(`https://${hostOf(i)}/`))!;
            // The floor, and after robots.txt is read this site's own Crawl-delay, never another's.
            const own = Math.max(FLOOR_GAP_MS, plan.crawlDelayS * 1000);
            for (let k = 1; k < ts.length; k++) {
              expect(ts[k]! - ts[k - 1]!).toBeGreaterThanOrEqual(k === 1 ? FLOOR_GAP_MS : own);
            }
          });
          // At the same time, not one after another: every site had made its first request before any made its last.
          const firsts = [...starts.values()].map((ts) => ts[0]!);
          const lasts = [...starts.values()].map((ts) => ts.at(-1)!);
          expect(Math.max(...firsts)).toBeLessThan(Math.min(...lasts));
          // Each batch's rows: its own URLs, each once, under its own check id.
          results.forEach((result, i) => {
            if (result.kind !== 'crawl') throw new Error('crawl');
            expect(result.pages.map((p) => p.url).sort()).toEqual([...reqs[i]!.urls].sort());
            for (const p of result.pages) {
              expect(p.check_id).toBe(checkId(i));
              expect(new URL(p.url).hostname).toBe(hostOf(i));
            }
            for (const e of result.link_edges) {
              expect(e.check_id).toBe(checkId(i));
              expect([new URL(e.from_url).hostname, new URL(e.to_url).hostname]).toEqual([
                hostOf(i),
                hostOf(i),
              ]);
            }
            for (const u of result.discovered_urls) expect(new URL(u).hostname).toBe(hostOf(i));
            // The batch found its pages' links: the property is not vacuous over empty results.
            if (plans[i]!.pages > 1 && plans[i]!.notFoundEvery !== 1)
              expect(result.link_edges.length).toBeGreaterThan(0);
          });
        },
      ),
      { numRuns: 40 },
    );
  }, 120_000);

  // The property above holds each site to at least its own gap. This holds it to no more: with one
  // limiter shared by every site, each site would wait its turn behind all the others, N floors a
  // request, and a Crawl-delay on one site would slow the rest.
  it("pace each site on its own: the floor, not every site's turn, and one Crawl-delay stays its own", async () => {
    const plans: Plan[] = Array.from({ length: MAX_BATCH_CONCURRENCY }, (_, i) => ({
      pages: 10,
      latencies: [0],
      notFoundEvery: 0,
      crawlDelayS: i === 0 ? 2 : 0,
    }));
    const { starts } = await crawlAll(plans);
    const gaps = (i: number) => {
      const ts = starts.get(siteKeyOf(`https://${hostOf(i)}/`))!;
      expect(ts.length).toBeGreaterThan(plans[i]!.pages);
      return ts.slice(1).map((t, k) => t - ts[k]!);
    };
    for (let i = 1; i < plans.length; i++) {
      for (const g of gaps(i)) expect(g).toBeLessThan(2 * FLOOR_GAP_MS);
    }
    // Site 0 waits its Crawl-delay once robots.txt is read: its own, and only its own.
    expect(
      gaps(0)
        .slice(1)
        .every((g) => g >= 2000),
    ).toBe(true);
  });
});
