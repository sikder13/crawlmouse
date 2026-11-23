import { describe, expect, it } from 'vitest';
import type { Fetcher } from '../fetch/fetcher.js';
import { FLOOR_GAP_MS } from '../politeness/limiter.js';
import { Sites } from '../politeness/sites.js';
import { outcome } from '../test-support/outcome.js';
import { VirtualClock } from '../test-support/virtual-clock.js';
import { BUDGET_CEILINGS, type BatchRequest } from './request.js';
import { runBatch } from './run.js';
import { RobotsCache } from './site-rules.js';

/** Two lab hosts through the real batch path, sharing one process's politeness state (F-018). */
const A = 'a.lab.crawlmouse.com';
const B = 'b.lab.crawlmouse.com';
const request = (host: string, i: number, pages: number): BatchRequest => ({
  kind: 'crawl',
  check_id: `00000000-0000-4000-8000-00000000000${i}`,
  site_id: '00000000-0000-4000-8000-0000000000a1',
  batch: 1,
  nonce: 'n'.repeat(16),
  jwt: 'x',
  budget: BUDGET_CEILINGS,
  urls: Array.from({ length: pages }, (_, k) => `https://${host}/p/${k}`),
});

function harness(
  perLabHost: boolean,
  answer: (host: string, path: string) => 'ok' | '429' | 'challenge' | { redirect: string },
  robots = (_host: string) => '',
  robotsRedirect: (host: string) => string | null = () => null,
) {
  const clock = new VirtualClock();
  const seen = new Map<string, number[]>();
  const fetcher: Fetcher = async (url, identity, limits) => {
    const u = new URL(url);
    if (u.pathname.startsWith('/p/'))
      seen.set(u.hostname, [...(seen.get(u.hostname) ?? []), clock.now()]);
    const common = {
      url,
      identity,
      startedAt: clock.now(),
      finalUrl: url,
      maxBytes: limits.maxBytes,
    };
    const movedTo = u.pathname === '/robots.txt' ? robotsRedirect(u.hostname) : null;
    if (movedTo)
      return outcome({ ...common, status: 301, headers: { location: movedTo }, body: '' });
    if (u.pathname === '/robots.txt' && u.hostname === 'elsewhere.test')
      return outcome({
        ...common,
        status: 429,
        headers: { 'content-type': 'text/plain' },
        body: 'slow down',
      });
    if (u.pathname === '/robots.txt')
      return outcome({
        ...common,
        status: 200,
        headers: { 'content-type': 'text/plain' },
        body: `User-agent: *\nAllow: /\n${robots(u.hostname)}`,
      });
    const a = answer(u.hostname, u.pathname);
    if (typeof a === 'object')
      return outcome({
        ...common,
        status: 301,
        headers: { location: a.redirect },
        body: '',
      });
    if (a === '429')
      return outcome({
        ...common,
        status: 429,
        headers: { 'content-type': 'text/plain' },
        body: 'slow down',
      });
    if (a === 'challenge')
      return outcome({
        ...common,
        status: 403,
        headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' },
        body: '<html><title>Just a moment...</title></html>',
      });
    return outcome({
      ...common,
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: `<!doctype html><title>${u.pathname}</title><p>page</p>`,
    });
  };
  const deps = {
    clock,
    sites: new Sites(clock, perLabHost),
    fetcher,
    robotsCache: new RobotsCache(clock),
  };
  return {
    clock,
    seen,
    run: (reqs: BatchRequest[]) => clock.run(Promise.all(reqs.map((r) => runBatch(r, deps)))),
  };
}

describe.each([
  ['three 429s', '429', 3],
  ['four challenged pages', 'challenge', 4],
] as const)('a stop from %s on one lab host', (_name, bad, stopsAfter) => {
  const go = async (perLabHost: boolean) => {
    const h = harness(perLabHost, (host) => (host === A ? bad : 'ok'));
    await h.run([request(A, 1, 6)]);
    await h.run([request(B, 2, 3)]);
    return { a: h.seen.get(A)!.length, b: h.seen.get(B)?.length ?? 0 };
  };

  it('stops that host, and not another lab host, with the setting on', async () => {
    expect(await go(true)).toEqual({ a: stopsAfter, b: 3 });
  });

  it('stops every lab host with it off, as today', async () => {
    expect(await go(false)).toEqual({ a: stopsAfter, b: 0 });
  });
});

