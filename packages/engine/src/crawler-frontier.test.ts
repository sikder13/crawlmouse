import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { runCrawl } from './crawler.js';
import { runAudit } from './audit.js';
import { canonicalizeUrl } from './url-canonical.js';

// SPEC 01 §3 / T4: the link-discovered crawl frontier expands in strict (depth ASC, canonicalUrl ASC)
// order, so when the page cap truncates a site LARGER than the cap, the SAME cap selects the SAME
// subset run-to-run (reproducibility under truncation). A naive sort-then-enqueue is NOT deterministic
// under concurrency — children are appended in completion order at depth >= 2. The fixture uses
// ASYMMETRIC per-page latency (the LATER-sorted depth-1 page /p4 responds FASTEST), so a non-barrier
// crawl would admit /p4's child before /p1's and vary run-to-run, while the level-barrier crawl always
// admits the alphabetically-first depth-2 child (/p1a). 17 pages (1 + 4 + 12), cap 6 forces truncation.
let server: http.Server;
let baseUrl: string;

// Later-sorted depth-1 pages respond faster — the timing trap a non-barrier crawl falls into.
const DELAY_MS: Record<string, number> = { '/p1': 120, '/p2': 80, '/p3': 40, '/p4': 10 };

beforeAll(async () => {
  const page = (links: string[], title: string) =>
    `<html><head><title>${title}</title></head><body>${links
      .map((h) => `<a href="${h}">go to ${h}</a>`)
      .join(' ')}</body></html>`;
  server = http.createServer((req, res) => {
    const path = req.url ?? '/';
    if (path === '/robots.txt' || path === '/sitemap.xml') { res.statusCode = 404; res.end(''); return; }
    const send = (html: string) => { res.setHeader('content-type', 'text/html'); res.end(html); };
    if (path === '/' || path === '') { send(page(['/p1', '/p2', '/p3', '/p4'], 'home')); return; }
    const hub = path.match(/^\/p([1-4])$/);
    if (hub) {
      const n = hub[1];
      const html = page([`/p${n}a`, `/p${n}b`, `/p${n}c`], `p${n}`);
      const delay = DELAY_MS[path] ?? 0;
      if (delay > 0) setTimeout(() => send(html), delay);
      else send(html);
      return;
    }
    if (/^\/p[1-4][a-c]$/.test(path)) { send(page(['/'], path.slice(1))); return; }
    res.statusCode = 404; res.end('not found');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

const sortedUrls = (pages: { url: string }[]): string[] => pages.map((p) => p.url).sort();
const u = (path: string): string => canonicalizeUrl(baseUrl + path);

describe('crawler deterministic (depth, url) frontier — SPEC 01 §3 / T4', () => {
  it('selects the SAME (depth, url)-ordered subset across two runs when the cap truncates a larger site', async () => {
    const input = {
      startUrls: [baseUrl], pageCap: 6, perHostConcurrency: 4, staggerMs: 0, pageTimeoutMs: 5000,
      allowPrivateIpsForTesting: true, deterministicFrontier: true,
    };
    const run1 = await runCrawl(input);
    const run2 = await runCrawl(input);

    // Determinism: identical subset across runs, and exactly the cap.
    expect(sortedUrls(run1.pages)).toEqual(sortedUrls(run2.pages));
    expect(run1.pages.length).toBe(6);

    // (depth, url) ordering: home + ALL four depth-1, then the alphabetically-first depth-2 child
    // (/p1a) — NOT the fastest-responding one (/p4a). This is the assertion a non-barrier crawl fails.
    const got = new Set(sortedUrls(run1.pages));
    for (const p of ['', '/p1', '/p2', '/p3', '/p4', '/p1a']) expect(got.has(u(p))).toBe(true);
    expect(got.has(u('/p4a'))).toBe(false);
  }, 30000);

  it('produces an identical grade + page set end-to-end across two runs (engine v2)', async () => {
    const opts = { url: baseUrl, pageCap: 6, perHostConcurrency: 4, staggerMs: 0, pageTimeoutMs: 5000 };
    const flags = { allowPrivateIpsForTesting: true, engineV2: true };
    const a = await runAudit(opts, flags);
    const b = await runAudit(opts, flags);
    expect(a.grade).toBe(b.grade);
    expect(a.score).toBe(b.score);
    expect(sortedUrls(a.pages)).toEqual(sortedUrls(b.pages));
  }, 30000);

  it('v1 guard: with deterministicFrontier OFF the legacy FIFO crawl is unchanged (cap respected, no error)', async () => {
    const run = await runCrawl({
      startUrls: [baseUrl], pageCap: 6, perHostConcurrency: 4, staggerMs: 0, pageTimeoutMs: 5000,
      allowPrivateIpsForTesting: true, // deterministicFrontier omitted -> legacy FIFO enqueueLinks path
    });
    expect(run.pages.length).toBeLessThanOrEqual(6); // FIFO + maxRequestsPerCrawl still bounds the crawl
    expect(run.pages.length).toBeGreaterThanOrEqual(2); // it traversed beyond the homepage via enqueueLinks
    expect(run.pages.some((p) => p.url === u(''))).toBe(true); // homepage present
  }, 30000);
});
