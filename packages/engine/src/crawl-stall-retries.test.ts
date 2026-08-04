import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { runCrawl } from './crawler.js';

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a §6 — STALL ECONOMICS (evidence/2026-08-03-stage3b-batch-bounding.md §5).
//
// A 25-URL round on info.cern.ch ran 113.7s and banked ZERO pages. Not one URL reached a terminal
// outcome in that time — not a success, and not even a recorded failure. The arithmetic explains it:
// `NAVIGATION_TIMEOUT_SECS` is 30 and `MAX_REQUEST_RETRIES` is 4, so ONE stalled URL needs up to
// 30 x 5 = 150s to be declared dead. That is more than the whole crawl budget (240s in prod, 120s on
// the panel), so a handful of dead paths can consume a crawl and return nothing.
//
// A navigation timeout is not a transient throttle. 429 and 503 are, and the adaptive backoff already
// handles those. Four retries spend 150s to relearn what the first 30s established.
//
// The mechanism already exists: Stage 1 built `request.noRetry` from the errorHandler for robots
// refusals, precisely because "do not repeat a decision that cannot change" needed a layer that
// survives got replacing the error's class.
//
// THE FIXTURE. Stalling paths sort BEFORE the fast ones (`/a-stall-*` vs `/z-fast-*`), so the §6.2
// literal top-level strata put them first in the selection order and the retry budget is spent before
// the fast pages are reached. That is the info.cern.ch shape: the crawl meets the slow corner first.
// The navigation timeout is overridden to 1s so the same proof costs seconds instead of minutes.
// ─────────────────────────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;
let requested: string[] = [];

const STALLS = 8;
const FASTS = 4;
const stallPaths = Array.from({ length: STALLS }, (_, i) => `/a-stall-${i}`);
const fastPaths = Array.from({ length: FASTS }, (_, i) => `/z-fast-${i}`);

/** Long enough that a fixed crawl finishes with room; far short of the retried cost. */
const BUDGET_MS = 9000;
const NAV_TIMEOUT_SECS = 1;

beforeAll(async () => {
  const html = (links: string[]) =>
    `<html><head><title>t</title></head><body>${links.map((h) => `<a href="${h}">${h}</a>`).join('')}` +
    `<p>Body text long enough that this page is a CONTENT page under the thin-content gate.</p></body></html>`;

  server = http.createServer((req, res) => {
    res.on('error', () => {});
    const path = (req.url ?? '/').split('?')[0]!;
    requested.push(path);
    if (path === '/robots.txt' || path === '/sitemap.xml') { res.statusCode = 404; res.end(''); return; }
    // The stall: accept the connection, never answer. Every retry is a fresh request and shows up in
    // `requested`, which is what makes the retry count observable rather than inferred.
    if (stallPaths.includes(path)) return;
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

beforeEach(() => { requested = []; });

const INPUT = () => ({
  startUrls: [baseUrl],
  pageCap: 20,
  perHostConcurrency: 2,
  staggerMs: 0,
  pageTimeoutMs: 5000,
  allowPrivateIpsForTesting: true,
  deterministicFrontier: true,
  politeCrawl: true,
  maxCrawlMs: BUDGET_MS,
  navigationTimeoutSecsForTesting: NAV_TIMEOUT_SECS,
});

const pathsOf = (out: { pages: { url: string }[] }) => out.pages.map((p) => new URL(p.url).pathname);

describe('SPEC 5.1a §6 — a navigation timeout is a verdict, not a throttle', () => {
  it('spends ONE request on a stalled URL, not the whole retry budget', async () => {
    // THE MECHANISM. Crawlee retries four times by default under politeCrawl, so an unreachable path
    // costs five identical 30s waits in production to establish what the first one established.
    //
    // THE BUDGET HERE IS DELIBERATELY GENEROUS, and the first draft of this test proved why: under the
    // 9s budget the other two tests use, this assertion PASSED ON THE RETRYING WIRING — not because
    // retries were suppressed but because the deadline fired before any retry was attempted. A count of
    // one meant "we ran out of time", not "we declined to repeat ourselves". The budget must be large
    // enough for the retries to happen, or the test measures the clock instead of the policy.
    await runCrawl({ ...INPUT(), maxCrawlMs: 60_000 });

    for (const p of stallPaths) {
      expect(requested.filter((r) => r === p), `attempts for ${p}`).toHaveLength(1);
    }
  }, 120000);

  it('still RECORDS a timed-out URL as a failed fetch', async () => {
    // Not retrying must not become not reporting. A dead path is evidence about the host: it feeds the
    // block/dead counts that Stage 4's coverage accounting is built on, and dropping it silently would
    // trade one honesty defect for another — a crawl that looks cleaner than the site is.
    const out = await runCrawl(INPUT());

    const recorded = out.pages.filter((p) => stallPaths.includes(new URL(p.url).pathname));
    expect(recorded).toHaveLength(STALLS);
    for (const p of recorded) expect(p.statusCode).toBe(0);
  }, 60000);

  it('reaches the pages BEHIND the stalled ones, inside the budget', async () => {
    // THE OUTCOME, and the reason this outranks the retry count. The stalled paths sort first, so on
    // the retrying wiring they consume the budget and everything after them is never fetched — the
    // crawl reports a partial result whose missing half was decided by four avoidable repeats.
    const out = await runCrawl(INPUT());
    const got = pathsOf(out);

    expect(out.budgetExhausted).toBe(false);
    for (const p of fastPaths) expect(got).toContain(p);
  }, 60000);
});