describe('pace', () => {
  const gaps = (ts: number[]) => ts.slice(1).map((t, i) => t - ts[i]!);

  it('with the setting on, one lab host’s Crawl-delay stays its own', async () => {
    const h = harness(
      true,
      () => 'ok',
      (host) => (host === A ? 'Crawl-delay: 3\n' : ''),
    );
    await h.run([request(A, 1, 4), request(B, 2, 4)]);
    expect(Math.max(...gaps(h.seen.get(B)!))).toBe(FLOOR_GAP_MS);
    expect(Math.min(...gaps(h.seen.get(A)!))).toBeGreaterThanOrEqual(3000);
  });

  it('with it off, two lab hosts share one limiter, as today', async () => {
    const h = harness(false, () => 'ok');
    await h.run([request(A, 1, 4), request(B, 2, 4)]);
    const all = [...h.seen.get(A)!, ...h.seen.get(B)!].sort((x, y) => x - y);
    expect(Math.min(...gaps(all))).toBeGreaterThanOrEqual(FLOOR_GAP_MS);
  });
});

const accessRequest = (host: string, i: number, pages: number): BatchRequest => {
  const { urls, ...rest } = request(host, i, pages) as Extract<BatchRequest, { kind: 'crawl' }>;
  return {
    ...rest,
    kind: 'access',
    pages: urls.map((url) => ({ url, template_key: '/p/{n}' })),
  };
};
const stops = (r: { findings: readonly { kind: string }[] }) =>
  r.findings
    .filter((f) => f.kind === 'site_stopped')
    .map((f) => (f as unknown as { site: string }).site);

describe('the stop keys on the host that answered', () => {
  const HOSTS = ['a', 'b', 'c', 'd', 'e'].map((x) => `${x}.lab.crawlmouse.com`);
  const TARGET = 'crawlmouse.com';
  const toTarget = (host: string, path: string) =>
    host === TARGET ? ('challenge' as const) : { redirect: `https://${TARGET}${path}` };

  it.each([
    ['crawl', request],
    ['access', accessRequest],
  ] as const)(
    '%s: lab hosts redirecting to one challenged host stop it at four pages',
    async (_k, make) => {
      const h = harness(true, toTarget);
      for (const [i, host] of HOSTS.entries()) await h.run([make(host, i + 1, 3)]);
      // The control is the first request to each page; a stopped host gets no more of them.
      expect(h.seen.get(TARGET)!.length).toBeLessThanOrEqual(4);
    },
  );

  it('a redirect target’s stop is a finding of the batch that caused it', async () => {
    const h = harness(true, (host, path) =>
      host === A ? { redirect: `https://${B}${path}` } : '429',
    );
    const [result] = await h.run([request(A, 1, 3)]);
    expect(stops(result!)).toContain(B);
  });

  it('a stop on the requested host is named by its own key', async () => {
    const h = harness(true, (host) => (host === A ? '429' : 'ok'));
    const [result] = await h.run([request(A, 1, 6)]);
    expect(stops(result!)).toEqual([A]);
  });

  it('with the setting off the same stop is named by the registrable domain', async () => {
    const h = harness(false, (host) => (host === A ? '429' : 'ok'));
    const [result] = await h.run([request(A, 1, 6)]);
    expect(stops(result!)).toEqual([TARGET]);
  });
});

describe('an access batch', () => {
  it('stops a challenged lab host, names it, and leaves another alone', async () => {
    const h = harness(true, (host) => (host === A ? 'challenge' : 'ok'));
    const [first] = await h.run([accessRequest(A, 1, 6)]);
    expect(stops(first!)).toEqual([A]);
    expect(h.seen.get(A)!.length).toBeLessThan(6 * 2);
    const [second] = await h.run([accessRequest(B, 2, 2)]);
    expect(stops(second!)).toEqual([]);
    if (second!.kind !== 'access') throw new Error('access');
    expect(second!.access_tests.every((r) => r.verdict === 'allowed')).toBe(true);
  });
});

