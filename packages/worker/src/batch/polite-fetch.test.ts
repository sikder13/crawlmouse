import http from 'node:http';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFetcher, type Fetcher } from '../fetch/fetcher.js';
import { CRAWL } from '../identities.js';
import { Sites } from '../politeness/sites.js';
import { InstantClock } from '../test-support/clock.js';
import { fakeFetcher, type FakeResponse } from '../test-support/fake-fetcher.js';
import { Budget, type BudgetLimits } from './budget.js';
import { politeFetch, type FetchContext } from './polite-fetch.js';

afterEach(() => vi.restoreAllMocks());

const roomy: BudgetLimits = { max_requests: 100, max_bytes: 10_000_000, max_seconds: 600 };

function context(
  fetcher: Fetcher,
  clock: InstantClock,
  limits: BudgetLimits = roomy,
): FetchContext {
  return {
    sites: new Sites(clock),
    fetcher,
    budget: new Budget(limits, clock),
    abort: new AbortController(),
  };
}

const redirect = (location: string, status = 302): FakeResponse => ({
  status,
  headers: { location },
  body: '',
});

describe('politeFetch: redirects', () => {
  it('follows a same-site chain one paced request at a time', async () => {
    const clock = new InstantClock();
    const routes: Record<string, FakeResponse> = {
      'https://example.com/a': redirect('https://www.example.com/b', 301),
      'https://www.example.com/b': redirect('/c'),
    };
    const fetcher = fakeFetcher(clock, (url) => routes[url] ?? { status: 200 });
    const r = await politeFetch(context(fetcher, clock), 'https://example.com/a', CRAWL, {
      offSite: 'stop',
    });
    expect(fetcher.calls.map((c) => c.url)).toEqual([
      'https://example.com/a',
      'https://www.example.com/b',
      'https://www.example.com/c',
    ]);
    const starts = fetcher.calls.map((c) => c.at);
    expect([starts[1]! - starts[0]!, starts[2]! - starts[1]!]).toEqual([500, 500]);
    expect(r).toMatchObject({
      fetch: {
        url: 'https://example.com/a',
        finalUrl: 'https://www.example.com/c',
        status: 200,
        redirectStop: null,
      },
    });
    if ('fetch' in r) expect(r.fetch.hops).toHaveLength(2);
  });

  it('records an off-site redirect without requesting it', async () => {
    const clock = new InstantClock();
    const fetcher = fakeFetcher(clock, (url) =>
      url.includes('example.com') ? redirect('https://waitroom.example.net/q') : { status: 200 },
    );
    const r = await politeFetch(context(fetcher, clock), 'https://example.com/', CRAWL, {
      offSite: 'stop',
    });
    expect(fetcher.calls).toHaveLength(1);
    expect(r).toMatchObject({
      fetch: { status: 302, finalUrl: 'https://waitroom.example.net/q', redirectStop: 'off_site' },
    });
  });

  it('follows an off-site redirect when told to (robots.txt)', async () => {
    const clock = new InstantClock();
    const fetcher = fakeFetcher(clock, (url) =>
      url.includes('example.com')
        ? redirect('https://cdn.example.net/robots.txt')
        : { status: 200 },
    );
    await politeFetch(context(fetcher, clock), 'https://example.com/robots.txt', CRAWL, {
      offSite: 'follow',
    });
    expect(fetcher.calls.map((c) => c.url)).toEqual([
      'https://example.com/robots.txt',
      'https://cdn.example.net/robots.txt',
    ]);
  });

  it('does not request a redirect target robots.txt disallows, or whose robots.txt cannot be read', async () => {
    for (const stop of ['robots_disallowed', 'robots_unreadable'] as const) {
      const clock = new InstantClock();
      const fetcher = fakeFetcher(clock, (url) =>
        url.endsWith('/a') ? redirect('/private') : { status: 200 },
      );
      const r = await politeFetch(context(fetcher, clock), 'https://example.com/a', CRAWL, {
        offSite: 'stop',
        gate: async () => ({ stop }),
      });
      expect(fetcher.calls).toHaveLength(1);
      expect(r).toMatchObject({
        fetch: { redirectStop: stop, finalUrl: 'https://example.com/private' },
      });
    }
  });

  it('keeps the redirect response when the budget or a stop kept its target from being checked', async () => {
    const clock = new InstantClock();
    const fetcher = fakeFetcher(clock, (url) =>
      url.endsWith('/a') ? redirect('/b') : { status: 200 },
    );
    const r = await politeFetch(context(fetcher, clock), 'https://example.com/a', CRAWL, {
      offSite: 'stop',
      gate: async () => ({ notRequested: { reason: 'budget', budget: 'requests' } }),
    });
    // The redirect response was received, so it is kept; the reason the chain stopped goes alongside.
    expect(r).toMatchObject({
      fetch: { status: 302, redirectStop: 'batch_stopped', finalUrl: 'https://example.com/b' },
      cut: { reason: 'budget', budget: 'requests' },
    });
  });

  it('stops after five redirects', async () => {
    const clock = new InstantClock();
    const fetcher = fakeFetcher(clock, () => redirect('/loop'));
    const r = await politeFetch(context(fetcher, clock), 'https://example.com/loop', CRAWL, {
      offSite: 'stop',
    });
    expect(fetcher.calls).toHaveLength(6);
    expect(r).toMatchObject({ fetch: { redirectStop: 'too_many' } });
  });
});

