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
