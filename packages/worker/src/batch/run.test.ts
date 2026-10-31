import type http from 'node:http';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { createFetcher, MAX_BODY_BYTES } from '../fetch/fetcher.js';
import { CANARY, CRAWL, CRAWLERS, type Identity } from '../identities.js';
import { Sites } from '../politeness/sites.js';
import { InstantClock } from '../test-support/clock.js';
import { fakeFetcher, type FakeResponse } from '../test-support/fake-fetcher.js';
import { whoSent } from '../test-support/discriminators.js';
import { startServer, type FixtureServer } from '../test-support/http.js';
import type { BatchRequest } from './request.js';
import { runBatch, type BatchResult } from './run.js';
import { MAX_ROBOTS_BYTES, MAX_ROBOTS_RULES } from '../politeness/robots.js';
import { siteKeyOf } from '../politeness/site-key.js';
import { MAX_DOM_DEPTH, READ_IN_PART, TOO_DEEP } from '../rows/text.js';
import {
  aboutControl,
  notRequested as notRequestedSay,
  NOT_READ,
  requestFailed as requestFailedSay,
  type ReaderNotRead,
} from '../verdict/limitations.js';
import { inlineReader, type PageReader } from '../reader/read.js';
import { MAX_ROBOTS_ORIGINS, RobotsCache } from './site-rules.js';

const CHECK = '00000000-0000-4000-8000-0000000000c2';
const SITE_ID = '00000000-0000-4000-8000-0000000000a2';
const roomy = { max_requests: 1000, max_bytes: 50_000_000, max_seconds: 1800 };

let server: FixtureServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

interface Site {
  robots?: (res: http.ServerResponse) => void;
  page?: (path: string, ua: string, res: http.ServerResponse) => void;
}

async function serve(site: Site): Promise<FixtureServer> {
  server = await startServer((req, res) => {
    const path = req.url ?? '/';
    if (path === '/robots.txt') {
      if (site.robots) return site.robots(res);
      res.statusCode = 404;
      return res.end();
    }
    if (site.page) return site.page(path, String(req.headers['user-agent'] ?? ''), res);
    res.setHeader('content-type', 'text/html');
    res.end(`<html><body><p>page ${path}</p><a href="/next">next</a></body></html>`);
  });
  return server;
}

const robotsText = (text: string) => (res: http.ServerResponse) => {
  res.setHeader('content-type', 'text/plain');
  res.end(text);
};

function crawlReq(base: string, paths: string[], budget = roomy): BatchRequest {
  return {
    kind: 'crawl',
    check_id: CHECK,
    site_id: SITE_ID,
    batch: 1,
    nonce: 'n'.repeat(16),
    jwt: 'x',
    budget,
    urls: paths.map((p) => `${base}${p}`),
  };
}

function accessReq(base: string, paths: string[], budget = roomy): BatchRequest {
  return {
    kind: 'access',
    check_id: CHECK,
    site_id: SITE_ID,
    batch: 1,
    nonce: 'n'.repeat(16),
    jwt: 'x',
    budget,
    pages: paths.map((p) => ({ url: `${base}${p}`, template_key: '/' })),
  };
}

async function run(
  req: BatchRequest,
  clock = new InstantClock(),
): Promise<{ result: BatchResult; clock: InstantClock }> {
  const result = await runBatch(req, {
    clock,
    sites: new Sites(clock),
    fetcher: createFetcher(clock, { bypassSsrf: true }),
    robotsCache: new RobotsCache(clock),
  });
  return { result, clock };
}

const pagesRequested = (s: FixtureServer) => s.requests.filter((r) => r.url !== '/robots.txt');

/** A batch through the fake fetcher, for sites with more than one origin (www and bare). */
async function runFake(
  req: BatchRequest,
  respond: Parameters<typeof fakeFetcher>[1],
  sites?: (s: Sites) => void,
  reader?: PageReader,
) {
  const clock = new InstantClock();
  const fetcher = fakeFetcher(clock, respond);
  const all = new Sites(clock);
  sites?.(all);
  const result = await runBatch(req, {
    clock,
    sites: all,
    fetcher,
    robotsCache: new RobotsCache(clock),
    reader,
  });
  return { result, requested: fetcher.calls.map((c) => c.url) };
}
/** example.com/a redirects to www.example.com/t; `www` answers the rest. */
const toWww =
  (www: (url: string) => FakeResponse) =>
  (url: string): FakeResponse => {
    if (url === 'https://example.com/robots.txt') return { status: 404, body: '' };
    if (url === 'https://example.com/a')
      return { status: 301, headers: { location: 'https://www.example.com/t' }, body: '' };
    return www(url);
  };

describe('robots.txt unreachable: nothing else is fetched', () => {
  const cases: Array<[string, Site['robots']]> = [
    ['a 500', (res) => void ((res.statusCode = 500), res.end())],
    ['a 503', (res) => void ((res.statusCode = 503), res.end())],
    ['a dropped connection', (res) => res.socket?.destroy()],
    [
      'a challenge',
      (res) => void ((res.statusCode = 403), res.setHeader('cf-mitigated', 'challenge'), res.end()),
    ],
  ];

  it.each(cases)('crawl batch, robots.txt answers with %s', async (_name, robots) => {
    const s = await serve({ robots });
    const { result } = await run(crawlReq(s.base, ['/', '/a']));
    expect(pagesRequested(s)).toHaveLength(0);
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(
      result.pages.every(
        (p) =>
          p.outcome === 'not_requested' && p.limitations[0]!.startsWith('robots.txt unreachable'),
      ),
    ).toBe(true);
    expect(result.partial?.reasons).toContain('robots_unreachable');
    expect(result.coverage.urls_complete).toBe(0);
  });

  it.each(cases)(
    'access batch, robots.txt answers with %s: every crawler is not_measured',
    async (_name, robots) => {
      const s = await serve({ robots });
      const { result } = await run(accessReq(s.base, ['/']));
      expect(pagesRequested(s)).toHaveLength(0);
      if (result.kind !== 'access') throw new Error('access');
      expect(result.access_tests).toHaveLength(CRAWLERS.length);
      for (const r of result.access_tests) {
        expect(r).toMatchObject({ verdict: 'not_measured', evidence_class: 'declared' });
        expect(r.limitations[0]).toMatch(/^robots\.txt unreachable/);
      }
    },
  );

  it('a robots.txt timeout is unreachable', async () => {
    const s = await serve({ robots: () => undefined });
    const { result } = await run(
      crawlReq(s.base, ['/'], { ...roomy, max_seconds: 1 }),
      new InstantClock(),
    );
    expect(pagesRequested(s)).toHaveLength(0);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ kind: 'robots_unreachable', why: 'timeout' }),
    );
  });

  it.each([400, 401, 403, 404, 410])(
    'a %i means no robots.txt: everything is fetched',
    async (status) => {
      const s = await serve({ robots: (res) => void ((res.statusCode = status), res.end()) });
      const { result } = await run(crawlReq(s.base, ['/', '/a']));
      expect(pagesRequested(s)).toHaveLength(2);
      expect(result.partial).toBeNull();
    },
  );
});

describe('robots.txt rules', () => {
  it('a crawl batch never requests a path our groups disallow, under either token', async () => {
    for (const token of ['Crawlmouse', 'CrawlmouseBot', 'crawlmousebot']) {
      const s = await serve({ robots: robotsText(`User-agent: ${token}\nDisallow: /private`) });
      const { result } = await run(crawlReq(s.base, ['/private/1', '/public']));
      expect(pagesRequested(s).map((r) => r.url)).toEqual(['/public']);
      if (result.kind !== 'crawl') throw new Error('crawl');
      expect(result.pages[0]).toMatchObject({
        outcome: 'robots_disallowed',
        evidence_class: 'declared',
      });
      await server!.close();
      server = null;
    }
  });

  it('an access batch never requests a path under a crawler that robots.txt disallows it', async () => {
    const s = await serve({
      robots: robotsText(
        'User-agent: GPTBot\nDisallow: /\n\nUser-agent: PerplexityBot\nDisallow: /a',
      ),
    });
    await run(accessReq(s.base, ['/', '/a']));
    const sent = s.requests.map((r) => ({
      who: whoSent(String(r.headers['user-agent'])),
      url: r.url,
    }));
    expect(sent.filter((x) => x.who === 'GPTBot')).toEqual([]);
    expect(sent.filter((x) => x.who === 'PerplexityBot').map((x) => x.url)).toEqual(['/']);
  });

  it('does not follow a same-site redirect to a path robots.txt disallows', async () => {
    const s = await serve({
      robots: robotsText('User-agent: *\nDisallow: /private'),
      page: (path, _ua, res) => {
        if (path === '/old')
          return void ((res.statusCode = 301), res.setHeader('location', '/private/x'), res.end());
        res.end('ok');
      },
    });
    const { result } = await run(crawlReq(s.base, ['/old']));
    expect(pagesRequested(s).map((r) => r.url)).toEqual(['/old']);
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(result.pages[0]!.limitations[0]).toContain('robots.txt disallows');
  });
});