describe('off-site does not move with the setting on', () => {
  it('a redirect between two lab hosts is followed and read as served', async () => {
    const h = harness(true, (host, path) =>
      host === A ? { redirect: `https://${B}${path}` } : 'ok',
    );
    const [result] = await h.run([request(A, 1, 1)]);
    if (result!.kind !== 'crawl') throw new Error('crawl');
    const page = result!.pages[0]!;
    expect(page.outcome).toBe('fetched');
    expect(page.final_url).toBe(`https://${B}/p/0`);
    expect(h.seen.get(B)).toHaveLength(1);
  });

  it('an access test of a redirect between two lab hosts is a served page, not redirected away', async () => {
    const h = harness(true, (host, path) =>
      host === A ? { redirect: `https://${B}${path}` } : 'ok',
    );
    const [result] = await h.run([accessRequest(A, 1, 1)]);
    if (result!.kind !== 'access') throw new Error('access');
    expect(result!.access_tests.length).toBeGreaterThan(0);
    expect(result!.access_tests.every((r) => r.verdict === 'allowed')).toBe(true);
  });

  it('a redirect from a lab host to another registrable domain is still not requested', async () => {
    const h = harness(true, (host, path) =>
      host === A ? { redirect: `https://elsewhere.test${path}` } : 'ok',
    );
    await h.run([request(A, 1, 1)]);
    expect(h.seen.get('elsewhere.test')).toBeUndefined();
  });
});

describe('a chain cut short counts against the host that answered', () => {
  const HOSTS = ['c', 'd', 'e', 'f', 'g'].map((x) => `${x}.lab.crawlmouse.com`);

  it.each([
    ['crawl', request],
    ['access', accessRequest],
  ] as const)('%s: a challenged redirect to another domain stops that host', async (_k, make) => {
    const clock = new VirtualClock();
    let atB = 0;
    const fetcher: Fetcher = async (url, identity, limits) => {
      const u = new URL(url);
      const common = {
        url,
        identity,
        startedAt: clock.now(),
        finalUrl: url,
        maxBytes: limits.maxBytes,
      };
      if (u.pathname === '/robots.txt')
        return outcome({
          ...common,
          status: 200,
          headers: { 'content-type': 'text/plain' },
          body: 'User-agent: *\nAllow: /\n',
        });
      if (u.hostname === B) {
        atB += 1;
        return outcome({
          ...common,
          status: 302,
          headers: { location: 'https://elsewhere.test/x', 'cf-mitigated': 'challenge' },
          body: '',
        });
      }
      return outcome({
        ...common,
        status: 301,
        headers: { location: `https://${B}${u.pathname}` },
        body: '',
      });
    };
    const deps = {
      clock,
      sites: new Sites(clock, true),
      fetcher,
      robotsCache: new RobotsCache(clock),
    };
    for (const [i, host] of HOSTS.entries()) await clock.run(runBatch(make(host, i + 1, 3), deps));
    expect(atB).toBeLessThanOrEqual(4);
  });
});

describe('which stops a batch reports', () => {
  it('not one on a site it never requested, from a batch running beside it', async () => {
    const h = harness(true, (host) => (host === 'crawlmouse.com' ? '429' : 'ok'));
    const [mine] = await h.run([request(A, 1, 6), request('crawlmouse.com', 2, 6)]);
    expect(stops(mine!)).toEqual([]);
  });

  it('one on a host it named but sent nothing to, with robots.txt already read', async () => {
    const h = harness(
      true,
      (host, path) => (host === A && path.startsWith('/p/') ? '429' : 'ok'),
      () => 'Disallow: /private\n',
    );
    await h.run([{ ...request(A, 1, 1), urls: [`https://${A}/open`] } as BatchRequest]);
    const named = {
      ...request(A, 2, 1),
      urls: [`https://${A}/private`, ...Array.from({ length: 6 }, (_, k) => `https://${B}/q/${k}`)],
    } as BatchRequest;
    const [, result] = await h.run([request(A, 3, 6), named]);
    expect(stops(result!)).toContain(A);
  });

  it.each([true, false])(
    'not one on another domain that robots.txt redirected to (setting %s)',
    async (on) => {
      const h = harness(
        on,
        (host) => (host === 'elsewhere.test' ? '429' : 'ok'),
        () => '',
        (host) => (host === 'elsewhere.test' ? null : 'https://elsewhere.test/robots.txt'),
      );
      // Three answers stop that domain, and no later request is refused, so no finding is owed.
      const urls = ['a', 'b', 'c'].map((x) => `https://${x}.lab.crawlmouse.com/p/0`);
      const [result] = await h.run([{ ...request(A, 1, 1), urls } as BatchRequest]);
      expect(stops(result!)).not.toContain('elsewhere.test');
    },
  );
});