describe('politeFetch: budgets and stops', () => {
  it('refuses the request after the request budget is spent, and drops queued ones without a start', async () => {
    const clock = new InstantClock();
    const fetcher = fakeFetcher(clock, () => ({ status: 200 }));
    const ctx = context(fetcher, clock, { ...roomy, max_requests: 2 });
    const results = await Promise.all(
      ['a', 'b', 'c', 'd'].map((p) =>
        politeFetch(ctx, `https://example.com/${p}`, CRAWL, { offSite: 'stop' }),
      ),
    );
    expect(fetcher.calls).toHaveLength(2);
    expect(results.slice(2)).toEqual([
      { notRequested: { reason: 'budget', budget: 'requests' } },
      { notRequested: { reason: 'budget', budget: 'requests' } },
    ]);
    expect(ctx.abort.signal.aborted).toBe(true);
    expect(ctx.sites.limiter('example.com').started).toBe(3);
  });

  it('never gives a request more bytes than the batch has left', async () => {
    const clock = new InstantClock();
    const fetcher = fakeFetcher(clock, () => ({ status: 200, body: 'x'.repeat(700) }));
    const ctx = context(fetcher, clock, { ...roomy, max_bytes: 1000 });
    await politeFetch(ctx, 'https://example.com/a', CRAWL, { offSite: 'stop' });
    await politeFetch(ctx, 'https://example.com/b', CRAWL, { offSite: 'stop' });
    expect(fetcher.calls.map((c) => c.limits.maxBytes)).toEqual([1000, 300]);
  });

  it('refuses the request once the time budget is spent', async () => {
    const clock = new InstantClock();
    const fetcher = fakeFetcher(clock, () => ({ status: 200 }));
    const ctx = context(fetcher, clock, { ...roomy, max_seconds: 10 });
    clock.advance(10_000);
    expect(await politeFetch(ctx, 'https://example.com/', CRAWL, { offSite: 'stop' })).toEqual({
      notRequested: { reason: 'budget', budget: 'seconds' },
    });
    expect(fetcher.calls).toHaveLength(0);
  });

  it('stops requesting a site after its third 429', async () => {
    const clock = new InstantClock();
    const fetcher = fakeFetcher(clock, () => ({ status: 429, body: '' }));
    const ctx = context(fetcher, clock);
    for (let i = 0; i < 3; i++)
      await politeFetch(ctx, `https://www.example.com/${i}`, CRAWL, { offSite: 'stop' });
    const r = await politeFetch(ctx, 'https://example.com/next', CRAWL, { offSite: 'stop' });
    expect(r).toMatchObject({
      notRequested: {
        reason: 'site_stopped',
        site: 'example.com',
        stop: { reason: 'three_429_responses' },
      },
    });
    expect(fetcher.calls).toHaveLength(3);
  });
});

describe('politeFetch: SSRF on redirect hops, through the real fetcher', () => {
  /** The first hop must be a public address the guard accepts, which a loopback fixture cannot be, so the transport is stubbed. */
  function stubTransport(location: string): string[] {
    const requested: string[] = [];
    vi.spyOn(http, 'request').mockImplementation(((
      url: URL,
      _o: unknown,
      cb: (res: unknown) => void,
    ) => {
      requested.push(String(url));
      const req = Object.assign(new EventEmitter(), {
        end: () => {
          const res = Object.assign(new PassThrough(), { statusCode: 302, headers: { location } });
          cb(res);
          res.end();
        },
        destroy: () => undefined,
      });
      return req;
    }) as unknown as typeof http.request);
    return requested;
  }
  const resolver = async (h: string) =>
    net.isIP(h) ? [h] : h === 'private.public.test' ? ['10.0.0.9'] : ['93.184.216.34'];

  it('a page that 302s to a private address: the target is off-site, so it is recorded and not requested', async () => {
    const requested = stubTransport('http://10.0.0.7/admin');
    const clock = new InstantClock();
    const r = await politeFetch(
      context(createFetcher(clock, { resolver }), clock),
      'http://public.test/',
      CRAWL,
      { offSite: 'stop' },
    );
    expect(requested).toEqual(['http://public.test/']);
    expect(r).toMatchObject({
      fetch: { redirectStop: 'off_site', finalUrl: 'http://10.0.0.7/admin' },
    });
  });

  it('robots.txt that 302s to the metadata address: the guard refuses the hop', async () => {
    const requested = stubTransport('http://169.254.169.254/latest/meta-data/');
    const clock = new InstantClock();
    const r = await politeFetch(
      context(createFetcher(clock, { resolver }), clock),
      'http://public.test/robots.txt',
      CRAWL,
      { offSite: 'follow' },
    );
    expect(requested).toEqual(['http://public.test/robots.txt']);
    expect(r).toMatchObject({ fetch: { error: 'ssrf_refused', status: null } });
  });

  it('a same-site redirect to a name that resolves to a private address: the guard refuses the hop', async () => {
    const requested = stubTransport('http://private.public.test/x');
    const clock = new InstantClock();
    const r = await politeFetch(
      context(createFetcher(clock, { resolver }), clock),
      'http://public.test/',
      CRAWL,
      { offSite: 'stop' },
    );
    expect(requested).toEqual(['http://public.test/']);
    expect(r).toMatchObject({ fetch: { error: 'ssrf_refused' } });
  });
});