describe('Crawl-delay', () => {
  it('is honoured between request starts, and 10 s or more marks the batch partial with its coverage', async () => {
    const s = await serve({ robots: robotsText('User-agent: *\nCrawl-delay: 12') });
    const clock = new InstantClock();
    const starts: number[] = [];
    s.requests.length = 0;
    const origFetcher = createFetcher(clock, { bypassSsrf: true });
    const result = await runBatch(crawlReq(s.base, ['/a', '/b', '/c']), {
      clock,
      sites: new Sites(clock),
      fetcher: async (u, i, l) => {
        starts.push(clock.now());
        return origFetcher(u, i, l);
      },
      robotsCache: new RobotsCache(clock),
    });
    expect(
      starts
        .slice(1)
        .map((t, i) => t - starts[i]!)
        .slice(1),
    ).toEqual([12_000, 12_000]);
    expect(result.partial?.reasons).toEqual(['crawl_delay_10s_or_more']);
    expect(result.coverage).toEqual({ urls_requested: 3, urls_complete: 3 });
    expect(result.findings).toContainEqual(
      expect.objectContaining({ kind: 'crawl_delay', declared_s: 12, honoured: true }),
    );
  });

  it('above 30 s, nothing but robots.txt is fetched and the finding says why', async () => {
    const s = await serve({ robots: robotsText('User-agent: *\nCrawl-delay: 31') });
    const { result } = await run(accessReq(s.base, ['/']));
    expect(pagesRequested(s)).toHaveLength(0);
    expect(result.partial?.reasons).toEqual(['crawl_delay_over_limit']);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ kind: 'crawl_delay', declared_s: 31, honoured: false }),
    );
    if (result.kind !== 'access') throw new Error('access');
    expect(
      result.access_tests.every(
        (r) => r.verdict === 'not_measured' && r.limitations[0]!.includes('31 s Crawl-delay'),
      ),
    ).toBe(true);
  });

  it('exactly 30 s is honoured, as a 30 s gap between starts', async () => {
    const s = await serve({ robots: robotsText('User-agent: *\nCrawl-delay: 30') });
    const clock = new InstantClock();
    const starts: number[] = [];
    const real = createFetcher(clock, { bypassSsrf: true });
    await runBatch(crawlReq(s.base, ['/a', '/b']), {
      clock,
      sites: new Sites(clock),
      fetcher: async (u, i, l) => (starts.push(clock.now()), real(u, i, l)),
      robotsCache: new RobotsCache(clock),
    });
    expect(pagesRequested(s)).toHaveLength(2);
    expect(starts[2]! - starts[1]!).toBe(30_000);
  });

  it.each([
    [10, ['crawl_delay_10s_or_more']],
    [9, null],
  ] as const)('a %i s Crawl-delay: partial reasons %j', async (delay, reasons) => {
    const s = await serve({ robots: robotsText(`User-agent: *\nCrawl-delay: ${delay}`) });
    const { result } = await run(crawlReq(s.base, ['/']));
    expect(result.partial?.reasons ?? null).toEqual(reasons);
  });

  it("a crawler's own delay applies to an access batch", async () => {
    const s = await serve({ robots: robotsText('User-agent: GPTBot\nCrawl-delay: 15') });
    const { result } = await run(accessReq(s.base, ['/']));
    expect(result.findings).toContainEqual(
      expect.objectContaining({ kind: 'crawl_delay', declared_s: 15 }),
    );
  });
});

describe('budgets and stops', () => {
  it('a spent request budget marks the batch partial and the unrequested pages say so', async () => {
    const s = await serve({});
    const { result } = await run(
      crawlReq(s.base, ['/a', '/b', '/c', '/d'], { ...roomy, max_requests: 3 }),
    );
    // robots.txt took one request, so two pages were fetched.
    expect(pagesRequested(s)).toHaveLength(2);
    expect(result).toMatchObject({
      requests: 3,
      partial: { reasons: ['budget_requests'] },
      coverage: { urls_requested: 4, urls_complete: 2 },
    });
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(result.pages.filter((p) => p.outcome === 'not_requested')).toHaveLength(2);
  });

  it('four pages in a row with a challenged control stop the site, recorded as a finding', async () => {
    const s = await serve({
      page: (_path, _ua, res) => {
        res.statusCode = 403;
        res.setHeader('cf-mitigated', 'challenge');
        res.end();
      },
    });
    const { result } = await run(accessReq(s.base, ['/1', '/2', '/3', '/4', '/5', '/6']));
    // Four controls, then the site is stopped: pages five and six get nothing.
    expect(pagesRequested(s)).toHaveLength(4);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        kind: 'site_stopped',
        reason: 'four_consecutive_challenged_pages',
      }),
    );
    expect(result.partial?.reasons).toContain('site_stopped');
    if (result.kind !== 'access') throw new Error('access');
    expect(
      result.access_tests.filter((r) => r.ua === null && r.verdict === 'edge_blocks_automation'),
    ).toHaveLength(4);
  });
});

describe('a blocked control', () => {
  it('means no crawler is requested on that page, and each crawler row shows the control as its evidence', async () => {
    const s = await serve({
      page: (_path, ua, res) => {
        if (whoSent(ua) === 'control') {
          res.statusCode = 403;
          res.setHeader('cf-mitigated', 'challenge');
          return res.end();
        }
        res.end('ok');
      },
    });
    const { result } = await run(accessReq(s.base, ['/']));
    const sent = pagesRequested(s).map((r) => whoSent(String(r.headers['user-agent'])));
    expect(sent).toEqual(['control']);
    if (result.kind !== 'access') throw new Error('access');
    const crawlerRows = result.access_tests.filter((r) => r.ua !== null);
    expect(crawlerRows).toHaveLength(CRAWLERS.length);
    for (const r of crawlerRows) {
      expect(r).toMatchObject({
        verdict: 'edge_blocks_automation',
        cause: 'automation_challenge',
        raw_status: 403,
      });
      expect(r.identity_sent).not.toContain('Crawlmouse/2.0');
    }
  });
});

describe('hostile pages cannot spend the worker', () => {
  it('a robots.txt group named __proto__ leaves Object.prototype untouched and the file still applies', async () => {
    const s = await serve({
      robots: robotsText(
        'User-agent: __proto__\nCrawl-delay: 1\nDisallow: /\n\nUser-agent: *\nDisallow: /private',
      ),
    });
    const { result } = await run(crawlReq(s.base, ['/private/a', '/public']));
    expect(({} as Record<string, unknown>).crawlDelay).toBeUndefined();
    expect(pagesRequested(s).map((r) => r.url)).toEqual(['/public']);
    expect(result.partial).toBeNull();
  });

  it('a redirect to a very long URL is not followed, and nothing from it is recorded', async () => {
    const longPath = `/${'p'.repeat(15_000)}`;
    const s = await serve({
      page: (path, _ua, res) => {
        if (path === '/start')
          return void ((res.statusCode = 301), res.setHeader('location', longPath), res.end());
        res.setHeader('content-type', 'text/html');
        res.end(`<body>${'<a href="x">x</a>'.repeat(1000)}</body>`);
      },
    });
    const { result } = await run(crawlReq(s.base, ['/start']));
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(pagesRequested(s).map((r) => r.url)).toEqual(['/start']);
    expect(result.link_edges).toEqual([]);
    expect(result.pages[0]!.limitations.join(' ')).toContain(
      'which was neither requested nor recorded',
    );
    expect(JSON.stringify(result).length).toBeLessThan(100_000);
  });

  it('stops recording text and links once the batch has used its result size, and is partial', async () => {
    // Each page: 1000 links with 2,000-byte anchors to distinct targets, about 2.1 MB of edges.
    const anchors = (p: string) =>
      Array.from({ length: 1000 }, (_, i) => `<a href="/${p}/${i}">${'a'.repeat(2000)}</a>`).join(
        '',
      );
    const s = await serve({
      page: (path, _ua, res) =>
        void (res.setHeader('content-type', 'text/html'),
        res.end(`<body>${anchors(path.slice(1))}</body>`)),
    });
    const { result } = await run(crawlReq(s.base, ['/a', '/b', '/c', '/d', '/e']));
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(result.partial?.reasons).toEqual(['result_size']);
    expect(result.pages.at(-1)!.raw_text).toBeNull();
    expect(result.pages.at(-1)!.limitations.join(' ')).toContain(
      'were not recorded: the batch had used its 8 MiB',
    );
    expect(JSON.stringify(result).length).toBeLessThan(10 * 1024 * 1024);
    // Five 2 MB pages: heavy, so given more than the default time when the suite runs in parallel.
  }, 20_000);
});

