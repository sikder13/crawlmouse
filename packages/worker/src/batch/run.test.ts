import type http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createFetcher } from '../fetch/fetcher.js';
import { CRAWL, CRAWLERS } from '../identities.js';
import { Sites } from '../politeness/sites.js';
import { InstantClock } from '../test-support/clock.js';
import { whoSent } from '../test-support/discriminators.js';
import { startServer, type FixtureServer } from '../test-support/http.js';
import type { BatchRequest } from './request.js';
import { runBatch, type BatchResult } from './run.js';
import { RobotsCache } from './site-rules.js';

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

  it('exactly 30 s is honoured', async () => {
    const s = await serve({ robots: robotsText('User-agent: *\nCrawl-delay: 30') });
    await run(crawlReq(s.base, ['/']));
    expect(pagesRequested(s)).toHaveLength(1);
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

  it('a page reached through a very long URL records no links, and says why', async () => {
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
    expect(result.link_edges).toEqual([]);
    expect(result.pages[0]!.limitations.join(' ')).toContain('so its links were not recorded');
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
  });
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
      '3 more same-site links were found on this page and not recorded; 1000 are kept per page.',
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
