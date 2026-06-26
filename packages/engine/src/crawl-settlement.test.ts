import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { Socket } from 'node:net';
import { runCrawl } from './crawler.js';

// SPEC 01 §5 — SETTLEMENT CONTRACT (regression guard for the wall-clock non-settle defect).
//
// The v2 polite + deterministic-frontier crawl re-invokes crawler.run() per BFS level. When the
// caller supplies no usable wall-clock budget, runDeterministicLevels took runWithWallClock's
// no-deadline branch (no timer) on every level, so a single stalled upstream socket (an origin that
// accepts the connection but never responds — the throttling-WordPress / hung-origin class, the §0
// site) left the per-level crawler.run() pending forever and the whole crawl promise never settled
// (Node exit 13 offline / a hung serverless function past maxDuration). The contract these tests pin:
// a v2 crawl ALWAYS settles within a bounded time, with or without a caller budget.
//
// Fixture: home -> 4 depth-1 hubs -> each hub links a once-429 child (/pNa, throttle then recover,
// exercising the per-level errorHandler backoff) and a STALLING child (/pNb, never responds), so the
// depth-2 level can never complete on its own — settlement must come from the wall-clock, not the host.
let server: http.Server;
let baseUrl: string;
const hits = new Map<string, number>();
const stalledSockets: Socket[] = [];

beforeAll(async () => {
  const page = (links: string[], title: string) =>
    `<html><head><title>${title}</title></head><body>${links.map((h) => `<a href="${h}">${h}</a>`).join('')}</body></html>`;
  server = http.createServer((req, res) => {
    const path = req.url ?? '/';
    if (path === '/robots.txt' || path === '/sitemap.xml') { res.statusCode = 404; res.end(''); return; }
    const html = (s: string) => { res.setHeader('content-type', 'text/html'); res.end(s); };
    if (path === '/' || path === '') { html(page(['/p1', '/p2', '/p3', '/p4'], 'home')); return; }
    const hub = path.match(/^\/p([1-4])$/);
    if (hub) { const n = hub[1]; setTimeout(() => html(page([`/p${n}a`, `/p${n}b`], `p${n}`)), 40); return; }
    if (/^\/p[1-4]a$/.test(path)) {
      // throttle once (429) then recover to 200 — drives the §5 errorHandler backoff inside a level.
      const n = (hits.get(path) ?? 0) + 1; hits.set(path, n);
      if (n === 1) { res.statusCode = 429; res.end('slow'); return; }
      html(page(['/'], path.slice(1))); return;
    }
    if (/^\/p[1-4]b$/.test(path)) { if (res.socket) stalledSockets.push(res.socket); return; } // STALL: never respond
    res.statusCode = 404; res.end('nf');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  for (const s of stalledSockets) { try { s.destroy(); } catch { /* noop */ } }
  server.closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));
});

const SETTLE_BOUND_MS = 10_000; // generous vs the ~1.5s expected; a non-settling crawl blows past it
const HUNG = Symbol('HUNG');

/** Resolve to the crawl output, or to HUNG if it fails to settle within the bound (instead of hanging the test). */
async function settleOrHang(crawl: Promise<Awaited<ReturnType<typeof runCrawl>>>) {
  crawl.catch(() => {}); // a late teardown rejection must not surface as unhandled
  let timer: ReturnType<typeof setTimeout> | undefined;
  const out = await Promise.race([
    crawl.then((o) => ({ settled: true as const, o })),
    new Promise<typeof HUNG>((res) => { timer = setTimeout(() => res(HUNG), SETTLE_BOUND_MS); }),
  ]);
  if (timer) clearTimeout(timer);
  return out;
}

describe('crawl settlement contract (SPEC 01 §5) — v2 polite + deterministicFrontier', () => {
  beforeAll(() => hits.clear());

  // (A) FINITE budget: the budget expires mid-level while a 429 backoff is in flight and a child is
  // stalled. Must stop GRACEFULLY at the budget (partial), never hang. (Passes pre-fix: a finite
  // budget already arms the per-level timer; pins the contract so it can't regress.)
  it('settles gracefully when a finite budget expires mid-level (stall + 429 child)', async () => {
    const t0 = Date.now();
    const r = await settleOrHang(runCrawl({
      startUrls: [baseUrl], pageCap: 500, perHostConcurrency: 8, staggerMs: 0, pageTimeoutMs: 5000,
      allowPrivateIpsForTesting: true, politeCrawl: true, deterministicFrontier: true,
      maxCrawlMs: 1500,
    }));
    expect(r).not.toBe(HUNG);
    if (r === HUNG) return;
    expect(r.o.budgetExhausted).toBe(true); // the stall prevents natural completion -> wall-clock cut it
    expect(r.o.pages.filter((p) => p.statusCode === 200).length).toBeGreaterThanOrEqual(5); // home + 4 hubs
    expect(Date.now() - t0).toBeLessThan(SETTLE_BOUND_MS);
  }, 20_000);

  // (B) NO budget (Infinity path): the exact case that hung. With no usable maxCrawlMs the v2 path must
  // STILL settle — the engine clamps the missing budget up to a positive floor so the per-level timer
  // always arms. The test seam picks a small floor so this runs in ~1s. FAILS (hangs) before the fix.
  it('settles when given NO budget — the missing budget is clamped to a positive floor', async () => {
    const t0 = Date.now();
    const r = await settleOrHang(runCrawl({
      startUrls: [baseUrl], pageCap: 500, perHostConcurrency: 8, staggerMs: 0, pageTimeoutMs: 5000,
      allowPrivateIpsForTesting: true, politeCrawl: true, deterministicFrontier: true,
      // maxCrawlMs intentionally omitted (Infinity path); the v2 clamp + this test floor bound it.
      crawlMsFloorForTesting: 1500,
    }));
    expect(r).not.toBe(HUNG);
    if (r === HUNG) return;
    expect(r.o.budgetExhausted).toBe(true); // clamped floor expired (stall) -> graceful partial
    expect(r.o.pages.filter((p) => p.statusCode === 200).length).toBeGreaterThanOrEqual(5);
    expect(Date.now() - t0).toBeLessThan(SETTLE_BOUND_MS);
  }, 20_000);
});