describe('crawl batch output', () => {
  it('records the served text, words, distinct same-site links and the canonical', async () => {
    const s = await serve({
      page: (_path, _ua, res) => {
        res.setHeader('content-type', 'text/html');
        res.end(
          '<html><head><link rel="canonical" href="/canon"><script>var x = "not text";</script></head>' +
            '<body><p>Three words here</p><a href="/x">X page</a><a href="/x">again</a><a href="https://other.example/">off</a><a href="/y">click here</a></body></html>',
        );
      },
    });
    const { result } = await run(crawlReq(s.base, ['/page']));
    if (result.kind !== 'crawl') throw new Error('crawl');
    const page = result.pages[0]!;
    expect(page).toMatchObject({
      outcome: 'fetched',
      response: 'served',
      status_code: 200,
      word_count: 9,
      links_out: 2,
      canonical_url: `${s.base}/canon`,
    });
    expect(page.raw_text).toBe('Three words here X page again off click here');
    expect(page.identity_sent).toBe(CRAWL.userAgent);
    expect(
      result.link_edges.map((e) => [e.to_url, e.anchor_text, e.is_generic_anchor, e.js_only]),
    ).toEqual([
      [`${s.base}/x`, 'X page', false, false],
      [`${s.base}/y`, 'click here', true, false],
    ]);
    expect(result.discovered_urls).toEqual([`${s.base}/x`, `${s.base}/y`]);
  });

  it('says how many links it left out when a page has more than it records', async () => {
    const links = Array.from({ length: 1003 }, (_, i) => `<a href="/l${i}">l${i}</a>`).join('');
    const s = await serve({
      page: (_p, _u, res) =>
        void (res.setHeader('content-type', 'text/html'), res.end(`<body>${links}</body>`)),
    });
    const { result } = await run(crawlReq(s.base, ['/']));
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(result.link_edges).toHaveLength(1000);
    expect(result.pages[0]!.links_out).toBe(1003);
    expect(result.pages[0]!.limitations).toContain(
      '3 more same-host links were found on this page and not recorded; 1000 are kept per page.',
    );
  });

  it('records an off-site redirect without requesting the target', async () => {
    const s = await serve({
      page: (_p, _u, res) =>
        void ((res.statusCode = 302),
        res.setHeader('location', 'https://elsewhere.example/'),
        res.end()),
    });
    const { result } = await run(crawlReq(s.base, ['/']));
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(result.pages[0]).toMatchObject({
      response: 'redirected_away',
      status_code: 302,
      final_url: 'https://elsewhere.example/',
    });
  });
});

describe('review fixes: robots.txt is per batch, across origins', () => {
  it('an unreachable robots.txt on one origin keeps the other origin of the site from being fetched too', async () => {
    // www and bare hosts cannot both be served on loopback, so two ports stand in for two origins of
    // one site: both are 127.0.0.1 to the site key, exactly as www.example.com and example.com are.
    const bad = await startServer((req, res) => {
      if (req.url === '/robots.txt') return void ((res.statusCode = 503), res.end());
      res.end('page');
    });
    const good = await startServer((_req, res) => res.end('page'));
    try {
      const { result } = await run(crawlReq('', [`${bad.base}/a`, `${good.base}/b`]));
      expect(bad.requests.map((r) => r.url)).toEqual(['/robots.txt']);
      // Reading stops at the first origin that blocks the site; the other is never asked.
      expect(good.requests).toEqual([]);
      if (result.kind !== 'crawl') throw new Error('crawl');
      expect(result.pages.every((p) => p.outcome === 'not_requested')).toBe(true);
      expect(result.pages[1]!.limitations[0]).toContain(`robots.txt unreachable at ${bad.base}`);
      expect(result.coverage.urls_complete).toBe(0);
    } finally {
      await bad.close();
      await good.close();
    }
  });

  it('an unreachable robots.txt is not cached: the next batch asks again', async () => {
    let robotsUp = false;
    const s = await serve({
      robots: (res) => {
        if (!robotsUp) return void ((res.statusCode = 503), res.end());
        res.setHeader('content-type', 'text/plain');
        res.end('User-agent: *\nAllow: /');
      },
    });
    const clock = new InstantClock();
    const deps = {
      clock,
      sites: new Sites(clock),
      fetcher: createFetcher(clock, { bypassSsrf: true }),
      robotsCache: new RobotsCache(clock),
    };
    await runBatch(crawlReq(s.base, ['/a']), deps);
    robotsUp = true;
    await runBatch({ ...crawlReq(s.base, ['/a']), batch: 2 }, deps);
    expect(pagesRequested(s)).toHaveLength(1);
  });

  it('a batch on an address the SSRF guard refuses requests nothing and says so', async () => {
    const s = await serve({});
    const clock = new InstantClock();
    const result = await runBatch(accessReq(s.base, ['/']), {
      clock,
      sites: new Sites(clock),
      fetcher: createFetcher(clock),
      robotsCache: new RobotsCache(clock),
    });
    expect(s.requests).toHaveLength(0);
    expect(result.partial?.reasons).toEqual(['site_refused']);
    if (result.kind !== 'access') throw new Error('access');
    expect(
      result.access_tests.every(
        (r) =>
          r.verdict === 'not_measured' && r.limitations[0]!.startsWith('The SSRF guard refused'),
      ),
    ).toBe(true);
  });

  it('a Crawl-delay over the limit leaves rows that show the robots.txt read, and say so', async () => {
    const s = await serve({ robots: robotsText('User-agent: *\nCrawl-delay: 45') });
    const { result } = await run(accessReq(s.base, ['/']));
    if (result.kind !== 'access') throw new Error('access');
    for (const r of result.access_tests) {
      expect(r.identity_sent).toBe(CRAWL.userAgent);
      expect(r.limitations[0]).toContain('The request shown is the robots.txt read.');
      expect(r.limitations[0]).not.toContain('would have been sent');
    }
  });
});

describe('review fixes: budgets, stops and coverage', () => {
  it('counts the bytes of responses cut off at their limit, and reports the byte budget', async () => {
    const s = await serve({
      page: (_p, _u, res) =>
        void (res.setHeader('content-type', 'text/html'), res.end('x'.repeat(5000))),
    });
    const { result } = await run(
      crawlReq(s.base, ['/1', '/2', '/3', '/4'], { ...roomy, max_bytes: 2000 }),
    );
    expect(result.bytes).toBeGreaterThanOrEqual(2000);
    expect(result.partial?.reasons).toContain('budget_bytes');
    expect(pagesRequested(s).length).toBeLessThan(4);
  });

  it('a robots.txt bigger than the bytes left is unreachable, and the byte budget is named', async () => {
    const s = await serve({ robots: robotsText(`# ${'x'.repeat(5000)}\nUser-agent: *\nAllow: /`) });
    const { result } = await run(crawlReq(s.base, ['/'], { ...roomy, max_bytes: 1000 }));
    expect(result.findings).toContainEqual(
      expect.objectContaining({ kind: 'robots_unreachable', why: 'byte_budget' }),
    );
    expect(result.partial?.reasons).toEqual(
      expect.arrayContaining(['robots_unreachable', 'budget_bytes']),
    );
  });

  it("records a stop the batch's own last request caused, without calling the batch partial for it", async () => {
    const s = await serve({ page: (_p, _u, res) => void ((res.statusCode = 429), res.end()) });
    const { result } = await run(crawlReq(s.base, ['/1', '/2', '/3']));
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        kind: 'site_stopped',
        reason: 'three_429_responses',
        requests_refused: false,
      }),
    );
    expect(result.partial).toBeNull();
  });

  it('four challenged pages in a crawl batch stop the site too', async () => {
    const s = await serve({
      page: (_p, _u, res) =>
        void ((res.statusCode = 403), res.setHeader('cf-mitigated', 'challenge'), res.end()),
    });
    const { result } = await run(crawlReq(s.base, ['/1', '/2', '/3', '/4', '/5', '/6']));
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        kind: 'site_stopped',
        reason: 'four_consecutive_challenged_pages',
      }),
    );
    expect(pagesRequested(s).length).toBeLessThan(6);
  });

  it('a page whose request failed is not complete', async () => {
    const s = await serve({
      page: (path, _u, res) => (path === '/broken' ? res.socket?.destroy() : res.end('ok')),
    });
    const { result } = await run(crawlReq(s.base, ['/ok', '/broken']));
    expect(result.coverage).toEqual({ urls_requested: 2, urls_complete: 1 });
  });

  it('a redirect to an origin whose robots.txt cannot be read is not followed, and the batch says why', async () => {
    const { result, requested } = await runFake(
      crawlReq('https://example.com', ['/a']),
      toWww((url) => (url.endsWith('/robots.txt') ? { status: 500, body: '' } : { status: 200 })),
    );
    expect(requested).toContain('https://www.example.com/robots.txt');
    expect(requested).not.toContain('https://www.example.com/t');
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(result.pages[0]!.limitations[0]).toContain('could not be read');
    expect(result.partial?.reasons).toContain('robots_unreachable');
  });
});

