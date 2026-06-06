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
