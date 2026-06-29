import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { runCrawl } from './crawler.js';
import { parseRobotsTxt } from './robots.js';

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    if (req.url === '/' || req.url === '') {
      res.end(`<html><head><title>Home</title></head><body><a href="/a">A</a><a href="/b">B</a></body></html>`);
    } else if (req.url === '/a') {
      res.end(`<html><head><title>A</title></head><body><a href="/">Home</a></body></html>`);
    } else if (req.url === '/b') {
      res.end(`<html><head><title>B</title></head><body></body></html>`);
    } else {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('runCrawl', () => {
  it('crawls a small site and returns pages + links', async () => {
    const result = await runCrawl({
      startUrls: [baseUrl],
      pageCap: 10,
      perHostConcurrency: 2,
      staggerMs: 50,
      pageTimeoutMs: 5000,
      allowPrivateIpsForTesting: true,
    });
    expect(result.pages.length).toBe(3);
    expect(result.links.length).toBeGreaterThan(0);
    const titles = result.pages.map((p) => p.title).sort();
    expect(titles).toEqual(['A', 'B', 'Home']);
  });

  // Production-path smoke test (no allowPrivateIpsForTesting bypass): exercises the
  // real validateUrlOrThrow + createSafeLookup `dnsLookup` pin + beforeRedirect hook
  // against got 14 via crawlee. The bypass tests above CANNOT catch a got option-name
  // incompatibility (e.g. lookup vs dnsLookup, or an unknown option throwing), which
  // would silently break every production crawl. Requires outbound network.
  it('crawls a real public site through the production SSRF-pinned path', async () => {
    const out = await runCrawl({
      startUrls: ['https://example.com/'],
      pageCap: 3,
      perHostConcurrency: 2,
      staggerMs: 0,
      pageTimeoutMs: 15000,
    });
    expect(out.pages.some((p) => p.statusCode === 200)).toBe(true);
  }, 30000);

  // A1b: when a canonicalScheme is supplied, every stored page identity AND every link
  // endpoint is pinned to that scheme, even though the crawler still fetches the real
  // (here http) URLs. This is what stops a scheme-downgrading site from splitting one
  // page into an http identity and an https identity (which would orphan real pages and
  // corrupt the in-degree graph).
  it('pins page + link identity to canonicalScheme without breaking the fetch', async () => {
    const result = await runCrawl({
      startUrls: [baseUrl], // real scheme is http
      pageCap: 10,
      perHostConcurrency: 2,
      staggerMs: 0,
      pageTimeoutMs: 5000,
      allowPrivateIpsForTesting: true,
      canonicalScheme: 'https:',
    });
    expect(result.pages.length).toBe(3); // fetch still works against the http server
    expect(result.pages.every((p) => p.url.startsWith('https://'))).toBe(true);
    expect(result.links.length).toBeGreaterThan(0);
    expect(result.links.every((l) => l.fromUrl.startsWith('https://') && l.toUrl.startsWith('https://'))).toBe(true);
    // The home->/a link target must resolve to a real crawled node (no scheme split):
    // every link whose target was crawled appears as a page url under the same scheme.
    const pageUrls = new Set(result.pages.map((p) => p.url));
    const linkToA = result.links.find((l) => l.toUrl.endsWith('/a'));
    expect(linkToA).toBeDefined();
    expect(pageUrls.has(linkToA!.toUrl)).toBe(true);
  });

  // A1 (HERMETIC): reproduces the same-origin-vs-same-hostname difference WITHOUT TLS by
  // 30x-redirecting a deep path to the SAME hostname on a DIFFERENT PORT. Crawlee's
  // 'same-origin' compares scheme+host+PORT and drops the redirected request (reason=redirect)
  // exactly as it drops an https->http downgrade; 'same-hostname' (the A1 fix) compares host
  // only and follows it. This gives the core A1 fix a deterministic, offline regression guard
  // (the local same-scheme fixtures above pass under BOTH strategies, so they don't).
  it('follows a redirect that changes origin to the same host (A1: same-hostname, not same-origin)', async () => {
    const deepServer = http.createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end('<html><head><title>Deep</title></head><body>deep page</body></html>');
    });
    await new Promise<void>((r) => deepServer.listen(0, '127.0.0.1', r));
    const deepPort = (deepServer.address() as { port: number }).port;
    const deepBase = `http://127.0.0.1:${deepPort}`;

    const homeServer = http.createServer((req, res) => {
      if (req.url === '/deep') {
        // Same hostname, different port -> a different "origin" but the same "hostname".
        res.statusCode = 302;
        res.setHeader('location', `${deepBase}/deep`);
        res.end('');
        return;
      }
      res.setHeader('content-type', 'text/html');
      res.end('<html><head><title>Home</title></head><body><a href="/deep">Deep</a></body></html>');
    });
    await new Promise<void>((r) => homeServer.listen(0, '127.0.0.1', r));
    const homeBase = `http://127.0.0.1:${(homeServer.address() as { port: number }).port}`;

    try {
      const out = await runCrawl({
        startUrls: [homeBase],
        pageCap: 10,
        perHostConcurrency: 2,
        staggerMs: 0,
        pageTimeoutMs: 5000,
        allowPrivateIpsForTesting: true,
      });
      // The deep page lives behind a cross-origin (different-port) redirect on the same host.
      // 'same-origin' would skip it; 'same-hostname' reaches it.
      expect(out.pages.some((p) => p.url.includes(`:${deepPort}/deep`))).toBe(true);
    } finally {
      await new Promise<void>((r) => deepServer.close(() => r()));
      await new Promise<void>((r) => homeServer.close(() => r()));
    }
  });

  // A1: a real site that 30x-redirects deep paths from https down to http. With the old
  // strategy:'same-origin', Crawlee re-checked the strategy AFTER navigation by
  // protocol+hostname, so https !== http skipped every downgraded link and the crawl
  // stalled at ~2 pages. strategy:'same-hostname' is scheme-agnostic. Requires network.
  it('crawls a scheme-downgrading site deep (A1: quotes.toscrape https->http)', async () => {
    const out = await runCrawl({
      startUrls: ['https://quotes.toscrape.com/'],
      pageCap: 30,
      perHostConcurrency: 4,
      staggerMs: 0,
      pageTimeoutMs: 15000,
    });
    expect(out.pages.length).toBeGreaterThan(5);
  }, 60000);

  it('does not enqueue links disallowed by robots.txt', async () => {
    const result = await runCrawl({
      startUrls: [baseUrl],
      pageCap: 10,
      perHostConcurrency: 2,
      staggerMs: 0,
      pageTimeoutMs: 5000,
      allowPrivateIpsForTesting: true,
      robots: parseRobotsTxt('User-agent: *\nDisallow: /a'),
    });
    const paths = result.pages.map((p) => new URL(p.url).pathname).sort();
    // /a is disallowed and only reachable via enqueue, so it must be skipped.
    expect(paths).toEqual(['/', '/b']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 (§5): adaptive AIMD concurrency. Runs at the runCrawl level where the controller
// lives, asserting the telemetry it surfaces on CrawlOutput.aimd. politeCrawl is the
// ENGINE_V2-gated switch (audit.ts passes `politeCrawl: v2`).
// ─────────────────────────────────────────────────────────────────────────────
describe('runCrawl — adaptive AIMD concurrency (§5, T7)', () => {
  it('ramps the concurrency cap toward the ceiling on a healthy host', async () => {
    const N = 40;
    const srv = http.createServer((req, res) => {
      const path = req.url ?? '/';
      res.setHeader('content-type', 'text/html');
      if (path === '/' || path === '') {
        const links = Array.from({ length: N }, (_, i) => `<a href="/p${i + 1}">p${i + 1}</a>`).join('');
        res.end(`<html><head><title>Home</title></head><body>${links}</body></html>`);
      } else if (/^\/p\d+$/.test(path)) {
        res.end(`<html><head><title>${path}</title></head><body><a href="/">home</a></body></html>`);
      } else {
        res.statusCode = 404;
        res.end('');
      }
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const b = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    try {
      const out = await runCrawl({
        startUrls: [b],
        pageCap: 100,
        perHostConcurrency: 8, // ceiling = min(5, 8) = 5
        staggerMs: 0,
        pageTimeoutMs: 5000,
        allowPrivateIpsForTesting: true,
        politeCrawl: true,
      });
      expect(out.aimd).toBeDefined();
      expect(out.aimd!.maxConcurrency).toBe(5); // ramped to the ceiling
      expect(out.aimd!.increases).toBeGreaterThan(0);
      // every page was reached (no throttling on a healthy host)
      expect(out.pages.filter((p) => p.statusCode === 200).length).toBeGreaterThanOrEqual(N);
    } finally {
      srv.closeAllConnections?.();
      await new Promise<void>((r) => srv.close(() => r()));
    }
  }, 30000);

  it('halves the cap on injected 429s and still recovers the throttled pages', async () => {
    const hits = new Map<string, number>();
    const srv = http.createServer((req, res) => {
      const path = req.url ?? '/';
      if (path === '/' || path === '') {
        res.setHeader('content-type', 'text/html');
        res.end('<html><head><title>Home</title></head><body><a href="/q1">1</a><a href="/q2">2</a><a href="/q3">3</a></body></html>');
        return;
      }
      if (/^\/q\d+$/.test(path)) {
        const n = (hits.get(path) ?? 0) + 1;
        hits.set(path, n);
        if (n === 1) { res.statusCode = 429; res.end('slow down'); return; } // throttle once, then recover
        res.setHeader('content-type', 'text/html');
        res.end(`<html><head><title>${path}</title></head><body><a href="/">home</a></body></html>`);
        return;
      }
      res.statusCode = 404;
      res.end('');
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const b = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    try {
      const out = await runCrawl({
        startUrls: [b],
        pageCap: 100,
        perHostConcurrency: 8,
        staggerMs: 0,
        pageTimeoutMs: 5000,
        allowPrivateIpsForTesting: true,
        politeCrawl: true,
      });
      expect(out.aimd).toBeDefined();
      expect(out.aimd!.halvings).toBeGreaterThan(0);
      expect(out.aimd!.minConcurrency).toBeLessThan(2); // start 2 → halved to 1
      // retries + backoff recover every throttled page as a 200 node (v1 would drop them as status 0).
      for (const q of ['/q1', '/q2', '/q3']) {
        expect(out.pages.some((p) => p.url.endsWith(q) && p.statusCode === 200)).toBe(true);
      }
    } finally {
      srv.closeAllConnections?.();
      await new Promise<void>((r) => srv.close(() => r()));
    }
  }, 30000);

  it('keeps a free-tier crawl (perHostConcurrency 1) fully sequential — cost control #5', async () => {
    const N = 12;
    const srv = http.createServer((req, res) => {
      const path = req.url ?? '/';
      res.setHeader('content-type', 'text/html');
      if (path === '/' || path === '') {
        const links = Array.from({ length: N }, (_, i) => `<a href="/p${i + 1}">p${i + 1}</a>`).join('');
        res.end(`<html><head><title>Home</title></head><body>${links}</body></html>`);
      } else if (/^\/p\d+$/.test(path)) {
        res.end(`<html><head><title>${path}</title></head><body><a href="/">home</a></body></html>`);
      } else {
        res.statusCode = 404;
        res.end('');
      }
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const b = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    try {
      const out = await runCrawl({
        startUrls: [b],
        pageCap: 100,
        perHostConcurrency: 1, // FREE_CONCURRENCY
        staggerMs: 0,
        pageTimeoutMs: 5000,
        allowPrivateIpsForTesting: true,
        politeCrawl: true,
      });
      // The AIMD ceiling clamps to the tier's perHostConcurrency, so free crawls never ramp above 1
      // (a flat ceiling of 5 would break cost control #5 by parallelising free crawls).
      expect(out.aimd).toBeDefined();
      expect(out.aimd!.maxConcurrency).toBe(1);
      expect(out.aimd!.increases).toBe(0);
      expect(out.pages.filter((p) => p.statusCode === 200).length).toBeGreaterThanOrEqual(N);
    } finally {
      srv.closeAllConnections?.();
      await new Promise<void>((r) => srv.close(() => r()));
    }
  }, 30000);
});

// NOTE: Part 2 (the cross-host-REDIRECT guard in the request handler) is validated by the live
// travellerbd re-run + correct-by-construction (it reuses the tested sameHostIgnoringWww predicate) +
// the grade-level node-eligibility defense (analyze-crawl.test.ts). A synthetic loopback cross-IP
// redirect (127.0.0.1 → 127.0.0.2) is NOT followed by Crawlee/got in test mode (verified by probe),
// so it can't be exercised here; real DNS-host redirects ARE followed (the api.whatsapp.com case).
// Part 1 coverage: the non-content link skip (?share= action links + media/binary files). All
// non-content paths below serve a NORMAL 200 page, so the ONLY reason they're absent in v2 is the skip.
describe('runCrawl — SPEC 02 non-content link skipping (v2 excludeCrossHost)', () => {
  let srv: http.Server;
  let base: string;
  beforeAll(async () => {
    srv = http.createServer((req, res) => {
      res.setHeader('content-type', 'text/html');
      const u = req.url ?? '/';
      if (u === '/' || u === '') {
        res.end(`<html><head><title>Home</title></head><body><a href="/stay">stay</a><a href="/post?share=facebook">share</a><a href="/photo.jpg">img</a><a href="/wp-content/uploads/2020/pic.png">wpimg</a></body></html>`);
      } else if (u === '/stay') {
        res.end('<html><head><title>Stay</title></head><body>same-host page</body></html>');
      } else {
        // EVERY other path (the ?share= link, /photo.jpg, /wp-content/uploads/…) serves a real 200
        // page, so it WOULD be crawled if not skipped — isolating the non-content skip.
        res.end('<html><head><title>Other</title></head><body>a normal page</body></html>');
      }
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  });
  afterAll(async () => { await new Promise<void>((r) => srv.close(() => r())); });

  it('v2: does NOT enqueue/fetch same-host ?share= action links or media/binary file links', async () => {
    const out = await runCrawl({
      startUrls: [base], pageCap: 20, perHostConcurrency: 2, staggerMs: 0, pageTimeoutMs: 5000,
      allowPrivateIpsForTesting: true, canonicalScheme: 'http:', deterministicFrontier: true, politeCrawl: true,
      excludeCrossHost: true,
    });
    expect(out.pages.some((p) => p.url.includes('/post'))).toBe(false); // ?share= action link skipped
    expect(out.pages.some((p) => p.url.includes('/photo.jpg'))).toBe(false); // media file skipped
    expect(out.pages.some((p) => p.url.includes('/wp-content/uploads/'))).toBe(false); // WP upload skipped
    expect(out.pages.some((p) => p.url.endsWith('/stay'))).toBe(true); // real content page still crawled
  });

  it('v1 (no excludeCrossHost): still crawls the share + media links — prod unchanged', async () => {
    const out = await runCrawl({
      startUrls: [base], pageCap: 20, perHostConcurrency: 2, staggerMs: 0, pageTimeoutMs: 5000,
      allowPrivateIpsForTesting: true,
    });
    expect(out.pages.some((p) => p.url.includes('/post'))).toBe(true);
    expect(out.pages.some((p) => p.url.includes('/photo.jpg'))).toBe(true);
  });
});