describe('review fixes: the canary and causes', () => {
  it('does not send the canary to a path robots.txt disallows for Googlebot', async () => {
    const s = await serve({
      robots: robotsText('User-agent: Googlebot\nDisallow: /'),
      page: (_p, ua, res) => {
        const who = whoSent(ua);
        if (who === 'control')
          return void (res.setHeader('content-type', 'text/html'), res.end('<p>ok</p>'));
        res.statusCode = 403;
        res.end('Forbidden');
      },
    });
    const { result } = await run(accessReq(s.base, ['/']));
    expect(s.requests.map((r) => whoSent(String(r.headers['user-agent'])))).not.toContain('canary');
    if (result.kind !== 'access') throw new Error('access');
    const row = result.access_tests.find((r) => r.ua === 'GPTBot')!;
    expect(row.verdict).toBe('refused_unverified');
    expect(row.limitations.join(' ')).toContain(
      'not requested, because robots.txt disallows Googlebot on this path',
    );
  });

  it('a 404 to a crawler while the control was served is a refusal, and brings the canary', async () => {
    const s = await serve({
      page: (_p, ua, res) => {
        const who = whoSent(ua);
        if (who === 'GPTBot') return void ((res.statusCode = 404), res.end());
        res.setHeader('content-type', 'text/html');
        res.end('<p>ok</p>');
      },
    });
    const { result } = await run(accessReq(s.base, ['/']));
    expect(s.requests.map((r) => whoSent(String(r.headers['user-agent'])))).toContain('canary');
    if (result.kind !== 'access') throw new Error('access');
    expect(result.access_tests.find((r) => r.ua === 'GPTBot')!.verdict).toBe('blocked_by_ua_rule');
    const canary = result.access_tests.find((r) => r.identity_sent === CANARY.userAgent)!;
    expect(canary).toMatchObject({ ua: null, verdict: 'allowed' });
    expect(result.access_tests.at(-1)).toBe(canary);
  });

  it("names Cloudflare's 1020 rule as the cause where the refused body carries it", async () => {
    const s = await serve({
      page: (_p, ua, res) => {
        const who = whoSent(ua);
        if (who === 'GPTBot')
          return void ((res.statusCode = 403),
          res.setHeader('server', 'cloudflare'),
          res.end('error code: 1020'));
        res.setHeader('content-type', 'text/html');
        res.end('<p>ok</p>');
      },
    });
    const { result } = await run(accessReq(s.base, ['/']));
    if (result.kind !== 'access') throw new Error('access');
    expect(result.access_tests.find((r) => r.ua === 'GPTBot')).toMatchObject({
      verdict: 'blocked_by_ua_rule',
      cause: 'cloudflare_1020',
    });
    expect(result.access_tests.find((r) => r.ua === 'ClaudeBot')).toMatchObject({
      verdict: 'allowed',
      cause: null,
    });
  });

  it('a crawler given a 200 that is not HTML, against an HTML control, is thin, not allowed', async () => {
    const s = await serve({
      page: (_p, ua, res) => {
        if (whoSent(ua) === 'GPTBot')
          return void (res.setHeader('content-type', 'text/plain'), res.end('Access denied'));
        res.setHeader('content-type', 'text/html');
        res.end(`<p>${'word '.repeat(500)}</p>`);
      },
    });
    const { result } = await run(accessReq(s.base, ['/']));
    if (result.kind !== 'access') throw new Error('access');
    const row = result.access_tests.find((r) => r.ua === 'GPTBot')!;
    expect(row).toMatchObject({ verdict: 'allowed_thin', word_count: 0 });
    expect(row.limitations).toContain(
      'The response was not HTML, so it carries no page text: 0 words.',
    );
  });
});

describe('review round 6: a page the reader gives no answer for fails alone', () => {
  type How = ReaderNotRead;
  const HOW: How[] = ['reader_thread_crashed', 'reader_deadline', 'reader_error'];
  /** The inline reader, except that a body containing `marker` gets no answer, in the way named. */
  const failingOn = (marker: string, how: How): PageReader => {
    const fail = async () => {
      if (how === 'reader_error') throw new TypeError('Invalid URL');
      return { failed: how };
    };
    return {
      words: (body, cut) => (body.includes(marker) ? fail() : inlineReader.words(body, cut)),
      page: (body, cut, url) => (body.includes(marker) ? fail() : inlineReader.page(body, cut, url)),
    };
  };
  const html = (text: string): FakeResponse => ({
    status: 200,
    headers: { 'content-type': 'text/html' },
    body: `<html><body><p>${text}</p></body></html>`,
  });
  const paths = ['/a', '/b', '/c', '/d', '/e', '/f'];
  const crawlWith = (reader: PageReader, body: (url: string) => FakeResponse = (u) => html(`page ${u}`)) =>
    runFake(
      crawlReq('https://example.com', paths),
      (url) => (url.endsWith('/robots.txt') ? { status: 404, body: '' } : body(url)),
      undefined,
      reader,
    );

  it.each(HOW)('fails only that page of a crawl batch, and reads the rest: %s', async (how) => {
    const { result, requested } = await crawlWith(failingOn('example.com/b', how));
    if (result.kind !== 'crawl') throw new Error('crawl');
    const row = (p: string) => result.pages.find((r) => r.url === `https://example.com${p}`)!;
    expect(row('/b')).toMatchObject({ outcome: 'fetched', response: 'served', raw_text: null });
    expect(row('/b').limitations).toContain(NOT_READ[how]);
    for (const p of paths.filter((p) => p !== '/b')) {
      expect(row(p).raw_text, p).toBe(`page https://example.com${p}`);
      expect(requested).toContain(`https://example.com${p}`);
    }
    expect(result.partial).toBeNull();
    expect(result.findings).toEqual([{ kind: 'not_read', reason: how, responses: 1 }]);
    expect(result.coverage.urls_complete).toBe(paths.length - 1);
  });

  it.each(HOW)("leaves only that crawler's row unmeasured in an access batch: %s", async (how) => {
    const { result, requested } = await runFake(
      accessReq('https://example.com', ['/a', '/b']),
      (url, who) =>
        url.endsWith('/robots.txt')
          ? { status: 404, body: '' }
          : html(who.token === 'GPTBot' && url.endsWith('/a') ? 'fail here' : 'served words'),
      undefined,
      failingOn('fail here', how),
    );
    if (result.kind !== 'access') throw new Error('access');
    const gptOnA = result.access_tests.find(
      (r) => r.ua === 'GPTBot' && r.page_url === 'https://example.com/a',
    )!;
    expect(gptOnA.verdict).toBe('not_measured');
    expect(gptOnA.limitations).toContain(NOT_READ[how]);
    const others = result.access_tests.filter((r) => r !== gptOnA && r.ua !== null);
    expect(others.length).toBeGreaterThan(0);
    for (const r of others) expect(r.verdict, `${r.ua} ${r.page_url}`).not.toBe('not_measured');
    expect(requested.filter((u) => u.endsWith('/b')).length).toBeGreaterThan(0);
    expect(result.partial).toBeNull();
    expect(result.findings).toEqual([{ kind: 'not_read', reason: how, responses: 1 }]);
  });

  it('records a page nested past the limit as not measured, and reads on', async () => {
    const deep = `<body>${'<div>'.repeat(MAX_DOM_DEPTH + 1)}x</body>`;
    const { result } = await crawlWith(inlineReader, (u) =>
      u.endsWith('/b') ? { status: 200, headers: { 'content-type': 'text/html' }, body: deep } : html(`page ${u}`),
    );
    if (result.kind !== 'crawl') throw new Error('crawl');
    const b = result.pages.find((r) => r.url === 'https://example.com/b')!;
    expect(b).toMatchObject({ outcome: 'fetched', raw_text: null, word_count: null });
    expect(b.limitations).toContain(TOO_DEEP);
    expect(result.findings).toEqual([
      { kind: 'not_read', reason: 'parse_depth_exceeded', responses: 1 },
    ]);
    expect(result.partial).toBeNull();
    expect(result.coverage.urls_complete).toBe(paths.length - 1);
  });

  it("counts each response not read, and does not fault the site for them", async () => {
    const { result } = await crawlWith(failingOn('page', 'reader_deadline'));
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(result.findings).toEqual([
      { kind: 'not_read', reason: 'reader_deadline', responses: paths.length },
    ]);
    expect(result.pages.every((p) => p.outcome === 'fetched')).toBe(true);
  });
});

