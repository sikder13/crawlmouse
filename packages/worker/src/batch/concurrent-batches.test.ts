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
});

function page(host: string, n: number, pages: number): string {
  const links = [0, n + 1, (n * 3) % pages]
    .filter((k) => k < pages)
    .map((k) => `<a href="https://${host}/p/${k}">page ${k}</a>`)
    .join('');
  return `<!doctype html><html><head><title>${host} ${n}</title></head><body><p>${host} page ${n}</p>${links}</body></html>`;
}

describe('batches at once on distinct sites', () => {
  it('keep every site at or above the floor and never mix rows between batches (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(sitePlan, { minLength: 2, maxLength: MAX_BATCH_CONCURRENCY }),
        async (plans) => {
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
            const m = /^\/p\/(\d+)$/.exec(path);
            const missing =
              !m || (plan.notFoundEvery > 0 && Number(m[1]) % plan.notFoundEvery === 0);
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

          // The floor, per site, start to start, as the fetcher saw the requests.
          expect([...starts.keys()].sort()).toEqual(
            plans.map((_, i) => siteKeyOf(`https://${hostOf(i)}/`)).sort(),
          );
          for (const ts of starts.values()) {
            for (let k = 1; k < ts.length; k++)
              expect(ts[k]! - ts[k - 1]!).toBeGreaterThanOrEqual(FLOOR_GAP_MS);
          }
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
});
