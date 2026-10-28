import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Budget } from '../batch/budget.js';
import { politeFetch, type FetchContext } from '../batch/polite-fetch.js';
import { systemClock } from '../clock.js';
import { createFetcher } from '../fetch/fetcher.js';
import { CRAWL } from '../identities.js';
import { startServer, type FixtureServer } from '../test-support/http.js';
import { Sites } from './sites.js';

// Real time, real sockets, two batches sharing one site. The guarantee is on request starts, read on
// the clock the limiter keeps (Date.now); arrival times at the site add connection jitter and are
// reported alongside, not asserted on.

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
    // The limiter dispatches at least 500 ms apart on Date.now; the fetcher is entered a fraction of
    // a millisecond later, so its whole-millisecond reading can land on the next tick: 1 ms of slack.
    expect(Math.min(...spacing(starts))).toBeGreaterThanOrEqual(499);
    expect(perSecond(starts)).toBeLessThanOrEqual(2);
  }, 20_000);
});