describe('review round 5: a failed request says how it failed', () => {
  const ERRORS = ['ssrf_refused', 'dns_failed', 'too_large', 'timeout', 'network'] as const;
  /** As a request made with the worker's own per-response cap says it. */
  const requestFailed = (error: (typeof ERRORS)[number]) =>
    requestFailedSay({ error, maxBytes: MAX_BODY_BYTES });

  it.each(ERRORS)('names %s on a crawl row', async (error) => {
    const { result } = await runFake(crawlReq('https://example.com', ['/a']), (url) =>
      url.endsWith('/robots.txt') ? { status: 404, body: '' } : { error },
    );
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(result.pages[0]).toMatchObject({ outcome: 'failed' });
    expect(result.pages[0]!.limitations).toContain(requestFailed(error));
  });

  const accessWith = (fails: (who: Identity) => boolean, error: (typeof ERRORS)[number]) =>
    runFake(accessReq('https://example.com', ['/']), (url, who) =>
      url.endsWith('/robots.txt')
        ? { status: 404, body: '' }
        : fails(who)
          ? { error }
          : { status: 200, headers: { 'content-type': 'text/html' } },
    );

  it.each(ERRORS)("names %s on a crawler's row when its own request failed", async (error) => {
    const { result } = await accessWith((who) => who.token === 'GPTBot', error);
    if (result.kind !== 'access') throw new Error('access');
    const gpt = result.access_tests.find((r) => r.ua === 'GPTBot')!;
    expect(gpt.limitations).toContain(requestFailed(error));
    const claude = result.access_tests.find((r) => r.ua === 'ClaudeBot')!;
    expect(claude.limitations).not.toContain(requestFailed(error));
  });

  it.each(ERRORS)(
    "names %s on every crawler's row when the control's request failed",
    async (error) => {
      const { result } = await accessWith((who) => who.role === 'control', error);
      if (result.kind !== 'access') throw new Error('access');
      for (const row of result.access_tests.filter((r) => r.ua !== null)) {
        expect(row.limitations, row.ua!).toContain(requestFailed(error));
      }
    },
  );

  it('gives each error class its own sentence', () => {
    expect(new Set(ERRORS.map(requestFailed)).size).toBe(ERRORS.length);
  });

  it('names the cap a response too large went past, which a spent byte budget can lower', () => {
    expect(requestFailedSay({ error: 'too_large', maxBytes: MAX_BODY_BYTES })).toBe(
      'The request failed: the response went past the 10 MiB of decoded body this request could read.',
    );
    expect(requestFailedSay({ error: 'too_large', maxBytes: 5000 })).toContain('the 5000 bytes of');
  });
});

describe('review round 4: a comparison with a control read in part says so', () => {
  it('names the control read in part on a thin row and on an allowed row', async () => {
    // The control's 3 MiB page is counted from its first 2 MiB; GPTBot's 1.2 MiB is under 80% of
    // that count, ClaudeBot gets the control's page.
    const big = `<p>${'word '.repeat(600_000)}</p>`;
    const small = `<p>${'word '.repeat(250_000)}</p>`;
    const s = await serve({
      page: (_p, ua, res) => {
        res.setHeader('content-type', 'text/html');
        res.end(whoSent(ua) === 'GPTBot' ? small : big);
      },
    });
    const { result } = await run(accessReq(s.base, ['/']));
    if (result.kind !== 'access') throw new Error('access');
    const gpt = result.access_tests.find((r) => r.ua === 'GPTBot')!;
    const claude = result.access_tests.find((r) => r.ua === 'ClaudeBot')!;
    expect(gpt.verdict).toBe('allowed_thin');
    expect(claude.verdict).toBe('allowed');
    expect(gpt.limitations).toContain(aboutControl(READ_IN_PART));
    expect(claude.limitations).toContain(aboutControl(READ_IN_PART));
    // ClaudeBot's own response was read in part too, and says so as its own.
    expect(claude.limitations).toContain(READ_IN_PART);
    expect(gpt.limitations).not.toContain(READ_IN_PART);
  }, 60_000);

  it('adds no control note when the control was read whole', async () => {
    const s = await serve({
      page: (_p, _ua, res) => {
        res.setHeader('content-type', 'text/html');
        res.end(`<p>${'word '.repeat(500)}</p>`);
      },
    });
    const { result } = await run(accessReq(s.base, ['/']));
    if (result.kind !== 'access') throw new Error('access');
    for (const r of result.access_tests) {
      expect(r.limitations.some((l) => l.startsWith(aboutControl('')))).toBe(false);
    }
  });
});

describe('review fixes: link extraction is bounded inside a crawl batch', () => {
  it('reads the first 2000 links of a page, records 1000 edges, and says what it did not read', async () => {
    const links = Array.from({ length: 2500 }, (_, i) => `<a href="/l${i}">l</a>`).join('');
    const s = await serve({
      page: (_p, _u, res) =>
        void (res.setHeader('content-type', 'text/html'), res.end(`<body>${links}</body>`)),
    });
    const { result } = await run(crawlReq(s.base, ['/']));
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(result.pages[0]!.links_out).toBe(2000);
    expect(result.link_edges).toHaveLength(1000);
    expect(result.pages[0]!.limitations).toContain(
      '500 links were not read: 500 past the first 2000 on the page.',
    );
  });
});

describe('review fixes: crawl URLs in one spelling', () => {
  it('drops self-links and does not rediscover pages already crawled', async () => {
    const s = await serve({
      page: (_p, _u, res) => {
        res.setHeader('content-type', 'text/html');
        res.end('<a href="/">home</a><a href="/blog/">blog</a><a href="/new">new</a>');
      },
    });
    const { result } = await run(crawlReq(s.base, ['/', '/blog/']));
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(result.link_edges.every((e) => e.from_url !== e.to_url)).toBe(true);
    expect(result.discovered_urls).toEqual([`${s.base}/new`]);
  });
});

