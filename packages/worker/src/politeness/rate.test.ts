import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Budget } from '../batch/budget.js';
import { politeFetch, type FetchContext } from '../batch/polite-fetch.js';
import { systemClock } from '../clock.js';
import { createFetcher } from '../fetch/fetcher.js';
import { CRAWL } from '../identities.js';
import { startServer, type FixtureServer } from '../test-support/http.js';
import { Sites } from './sites.js';

// A live measurement, not the contract: limiter.test.ts proves the exact spacing on a fake clock.
// Here two batches share one site in real time over real sockets. Starts are read where the fetcher is
// entered, which a garbage-collection pause or a busy machine can delay by some milliseconds after the
// limiter dispatched, so the assertions allow JITTER_MS for the reading. Arrival times at the site add
// connection jitter on top and are reported, not asserted.
const JITTER_MS = 25;
/** The brief's limit, 2 requests per second, written here rather than read from the limiter it checks. */
const REQUIRED_GAP_MS = 500;

let server: FixtureServer;
const arrivals: number[] = [];
beforeAll(async () => {
  server = await startServer((_req, res) => {
    arrivals.push(performance.now());
    res.end('ok');
  });
});
afterAll(() => server.close());

const spacing = (ts: number[]) => ts.slice(1).map((t, i) => t - ts[i]!);
const perSecond = (ts: number[]) => (ts.length - 1) / ((ts.at(-1)! - ts[0]!) / 1000);

describe('the rate a site sees', () => {
  it('two concurrent batches on one site together start at most 2 requests per second', async () => {
    const sites = new Sites(systemClock);
    const real = createFetcher(systemClock, { bypassSsrf: true });
    const starts: number[] = [];
    const fetcher: typeof real = (url, identity, limits) => {
      starts.push(Date.now());
      return real(url, identity, limits);
    };
    const batch = (): FetchContext => ({
      sites,
      fetcher,
      budget: new Budget({ max_requests: 100, max_bytes: 1_000_000, max_seconds: 60 }, systemClock),
      abort: new AbortController(),
      stopped: null,
    });
    const run = async (ctx: FetchContext, n: number) => {
      for (let i = 0; i < n; i++)
        await politeFetch(ctx, `${server.base}/${i}`, CRAWL, { offSite: 'stop' });
    };
    await Promise.all([run(batch(), 6), run(batch(), 6)]);

    expect(starts).toHaveLength(12);
    expect(arrivals).toHaveLength(12);
    const fmt = (xs: number[]) => `${Math.min(...xs).toFixed(1)}-${Math.max(...xs).toFixed(1)} ms`;
    process.stdout.write(
      `measured starts: ${perSecond(starts).toFixed(3)} req/s, gaps ${fmt(spacing(starts))}; ` +
        `at the site: ${perSecond(arrivals).toFixed(3)} req/s, gaps ${fmt(spacing(arrivals))}\n`,
    );
    expect(Math.min(...spacing(starts))).toBeGreaterThanOrEqual(REQUIRED_GAP_MS - JITTER_MS);
    // Over the whole run the jitter does not add up: eleven gaps span at least 11 x 500 ms.
    expect(starts.at(-1)! - starts[0]!).toBeGreaterThanOrEqual(
      (starts.length - 1) * REQUIRED_GAP_MS - JITTER_MS,
    );
  }, 20_000);
});
