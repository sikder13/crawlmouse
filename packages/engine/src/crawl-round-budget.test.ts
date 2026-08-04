import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { runCrawl } from './crawler.js';
import { FRONTIER_BATCH_SIZE } from './constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a §6 — THE ROUND CLOCK (evidence/2026-08-03-stage3b-stall-economics.md §5).
//
// Bounding the BATCH bounds how many URLs a round may consume. It cannot bound how much TIME a round
// may spend, because the cost of a stalled URL is per URL: a measured round of 25 dead paths on
// info.cern.ch ran 112.1s of a 120s budget and returned four pages, all dead. One unlucky draw ended
// the crawl while 111 URLs sat unfetched in the pool.
//
// A round expiry must therefore move the loop ON, not end the crawl. The crawl still ends only on the
// GLOBAL wall clock.
//
// THE FIXTURE. Exactly one batch worth of stalling paths, named so they sort FIRST (`/a-stall-NN` vs
// `/z-fast-N`), so §6.2's literal top-level strata put the entire stalled set in the first child round
// and the fast pages in the round after it. On the previous wiring that first round is handed the whole
// remaining budget, burns it, and the fast pages are never fetched — the site's other sections are lost
// to one slow corner. That is the info.cern.ch shape reduced to a fixture.
// ─────────────────────────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

const STALLS = FRONTIER_BATCH_SIZE; // exactly one batch, so the fast pages land in the NEXT round
const FASTS = 5;
const stallPaths = Array.from({ length: STALLS }, (_, i) => `/a-stall-${String(i).padStart(2, '0')}`);
const fastPaths = Array.from({ length: FASTS }, (_, i) => `/z-fast-${i}`);

/** Longer than the round budget below, so a stall cannot resolve inside its own round. */
const NAV_TIMEOUT_SECS = 5;
const ROUND_BUDGET_MS = 2000;
/** Comfortably more than one round, so the crawl is cut by ROUNDS rather than by the global clock. */
const GLOBAL_BUDGET_MS = 12000;

beforeAll(async () => {
  const html = (links: string[]) =>
    `<html><head><title>t</title></head><body>${links.map((h) => `<a href="${h}">${h}</a>`).join('')}` +
    `<p>Body text long enough that this page is a CONTENT page under the thin-content gate.</p></body></html>`;

  server = http.createServer((req, res) => {
    res.on('error', () => {});
    const path = (req.url ?? '/').split('?')[0]!;
    if (path === '/robots.txt' || path === '/sitemap.xml') { res.statusCode = 404; res.end(''); return; }
    if (stallPaths.includes(path)) return; // accept the connection, never answer
    res.setHeader('content-type', 'text/html');
    res.end(path === '/' || path === '' ? html([...stallPaths, ...fastPaths]) : html(['/']));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

const INPUT = () => ({
  startUrls: [baseUrl],
  pageCap: 200,
  perHostConcurrency: 2,
  staggerMs: 0,
  pageTimeoutMs: 5000,
  allowPrivateIpsForTesting: true,
  deterministicFrontier: true,
  politeCrawl: true,
  maxCrawlMs: GLOBAL_BUDGET_MS,
  navigationTimeoutSecsForTesting: NAV_TIMEOUT_SECS,
  frontierRoundBudgetMsForTesting: ROUND_BUDGET_MS,
});

const pathsOf = (out: { pages: { url: string }[] }) => out.pages.map((p) => new URL(p.url).pathname);

describe('SPEC 5.1a §6 — a stalled round ends the ROUND, not the crawl', () => {
  it('moves on to the next round and reaches the sections behind the stalled one', async () => {
    // THE ASSERTION THAT GOES RED ON THE PREVIOUS WIRING. There the first child round is handed the
    // entire remaining budget, so 25 unanswerable paths consume all 12s and `/z-fast-*` — a whole
    // section of the site, sitting in the very next round — is never requested at all.
    const out = await runCrawl(INPUT());
    const got = pathsOf(out);

    for (const p of fastPaths) expect(got, `fast page ${p}`).toContain(p);
  }, 60000);

  it('still reports the crawl as truncated, because a stranded round IS lost coverage', async () => {
    // Continuing past a stalled round must not make the result look complete. The round's URLs were
    // consumed from the pool and never read, so the crawl is partial in exactly the sense
    // `budgetExhausted` exists to signal — and Stage 4's confidence accounting reads it.
    const out = await runCrawl(INPUT());

    expect(out.budgetExhausted).toBe(true);
  }, 60000);

  it('re-runs the same crawler after a round teardown, and keeps the strand bounded by one batch', async () => {
    // Two things at once, because they share the same evidence. A round expiry TEARS THE CRAWLER DOWN,
    // and the loop then calls `run()` on it again — if that did not work the fast pages above could
    // never arrive, so their presence is the proof. And the §6.7 gap must still hold: one interrupted
    // round strands at most one batch, which is the invariant `crawl-frontier-batch-bounding` pins for
    // the global clock and which the round clock must not quietly widen.
    const out = await runCrawl(INPUT());

    const selected = out.fingerprint!.selectedCount;
    const banked = out.pages.length;
    expect(banked).toBeGreaterThan(FASTS); // the homepage plus every fast page: the re-run worked
    expect(selected - banked).toBeLessThanOrEqual(FRONTIER_BATCH_SIZE);
  }, 60000);
});