describe('review round 2: behaviour the tests did not pin', () => {
  const html = (res: http.ServerResponse, body: string) => {
    res.setHeader('content-type', 'text/html');
    res.end(body);
  };

  it("checks a redirect target against the identity's own robots.txt group", async () => {
    const s = await serve({
      robots: robotsText('User-agent: GPTBot\nDisallow: /private'),
      page: (path, _ua, res) => {
        if (path === '/a')
          return void ((res.statusCode = 301), res.setHeader('location', '/private'), res.end());
        html(res, '<p>ok</p>');
      },
    });
    const { result } = await run(accessReq(s.base, ['/a']));
    const gptbot = s.requests.filter((r) => whoSent(String(r.headers['user-agent'])) === 'GPTBot');
    expect(gptbot.map((r) => r.url)).toEqual(['/a']);
    if (result.kind !== 'access') throw new Error('access');
    expect(result.access_tests.find((r) => r.ua === 'GPTBot')!.limitations.join(' ')).toContain(
      'it redirects to a path robots.txt disallows',
    );
  });

  it('blocks the batch when the unreachable origin is the second one, too', async () => {
    const good = await startServer((_req, res) => res.end('page'));
    const bad = await startServer((req, res) => {
      if (req.url === '/robots.txt') return void ((res.statusCode = 503), res.end());
      res.end('page');
    });
    try {
      const { result } = await run(crawlReq('', [`${good.base}/a`, `${bad.base}/b`]));
      expect(good.requests.map((r) => r.url)).toEqual(['/robots.txt']);
      expect(bad.requests.map((r) => r.url)).toEqual(['/robots.txt']);
      expect(result.partial?.reasons).toEqual(['robots_unreachable']);
    } finally {
      await good.close();
      await bad.close();
    }
  });

  it('does not rediscover a page reached through a redirect', async () => {
    const s = await serve({
      page: (path, _ua, res) => {
        if (path === '/old')
          return void ((res.statusCode = 301), res.setHeader('location', '/new'), res.end());
        html(res, '<a href="/new">new</a><a href="/other-new">other</a>');
      },
    });
    const { result } = await run(crawlReq(s.base, ['/old', '/other']));
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(result.discovered_urls).toEqual([`${s.base}/other-new`]);
  });

  it('counts an access page with an unmeasured crawler as incomplete', async () => {
    const s = await serve({
      page: (path, _ua, res) =>
        path === '/broken' ? res.socket?.destroy() : html(res, '<p>ok</p>'),
    });
    const { result } = await run(accessReq(s.base, ['/ok', '/broken']));
    expect(result.coverage).toEqual({ urls_requested: 2, urls_complete: 1 });
  });

  it("names Cloudflare's 1020 rule when it is the control that was refused with it", async () => {
    const s = await serve({
      page: (_p, _u, res) =>
        void ((res.statusCode = 403),
        res.setHeader('server', 'cloudflare'),
        res.end('error code: 1020')),
    });
    const { result } = await run(accessReq(s.base, ['/']));
    if (result.kind !== 'access') throw new Error('access');
    expect(result.access_tests).toHaveLength(1 + CRAWLERS.length);
    expect(
      result.access_tests.every(
        (r) => r.verdict === 'edge_blocks_automation' && r.cause === 'cloudflare_1020',
      ),
    ).toBe(true);
  });

  it('names the challenge marker on rows whose evidence is a challenged control', async () => {
    const s = await serve({
      page: (_p, _u, res) =>
        void ((res.statusCode = 403), res.setHeader('cf-mitigated', 'challenge'), res.end()),
    });
    const { result } = await run(accessReq(s.base, ['/']));
    if (result.kind !== 'access') throw new Error('access');
    for (const r of result.access_tests.filter((x) => x.ua !== null)) {
      expect(r.limitations).toContain('Recognised as a challenge by the cf-mitigated header.');
    }
  });

  it('a control answered 404 is not measured, and so is every crawler on that page', async () => {
    const s = await serve({ page: (_p, _u, res) => void ((res.statusCode = 404), res.end()) });
    const { result } = await run(accessReq(s.base, ['/']));
    if (result.kind !== 'access') throw new Error('access');
    expect(result.access_tests.every((r) => r.verdict === 'not_measured')).toBe(true);
    expect(result.access_tests.filter((r) => r.ua === null)).toHaveLength(1);
  });

  it('a page over 10 MiB is read in part, and the batch is charged only what was read', async () => {
    const big = 'x'.repeat(11 * 1024 * 1024);
    const s = await serve({
      page: (path, _u, res) => (path === '/big' ? html(res, big) : html(res, '<p>small</p>')),
    });
    const { result } = await run(crawlReq(s.base, ['/big', '/small']));
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(result.pages.map((p) => p.outcome)).toEqual(['fetched', 'fetched']);
    expect(result.pages[0]!.limitations).toContain(READ_IN_PART);
    expect(result.bytes).toBeLessThan(3 * 1024 * 1024);
    expect(result.partial).toBeNull();
  });

  it('records the edges of a card link and the heading link inside it', async () => {
    const s = await serve({
      page: (_p, _u, res) =>
        html(res, '<a href="/card"><h2><a href="/title">Title</a></h2><p>Summary</p></a>'),
    });
    const { result } = await run(crawlReq(s.base, ['/']));
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(result.link_edges.map((e) => e.to_url)).toEqual([`${s.base}/card`, `${s.base}/title`]);
  });

  it('does not parse a 200 that is not HTML for links or text', async () => {
    const s = await serve({
      page: (_p, _u, res) =>
        void (res.setHeader('content-type', 'text/plain'), res.end('<a href="/x">x</a>')),
    });
    const { result } = await run(crawlReq(s.base, ['/']));
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(result.link_edges).toEqual([]);
    expect(result.pages[0]!.raw_text).toBeNull();
  });

  it('records no edge to share-action or media links, as the engine v2 crawl does', async () => {
    const s = await serve({
      page: (_p, _u, res) =>
        html(
          res,
          '<a href="/page">p</a><a href="/doc.pdf">d</a><a href="/post?share=facebook">s</a>',
        ),
    });
    const { result } = await run(crawlReq(s.base, ['/']));
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(result.link_edges.map((e) => e.to_url)).toEqual([`${s.base}/page`]);
  });

  it('records a stop already in force when the batch begins, and the batch is partial for it', async () => {
    const s = await serve({});
    const clock = new InstantClock();
    const sites = new Sites(clock);
    for (let i = 0; i < 3; i++) sites.record429('127.0.0.1');
    const result = await runBatch(crawlReq(s.base, ['/']), {
      clock,
      sites,
      fetcher: createFetcher(clock, { bypassSsrf: true }),
      robotsCache: new RobotsCache(clock),
    });
    expect(s.requests).toHaveLength(0);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ kind: 'site_stopped', requests_refused: true }),
    );
    expect(result.partial?.reasons).toEqual(['site_stopped']);
  });

  it('a crawl batch on an address the SSRF guard refuses records its pages as failed', async () => {
    const s = await serve({});
    const clock = new InstantClock();
    const result = await runBatch(crawlReq(s.base, ['/']), {
      clock,
      sites: new Sites(clock),
      fetcher: createFetcher(clock),
      robotsCache: new RobotsCache(clock),
    });
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(result.pages[0]!.outcome).toBe('failed');
  });

  it("a canary answered 404 reads refused_unverified on its own row, and the crawler's row says what it got", async () => {
    const s = await serve({
      page: (_p, ua, res) => {
        const who = whoSent(ua);
        if (who === 'GPTBot') return void ((res.statusCode = 403), res.end());
        if (who === 'canary') return void ((res.statusCode = 404), res.end());
        html(res, '<p>ok</p>');
      },
    });
    const { result } = await run(accessReq(s.base, ['/']));
    if (result.kind !== 'access') throw new Error('access');
    expect(result.access_tests.find((r) => r.identity_sent === CANARY.userAgent)).toMatchObject({
      verdict: 'refused_unverified',
    });
    expect(result.access_tests.find((r) => r.ua === 'GPTBot')!.limitations.join(' ')).toContain(
      'The tagged Googlebot request on this page got 404 or 410',
    );
  });

  it('keeps a redirect response the batch stopped before following, and says why', async () => {
    // robots.txt and the page take the two requests; the target's robots.txt finds none left.
    const { result, requested } = await runFake(
      crawlReq('https://example.com', ['/a'], { ...roomy, max_requests: 2 }),
      toWww(() => ({ status: 200 })),
    );
    expect(requested.filter((u) => u.includes('www.'))).toEqual([]);
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(result.pages[0]).toMatchObject({ outcome: 'fetched', status_code: 301 });
    expect(result.pages[0]!.limitations[0]).toBe(
      "The page was not read: it redirects, and the batch's requests budget was spent before the target was requested.",
    );
    expect(result.coverage.urls_complete).toBe(0);
    expect(result.partial?.reasons).toEqual(['budget_requests']);
  });

  it("attributes the control's notes on a crawler row that could not be compared", async () => {
    const deep = `<body>${'<div>'.repeat(600)}x</body>`;
    const s = await serve({
      page: (_p, ua, res) => html(res, whoSent(ua) === 'control' ? deep : '<p>a b c</p>'),
    });
    const { result } = await run(accessReq(s.base, ['/']));
    if (result.kind !== 'access') throw new Error('access');
    const row = result.access_tests.find((r) => r.ua === 'GPTBot')!;
    expect(row.verdict).toBe('not_measured');
    expect(
      row.limitations.some((l) =>
        l.startsWith("About the browser control's response: The page nests elements"),
      ),
    ).toBe(true);
  });
});

describe('round 4: robots.txt too large to evaluate', () => {
  const tooLarge = (s: string) => s.startsWith('robots.txt too large to evaluate');
  // Four times the cap, so a request that read it whole would show in the batch's bytes.
  const bigFile = `User-agent: *\nAllow: /\n${'#'.repeat(4 * MAX_ROBOTS_BYTES)}\n`;
  const manyRules = `User-agent: GPTBot\n${Array.from({ length: MAX_ROBOTS_RULES + 1 }, (_, i) => `Disallow: /p${i}`).join('\n')}\n`;

  it.each([
    ['over 500 KiB', bigFile, 'bytes'],
    [`over ${MAX_ROBOTS_RULES} rules in a group`, manyRules, 'rules'],
  ])(
    'an access batch, robots.txt %s: nothing else is fetched, every row is not_measured and says why',
    async (_n, text, why) => {
      const s = await serve({ robots: robotsText(text) });
      const { result } = await run(accessReq(s.base, ['/', '/a']));
      expect(pagesRequested(s)).toHaveLength(0);
      if (result.kind !== 'access') throw new Error('access');
      expect(result.access_tests).toHaveLength(2 * CRAWLERS.length);
      for (const row of result.access_tests) {
        expect(row.verdict).toBe('not_measured');
        expect(tooLarge(row.limitations[0]!)).toBe(true);
      }
      expect(result.robots[0]).toMatchObject({ state: 'too_large', why });
      expect(result.findings).toContainEqual(
        expect.objectContaining({ kind: 'robots_too_large', origin: s.base, why }),
      );
      expect(result.partial?.reasons).toContain('robots_too_large');
    },
  );

  it('a crawl batch, robots.txt over 500 KiB: no page is requested and each says why', async () => {
    const s = await serve({ robots: robotsText(bigFile) });
    const { result } = await run(crawlReq(s.base, ['/', '/a']));
    expect(pagesRequested(s)).toHaveLength(0);
    if (result.kind !== 'crawl') throw new Error('crawl');
    for (const p of result.pages) {
      expect(p.outcome).toBe('not_requested');
      expect(tooLarge(p.limitations[0]!)).toBe(true);
      expect(p.limitations[0]).toContain(`larger than the ${MAX_ROBOTS_BYTES / 1024} KiB`);
    }
    // The request read no more of the file than the cap and the chunk that went past it.
    expect(result.bytes).toBeLessThanOrEqual(MAX_ROBOTS_BYTES + 65_536);
  });

  it('reads a robots.txt of exactly 500 KiB after a BOM, which the cap does not count', async () => {
    const head = 'User-agent: *\nDisallow: /private\n';
    const s = await serve({
      robots: robotsText(`\uFEFF${head}${'#'.repeat(512_000 - head.length)}`),
    });
    const { result } = await run(crawlReq(s.base, ['/a']));
    expect(result.robots[0]).toMatchObject({ state: 'rules' });
    expect(pagesRequested(s).map((r) => r.url)).toEqual(['/a']);
  });

  it('is too large to evaluate, not the byte budget, when the budget had more left than the cap', async () => {
    const s = await serve({ robots: robotsText(bigFile) });
    const { result } = await run(crawlReq(s.base, ['/'], { ...roomy, max_bytes: 1_000_000 }));
    expect(result.robots[0]).toMatchObject({ state: 'too_large', why: 'bytes' });
    expect(result.partial?.reasons).toEqual(['robots_too_large']);
  });
});

