import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { runCrawl } from './crawler.js';
import { FRONTIER_BATCH_SIZE } from './constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a §6 — THE BATCH-BOUNDING BLOCKER (evidence/2026-08-03-stage3b-frontier-throughput-blocker.md).
//
// On the live A/B panel `info.cern.ch` went 123 → 24 pages while its score ROSE. The §6.7 fingerprint
// is what found it: `selected=161` against 24 pages actually fetched. `runDeterministicLevels` handed
// the entire remaining page budget to ONE `runWithWallClock` call, so a wall-clock stop discarded the
// whole batch — one instrumented round ran 51.9s and banked ZERO.
//
// WHY THE EXISTING FIXTURE COULD NOT CATCH IT. `crawl-frontier-budget.test.ts` answers every request
// instantly, so its batch always completes and the wall clock never fires part-way through one. The
// loop stayed perfectly deterministic while reaching a fifth as much of the site, so no test noticed.
// THAT IS THE GAP THIS FILE CLOSES: a host with a page that never answers, and a budget that expires
// MID-BATCH.
//
// THE SHAPE, and why it makes the measurement structural rather than statistical. Every child is a
// TOP-LEVEL path, so `templateKeyFor` keeps each one literal (§6.2 leaves depth-1 segments alone) and
// each child is its own stratum. Round-robin visits strata in key order, so the selection order is
// exactly `/p00, /p01, …` — decided by the URLs, not by a hash and not by a clock. One page in that
// order never responds. The budget is far below the 30s navigation timeout and far above the time the
// instant pages need, so the deadline lands in a wide dead zone: what gets banked is decided by
// ORDER, not by RATE, which is what makes the assertions below stable.
// ─────────────────────────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

/** Children of the homepage. Deliberately more than one batch, so the budget must cut mid-batch. */
const CHILDREN = 59;
/** The path that never answers. Position 5 of the selection order: inside the FIRST child batch. */
const TARPIT = '/p05';
const PAGE_CAP = CHILDREN + 1;
/** Comfortably above the instant pages, comfortably below NAVIGATION_TIMEOUT_SECS (30s). */
const BUDGET_MS = 5000;

const childPaths = Array.from({ length: CHILDREN }, (_, i) => `/p${String(i).padStart(2, '0')}`);

beforeAll(async () => {
  const html = (links: string[]) =>
    `<html><head><title>t</title></head><body>${links.map((h) => `<a href="${h}">${h}</a>`).join('')}` +
    `<p>Body text long enough that this page is a CONTENT page under the thin-content gate.</p></body></html>`;

  server = http.createServer((req, res) => {
    res.on('error', () => {}); // swallow ECONNRESET when the crawler is torn down
    const path = (req.url ?? '/').split('?')[0]!;
    if (path === '/robots.txt' || path === '/sitemap.xml') {
      res.statusCode = 404;
      res.end('');
      return;
    }
    // The tarpit: accept the connection and never answer. This is the info.cern.ch behaviour that the
    // instant-response fixture cannot reproduce — the request occupies its slot until the crawl's own
    // navigation timeout, which is five times the budget here, so the deadline fires first.
    if (path === TARPIT) return;
    res.setHeader('content-type', 'text/html');
    res.end(path === '/' || path === '' ? html(childPaths) : html(['/']));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  server.closeAllConnections(); // the tarpit is still holding one open
  await new Promise<void>((r) => server.close(() => r()));
});

const INPUT = () => ({
  startUrls: [baseUrl],
  pageCap: PAGE_CAP,
  // Serial, so the batch is consumed in selection order and the stranded set is decided by that order
  // rather than by how many slots happened to be in flight when the deadline fired.
  perHostConcurrency: 1,
  staggerMs: 0,
  pageTimeoutMs: 5000,
  allowPrivateIpsForTesting: true,
  deterministicFrontier: true,
  // §5 graceful partial. Without it a wall-clock stop REJECTS (v1 behaviour) and there is no partial
  // result to inspect — the whole question here is what survives the stop.
  politeCrawl: true,
  maxCrawlMs: BUDGET_MS,
});

const paths = (out: { pages: { url: string }[] }) => out.pages.map((p) => new URL(p.url).pathname).sort();

describe('SPEC 5.1a §6 — a wall clock that expires mid-batch may strand at most ONE batch', () => {
  it('does not consume URLs it never fetched beyond a single bounded batch', async () => {
    // THE ASSERTION THAT GOES RED ON THE 3b.1 WIRING. There, the one and only child batch is all 59
    // discovered URLs: every one is deleted from the pool, marked visited and charged against the page
    // cap BEFORE the fetch, so when the tarpit stalls the round the other ~53 are consumed without ever
    // being read. That is the `selected=161` vs 24 discrepancy, reproduced. Bounding the batch bounds
    // the loss to the round that was actually interrupted.
    const out = await runCrawl(INPUT());

    expect(out.budgetExhausted).toBe(true);
    const selected = out.fingerprint!.selectedCount;
    const banked = out.pages.length;

    // Guards, so the bound below cannot be satisfied by a crawl that collapsed instead of one that was
    // bounded: real progress was made, and the deadline really did strand something.
    expect(banked).toBeGreaterThan(1);
    expect(selected).toBeGreaterThan(banked);

    expect(selected - banked).toBeLessThanOrEqual(FRONTIER_BATCH_SIZE);
  }, 60000);

  it('selects the same set on every run — and banks the same set IN THIS DEAD-ZONED FIXTURE', async () => {
    // WHAT IS GUARANTEED, and what is not. The digest assertion is the real one: bounding the batch adds
    // ROUNDS, and a round boundary is the one place a clock could leak into which URLs are eligible. It
    // must not, and it does not — the batch size is a constant, so SELECTION stays a pure function of
    // the discovered set (§6.6).
    //
    // The banked-set assertion is WEAKER THAN IT LOOKS and is scoped deliberately. BANKING under budget
    // exhaustion is latency-dependent in general: measured on a fixed local corpus with fixed per-URL
    // latency, five runs produced 2-3 DIFFERENT banked sets — even serially, so the clock, not
    // concurrency, is the cause (evidence/2026-08-03-stage3b-stall-economics.md §4). It holds here only
    // because this fixture is engineered so that completion ORDER cannot matter: every non-stalling page
    // answers instantly and the stall costs 30s against a 5s budget, so the deadline never lands near a
    // page boundary. Do not read this test as a general banking-determinism guarantee, and do not copy
    // its shape to a fixture without that dead zone.
    const a = await runCrawl(INPUT());
    const b = await runCrawl(INPUT());

    expect(a.budgetExhausted).toBe(true);
    expect(a.pages.length).toBeGreaterThan(1);
    expect(a.fingerprint!.digest).toBe(b.fingerprint!.digest);
    expect(paths(a)).toEqual(paths(b));
  }, 90000);
});