describe('round 4: robots.txt origins per batch', () => {
  it(`reads robots.txt for at most ${MAX_ROBOTS_ORIGINS} origins; a redirect to one more is not followed`, async () => {
    const clock = new InstantClock();
    // Each page redirects to the same path on a new subdomain of the site.
    const fetcher = fakeFetcher(clock, (url) => {
      const u = new URL(url);
      if (u.pathname === '/robots.txt') return { status: 404, body: '' };
      // /a goes through s1, s2 and on; /b through s11, s12 and on.
      const n = Number(/^s(\d+)\./.exec(u.hostname)?.[1] ?? (u.pathname === '/a' ? 0 : 10));
      return {
        status: 301,
        headers: { location: `https://s${n + 1}.example.com${u.pathname}` },
        body: '',
      };
    });
    const req = crawlReq('https://example.com', ['/a', '/b']);
    const result = await runBatch(req, {
      clock,
      sites: new Sites(clock),
      fetcher,
      robotsCache: new RobotsCache(clock),
    });
    const origins = new Set(fetcher.calls.map((c) => new URL(c.url).origin));
    expect(origins.size).toBe(8);
    expect(result.robots).toHaveLength(MAX_ROBOTS_ORIGINS);
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(result.pages.map((p) => p.limitations[0])).toContainEqual(
      expect.stringContaining(`had already read robots.txt for ${MAX_ROBOTS_ORIGINS} origins`),
    );
  });

  it('does not follow a redirect to a URL that is not http or https, and the batch completes', async () => {
    for (const location of ['foo://example.com/x', 'file:///etc/passwd', 'ftp://example.com/y']) {
      const s = await serve({
        page: (_p, _u, res) =>
          void ((res.statusCode = 302), res.setHeader('location', location), res.end()),
      });
      const { result } = await run(crawlReq(s.base, ['/a']));
      if (result.kind !== 'crawl') throw new Error('crawl');
      expect(result.pages[0]!.limitations[0]).toBe(
        'The page was not read: it redirects to a URL that is not http or https, which was not requested.',
      );
      expect(result.robots).toHaveLength(1);
      await s.close();
      server = null;
    }
  });
});

describe('round 4: review round 3 minors', () => {
  const trailingSlash = (path: string, _ua: string, res: http.ServerResponse) => {
    if (path === '/a')
      return void ((res.statusCode = 301), res.setHeader('location', '/a/'), res.end());
    res.setHeader('content-type', 'text/html');
    res.end('<html><body><p>page</p></body></html>');
  };

  it('keeps a redirect response when the budget refuses its next hop on the same origin', async () => {
    const s = await serve({ page: trailingSlash });
    // robots.txt and /a take the two requests; /a/ finds none left.
    const { result } = await run(crawlReq(s.base, ['/a'], { ...roomy, max_requests: 2 }));
    expect(pagesRequested(s).map((r) => r.url)).toEqual(['/a']);
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(result.pages[0]).toMatchObject({ outcome: 'fetched', status_code: 301 });
    expect(result.pages[0]!.limitations[0]).toBe(
      "The page was not read: it redirects, and the batch's requests budget was spent before the target was requested.",
    );
    expect(result.coverage.urls_complete).toBe(0);
    expect(result.partial?.reasons).toEqual(['budget_requests']);
  });

  it("keeps the control's row when the budget refuses its redirect's next hop", async () => {
    const s = await serve({ page: trailingSlash });
    const { result } = await run(accessReq(s.base, ['/a'], { ...roomy, max_requests: 2 }));
    expect(pagesRequested(s).map((r) => r.url)).toEqual(['/a']);
    if (result.kind !== 'access') throw new Error('access');
    const control = result.access_tests.find((r) => r.ua === null)!;
    expect(control).toMatchObject({ raw_status: 301, verdict: 'not_measured' });
    expect(control.limitations).toContain(
      "The page was not read: it redirects, and the batch's requests budget was spent before the target was requested.",
    );
  });
});

describe('round 4: discovered URLs', () => {
  it('discovers a redirect target the batch did not request', async () => {
    const s = await serve({
      page: (path, _ua, res) => {
        if (path === '/a')
          return void ((res.statusCode = 301), res.setHeader('location', '/t'), res.end());
        res.setHeader('content-type', 'text/html');
        res.end('<html><body><a href="/t">t</a></body></html>');
      },
    });
    // robots.txt, /c and /a take the three requests; /t is never requested.
    const { result } = await run(crawlReq(s.base, ['/c', '/a'], { ...roomy, max_requests: 3 }));
    expect(
      pagesRequested(s)
        .map((r) => r.url)
        .sort(),
    ).toEqual(['/a', '/c']);
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(result.discovered_urls).toEqual([`${s.base}/t`]);
  });

  it('does not rediscover a page reached through a redirect it followed', async () => {
    const s = await serve({
      page: (path, _ua, res) => {
        if (path === '/a')
          return void ((res.statusCode = 301), res.setHeader('location', '/t'), res.end());
        res.setHeader('content-type', 'text/html');
        res.end('<html><body><a href="/t">t</a></body></html>');
      },
    });
    const { result } = await run(crawlReq(s.base, ['/c', '/a']));
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(result.discovered_urls).toEqual([]);
  });
});

describe('round 4: behaviour review round 3 found unpinned', () => {
  const html = (res: http.ServerResponse, body: string, type = 'text/html') => {
    res.setHeader('content-type', type);
    res.end(body);
  };
  const rowOf = (result: BatchResult, ua: string | null) => {
    if (result.kind !== 'access') throw new Error('access');
    return result.access_tests.find((r) => r.ua === ua)!;
  };

  it('an access page where the control was served and one crawler was not measured is incomplete', async () => {
    const s = await serve({
      page: (_p, ua, res) =>
        whoSent(ua) === 'GPTBot' ? res.socket?.destroy() : html(res, '<p>ok</p>'),
    });
    const { result } = await run(accessReq(s.base, ['/ok']));
    expect(rowOf(result, null).verdict).toBe('allowed');
    expect(rowOf(result, 'GPTBot').verdict).toBe('not_measured');
    expect(rowOf(result, 'ClaudeBot').verdict).toBe('allowed');
    expect(result.coverage).toEqual({ urls_requested: 1, urls_complete: 0 });
  });

  /** Two 429s recorded, and a second origin of the site whose robots.txt answers the third. */
  async function stopMidChain(kind: 'crawl' | 'access') {
    const req =
      kind === 'crawl'
        ? crawlReq('https://example.com', ['/a'])
        : accessReq('https://example.com', ['/a']);
    const { result, requested } = await runFake(
      req,
      toWww((url) =>
        url.endsWith('/robots.txt') ? { status: 429, body: '' } : html200('<p>t</p>'),
      ),
      (sites) => {
        sites.record429(siteKeyOf('https://example.com'));
        sites.record429(siteKeyOf('https://example.com'));
      },
    );
    return { result, targetRequested: requested.includes('https://www.example.com/t') };
  }
  const html200 = (body: string): FakeResponse => ({
    status: 200,
    headers: { 'content-type': 'text/html' },
    body,
  });

  it('a crawl batch whose redirect a site stop cut is partial for the stop', async () => {
    const { result, targetRequested } = await stopMidChain('crawl');
    expect(targetRequested).toBe(false);
    expect(result.partial?.reasons).toEqual(['site_stopped']);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ kind: 'site_stopped', requests_refused: true }),
    );
  });

  it('an access batch whose control redirect a site stop cut is partial for the stop, and says how the control ended', async () => {
    const { result, targetRequested } = await stopMidChain('access');
    expect(targetRequested).toBe(false);
    expect(result.partial?.reasons).toEqual(['site_stopped']);
    expect(rowOf(result, 'GPTBot').limitations[0]).toBe(
      "The browser control was not served (it ended on a redirect that was not followed), so there is no baseline to read the crawler's response against.",
    );
  });

  it('a 0-word control and a crawler response of another type are not compared, and the row says why', async () => {
    const s = await serve({
      page: (_p, ua, res) =>
        whoSent(ua) === 'GPTBot'
          ? html(res, 'plain', 'text/plain')
          : html(res, '{}', 'application/json'),
    });
    const { result } = await run(accessReq(s.base, ['/']));
    const row = rowOf(result, 'GPTBot');
    expect(row.verdict).toBe('not_measured');
    expect(row.limitations).toContain(
      "The control had no words and the crawler's response was of another type, so the crawler's access is not measured against the control.",
    );
    expect(rowOf(result, 'ClaudeBot').verdict).toBe('allowed');
  });

  it('reads a media type without its parameters when comparing', async () => {
    const s = await serve({
      page: (_p, ua, res) =>
        whoSent(ua) === 'control'
          ? html(res, '{}', 'application/json; charset=utf-8')
          : html(res, '{}', 'application/json'),
    });
    const { result } = await run(accessReq(s.base, ['/']));
    if (result.kind !== 'access') throw new Error('access');
    expect(result.access_tests.filter((r) => r.ua !== null).map((r) => r.verdict)).toEqual(
      CRAWLERS.map(() => 'allowed'),
    );
  });

  it('says which side could not be counted when it was the control', async () => {
    const deep = `<body>${'<div>'.repeat(600)}x</body>`;
    const s = await serve({
      page: (_p, ua, res) => html(res, whoSent(ua) === 'control' ? deep : '<p>ok</p>'),
    });
    const { result } = await run(accessReq(s.base, ['/']));
    expect(rowOf(result, 'GPTBot').limitations).toContain(
      "The words in the control's response could not be counted, so the crawler's access is not measured against the control.",
    );
  });

  it('names the budget that kept the canary from being sent', async () => {
    const s = await serve({
      page: (_p, ua, res) =>
        whoSent(ua) === 'GPTBot'
          ? void ((res.statusCode = 403), res.end())
          : html(res, '<p>ok</p>'),
    });
    // robots.txt, the control and the six crawlers spend the eight requests.
    const { result } = await run(accessReq(s.base, ['/'], { ...roomy, max_requests: 8 }));
    expect(rowOf(result, 'GPTBot').limitations).toContain(
      "The tagged Googlebot request on this page was not requested, because the batch's requests budget was spent, so this refusal cannot be told apart from IP verification. OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-SearchBot and ClaudeBot were served on this page.",
    );
  });

  it('says the canary ended on a redirect, not that it failed', async () => {
    const s = await serve({
      robots: robotsText('User-agent: Googlebot\nDisallow: /blocked\n'),
      page: (_p, ua, res) => {
        const who = whoSent(ua);
        if (who === 'canary')
          return void ((res.statusCode = 301), res.setHeader('location', '/blocked'), res.end());
        if (who === 'GPTBot') return void ((res.statusCode = 403), res.end());
        html(res, '<p>ok</p>');
      },
    });
    const { result } = await run(accessReq(s.base, ['/p']));
    expect(rowOf(result, 'GPTBot').limitations[1]).toMatch(
      /^The tagged Googlebot request on this page ended on a redirect that was not followed, so this refusal cannot be told apart from IP verification\./,
    );
  });

  it('records no edge to a link whose absolute URL is over the length limit, and says so', async () => {
    // The href is under 2,048 characters; the URL it resolves to is not.
    const s = await serve({
      page: (_p, _u, res) => html(res, `<a href="/${'p'.repeat(2040)}">x</a><a href="/ok">ok</a>`),
    });
    const { result } = await run(crawlReq(s.base, ['/']));
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(result.link_edges.map((e) => e.to_url)).toEqual([`${s.base}/ok`]);
    expect(result.pages[0]!.limitations).toContain(
      '1 link was not read: 1 with a URL over 2048 characters.',
    );
  });

  it('says a crawl page was read in part when its body was cut', async () => {
    const s = await serve({ page: (_p, _u, res) => html(res, `<p>${'w '.repeat(1_500_000)}</p>`) });
    const { result } = await run(crawlReq(s.base, ['/']));
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(result.pages[0]!.limitations).toContain(READ_IN_PART);
  });
});

describe('round 4: a batch that fails stops', () => {
  it('requests no more pages once the batch has failed', async () => {
    const clock = new InstantClock();
    const fetcher = fakeFetcher(clock, (url) => {
      if (url.endsWith('/robots.txt')) return { status: 404, body: '' };
      if (url.endsWith('/p0')) throw new Error('an internal fault');
      return { status: 200 };
    });
    const urls = Array.from({ length: 20 }, (_, i) => `/p${i}`);
    await expect(
      runBatch(crawlReq('https://example.com', urls), {
        clock,
        sites: new Sites(clock),
        fetcher,
        robotsCache: new RobotsCache(clock),
      }),
    ).rejects.toThrow('an internal fault');
    await new Promise((resolve) => setTimeout(resolve, 200));
    // p0, and at most the page the other worker had already started.
    expect(fetcher.calls.filter((c) => !c.url.endsWith('/robots.txt')).length).toBeLessThanOrEqual(
      2,
    );
  });
});

describe('round 4: what an access page holds while it is read', () => {
  it('holds the earlier responses of a page only as the start it keeps of each', async () => {
    setFlagsFromString('--expose-gc');
    const gc = runInNewContext('gc') as () => void;
    const clock = new InstantClock();
    let requests = 0;
    // Heap after a full collection, at the start of each of the page's requests.
    const heap: number[] = [];
    // A fresh body per request, about 4 MB as a two-byte string, so nothing but the batch holds it.
    const body = () => `<html><body>${'→ w '.repeat(500_000)}${requests}</body></html>`;
    const fetcher = fakeFetcher(clock, (url) => {
      if (url.endsWith('/robots.txt')) return { status: 404, body: '' };
      requests++;
      gc();
      heap.push(process.memoryUsage().heapUsed);
      return { status: 200, body: body() };
    });
    const result = await runBatch(accessReq('https://example.com', ['/']), {
      clock,
      sites: new Sites(clock),
      fetcher,
      robotsCache: new RobotsCache(clock),
    });
    expect(result.coverage.urls_complete).toBe(1);
    expect(heap).toHaveLength(1 + CRAWLERS.length);
    // From the second request to the last, five more responses are read. Held whole, the heap grows
    // by one response each (19 MiB measured); held as kept starts, it does not grow.
    expect((heap.at(-1)! - heap[1]!) / 1048576).toBeLessThan(2);
  });
});

describe('round 5: stored URLs are bounded', () => {
  it('does not record a canonical over the URL cap, and says so', async () => {
    const s = await serve({
      page: (_p, _u, res) =>
        void (res.setHeader('content-type', 'text/html'),
        res.end(
          `<html><head><link rel="canonical" href="/c?${'é'.repeat(400)}"></head><body>x</body></html>`,
        )),
    });
    const { result } = await run(crawlReq(s.base, ['/']));
    if (result.kind !== 'crawl') throw new Error('crawl');
    // 400 é percent-encode to 2,400 characters, past the 2,048 cap.
    expect(result.pages[0]!.canonical_url).toBeNull();
    expect(result.pages[0]!.limitations).toContain(
      "The page's rel=canonical is over 2048 characters, so it was not recorded.",
    );
  });

  it('records a canonical within the cap', async () => {
    const s = await serve({
      page: (_p, _u, res) =>
        void (res.setHeader('content-type', 'text/html'),
        res.end('<html><head><link rel="canonical" href="/c"></head><body>x</body></html>')),
    });
    const { result } = await run(crawlReq(s.base, ['/']));
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(result.pages[0]!.canonical_url).toBe(`${s.base}/c`);
  });
});

describe('round 5: redirect targets', () => {
  const clock = () => new InstantClock();
  async function crawlWith(respond: Parameters<typeof fakeFetcher>[1], urls: string[]) {
    const c = clock();
    const fetcher = fakeFetcher(c, respond);
    const result = await runBatch(crawlReq('', urls), {
      clock: c,
      sites: new Sites(c),
      fetcher,
      robotsCache: new RobotsCache(c),
    });
    if (result.kind !== 'crawl') throw new Error('crawl');
    return { result, requested: fetcher.calls.map((x) => x.url) };
  }
  const LONG_TARGET = `https://example.com/${'p'.repeat(5000)}`;

  it('does not follow or record a redirect target over the URL cap', async () => {
    const { result, requested } = await crawlWith(
      (url) =>
        url.endsWith('/robots.txt')
          ? { status: 404, body: '' }
          : { status: 301, headers: { location: LONG_TARGET }, body: '' },
      ['https://example.com/a'],
    );
    expect(requested).toEqual(['https://example.com/robots.txt', 'https://example.com/a']);
    expect(result.pages[0]).toMatchObject({ status_code: 301, final_url: null });
    expect(result.pages[0]!.limitations[0]).toBe(
      'The page was not read: it redirects to a URL over 2048 characters, which was neither requested nor recorded.',
    );
  });

  it('does not follow a redirect to another port of the site', async () => {
    const { result, requested } = await crawlWith(
      (url) =>
        url.endsWith('/robots.txt')
          ? { status: 404, body: '' }
          : { status: 301, headers: { location: 'https://example.com:8443/x' }, body: '' },
      ['https://example.com/a'],
    );
    expect(requested).toEqual(['https://example.com/robots.txt', 'https://example.com/a']);
    expect(result.pages[0]!.limitations[0]).toBe(
      'The page was not read: it redirects to another port, which was not requested.',
    );
  });

  it('does not follow a robots.txt redirect to another port, and the site is unreachable', async () => {
    const { result, requested } = await crawlWith(
      (url) =>
        url === 'https://example.com/robots.txt'
          ? { status: 301, headers: { location: 'https://example.com:8443/robots.txt' }, body: '' }
          : { status: 200 },
      ['https://example.com/a'],
    );
    expect(requested).toEqual(['https://example.com/robots.txt']);
    expect(result.robots[0]).toMatchObject({ state: 'unreachable', why: 'redirect_status' });
    expect(result.pages[0]!.outcome).toBe('not_requested');
  });
});

describe('round 5: a robots.txt redirect the batch could not follow', () => {
  it('reads as not requested, not as robots.txt unreachable', async () => {
    const { result, requested } = await runFake(
      crawlReq('https://example.com', ['/a'], { ...roomy, max_requests: 1 }),
      (url) =>
        url === 'https://example.com/robots.txt'
          ? { status: 301, headers: { location: 'https://example.com/rules.txt' }, body: '' }
          : { status: 200 },
    );
    expect(requested).toEqual(['https://example.com/robots.txt']);
    expect(result.robots).toEqual([]);
    expect(result.partial?.reasons).toEqual(['budget_requests']);
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(result.pages[0]!.limitations[0]).toBe(
      "Not requested: the batch's requests budget was spent. The user agent shown is the one that would have been sent.",
    );
  });
});
