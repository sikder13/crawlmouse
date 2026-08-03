import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { crawlForAudit, analyzeCrawl } from '@crawlmouse/engine';
import { runEnginePair, type EngineApi } from './backtest-runner.js';

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a Stage 0.5 — proof that the re-axed harness can observe a CRAWL-HALF change.
//
// The pre-5.1 harness (backtest-engine.ts, the crawl-once-grade-twice design) crawled ONCE and graded
// that single output under v1 and v2. Its axis is therefore the GRADING half. SPEC 5.1a's Stage 1
// (robots on every entry path, canonicalisation, trap caps) and Stage 3 (stratified frontier) change
// WHICH PAGES ARE FETCHED — the crawl half — and a crawl-half change is applied identically to both
// sides of a one-crawl diff, so it cancels out exactly. The old harness would print Δ0.00 while every
// production grade moved. That is the same blindness SPEC 05 found with AI-readiness output.
//
// The difference driven below is a BUDGET-TRUNCATED SELECTION difference — two engine builds that
// fetch a different subset of the same site under the same cap. That is precisely the class Stage 3
// produces (a stratified frontier selects different pages than level-sorted BFS truncation), and it is
// deterministic on both sides, so the test cannot flake.
//
// Test 1 pins the OLD axis going blind to it. Test 2 pins the NEW axis catching it. Test 1 is what
// makes test 2 mean something: without it, "the new axis reports a difference" could just be noise.
//
// REJECTED FIRST ATTEMPT, recorded because it is a real engine fact worth carrying into Stage 1: the
// fixture originally drove the difference through campaign-tagged links (`?utm_source=`), on the
// assumption that only the v2 identity path strips them. It produced IDENTICAL compositions, because
// Crawlee's own request-queue dedup normalises common tracking params away at ENQUEUE time, before our
// canonicalisation is consulted. So part of the collapse SPEC 5.1 §4.3 predicts already happens one
// layer below us, and Stage 1's measured effect on page counts must be read with that in mind.
// ─────────────────────────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

// Seven pages: a homepage linking /a…/f, each leaf linking home. With the v2 deterministic frontier a
// cap truncates in strict (depth, canonical URL) order, so the fetched subset is a pure function of the
// cap — which is what lets two different caps stand in for two different selection strategies.
beforeAll(async () => {
  const html = (body: string) => `<html><head><title>t</title></head><body>${body}</body></html>`;
  const LEAVES = ['a', 'b', 'c', 'd', 'e', 'f'];
  server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    if (path === '/robots.txt' || path === '/sitemap.xml') { res.statusCode = 404; res.end(''); return; }
    res.setHeader('content-type', 'text/html');
    if (path === '/' || path === '') {
      res.end(html(LEAVES.map((l) => `<a href="/${l}">${l}</a>`).join(' ')));
      return;
    }
    if (LEAVES.includes(path.slice(1))) { res.end(html('<a href="/">home</a>')); return; }
    res.statusCode = 404; res.end('');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

const OPTS = { pageCap: 50, perHostConcurrency: 4, staggerMs: 0, pageTimeoutMs: 5000 };
const FLAGS = { allowPrivateIpsForTesting: true };

/**
 * A real engine build whose crawl half selects a different subset. Injected as an `EngineApi` rather
 * than exposed as a harness option, because per-side crawl options are NOT a production knob — in real
 * use both sides run identical options and differ only in which engine build produced them.
 */
const engineWithCap = (pageCap: number): EngineApi => ({
  crawlForAudit: (opts, flags, v2) => crawlForAudit({ ...opts, pageCap } as never, flags as never, v2),
  analyzeCrawl,
});

describe('Stage 0.5 — backtest axis', () => {
  it('THE DEFECT: the old crawl-once-grade-twice axis cannot see a crawl-half difference', async () => {
    // Reproduce the old harness exactly: ONE crawl, graded twice.
    const { crawlOut, ctx } = await crawlForAudit({ url: baseUrl, ...OPTS }, FLAGS, true);
    const v1 = analyzeCrawl(crawlOut, ctx, false);
    const v2 = analyzeCrawl(crawlOut, ctx, true);

    // Both gradings read the SAME pages array, so the fetched-URL set is identical BY CONSTRUCTION.
    // No crawl-half change can ever appear in this diff — which is the structural defect, not a
    // property of this fixture.
    const v1Urls = v1.pages.map((p) => p.url).sort();
    const v2Urls = v2.pages.map((p) => p.url).sort();
    expect(v1Urls).toEqual(v2Urls);
  }, 30000);

  it('THE FIX: the base-vs-head axis reports the digest difference and names the moved pages', async () => {
    const pair = await runEnginePair({
      url: baseUrl,
      baseEngine: engineWithCap(3), // fetches home + /a + /b
      headEngine: engineWithCap(5), // fetches home + /a…/d
      baseV2: true,
      headV2: true,
      opts: OPTS,
      flags: FLAGS,
    });

    expect(pair.excluded).toBeNull();
    expect(pair.composition).not.toBeNull();
    expect(pair.composition!.identical).toBe(false);
    expect(pair.composition!.baseDigest).not.toBe(pair.composition!.headDigest);

    // Assert the CONTENT of the set difference, not merely that it is non-empty — a diff reporting
    // "something moved" without saying what cannot attribute a grade change, which is the entire
    // purpose of the instrument. /c and /d are reached only by the wider budget.
    expect(pair.composition!.onlyInHead.map((u) => new URL(u).pathname).sort()).toEqual(['/c', '/d']);
    expect(pair.composition!.onlyInBase).toEqual([]);
    expect(pair.composition!.baseCount).toBe(3);
    expect(pair.composition!.headCount).toBe(5);
  }, 30000);

  it('reports identical composition when both sides run the same engine on the same config', async () => {
    // The repro mode (B6's shape): same engine twice, unchanged site ⇒ identical digest. This also
    // proves the previous test's difference came from the engine config and not from crawl jitter on
    // this fixture — without it, a flaky fixture would masquerade as observability.
    const pair = await runEnginePair({
      url: baseUrl,
      baseEngine: engineWithCap(4),
      headEngine: engineWithCap(4),
      baseV2: true,
      headV2: true,
      opts: OPTS,
      flags: FLAGS,
    });
    expect(pair.excluded).toBeNull();
    expect(pair.composition).not.toBeNull();
    expect(pair.composition!.identical).toBe(true);
    expect(pair.composition!.baseDigest).toBe(pair.composition!.headDigest);
    expect(pair.base.score).toBe(pair.head.score);
    expect(pair.base.grade).toBe(pair.head.grade);
  }, 30000);
});

describe('Stage 0.5 — runner robustness', () => {
  // Injected stub engines: these pin the runner's own control flow without a network, so a failure
  // here is unambiguously the harness and not the crawl.
  const stubCrawl = (urls: string[]) => ({
    crawlOut: { pages: urls.map((u) => ({ url: u, urlHash: u, statusCode: 200 })), links: [] },
    ctx: {} as never,
  });

  it('excludes a URL whose crawl throws, naming the reason, instead of aborting the run', async () => {
    const good: EngineApi = {
      crawlForAudit: async () => stubCrawl(['https://x.test/a']) as never,
      analyzeCrawl: () => ({ score: 80, grade: 'B+', pages: [{ url: 'https://x.test/a' }], findings: [] }) as never,
    };
    const broken: EngineApi = {
      crawlForAudit: async () => { throw new Error('homepage fetch failed'); },
      analyzeCrawl: () => ({ score: 0, grade: 'F', pages: [], findings: [] }) as never,
    };
    const pair = await runEnginePair({
      url: 'https://x.test/', baseEngine: good, headEngine: broken,
      baseV2: true, headV2: true, opts: OPTS, flags: FLAGS,
    });
    expect(pair.excluded).toContain('homepage fetch failed');
    // NULL, not "identical" and not a fabricated difference: a pair with one usable crawl has no
    // composition to report, and putting either claim in the evidence table would assert something no
    // measurement supports.
    expect(pair.composition).toBeNull();
  });

  it('excludes a crawl that returned zero gradeable pages rather than grading nothing', async () => {
    const empty: EngineApi = {
      crawlForAudit: async () => stubCrawl([]) as never,
      analyzeCrawl: () => ({ score: 0, grade: 'F', pages: [], findings: [] }) as never,
    };
    const pair = await runEnginePair({
      url: 'https://x.test/', baseEngine: empty, headEngine: empty,
      baseV2: true, headV2: true, opts: OPTS, flags: FLAGS,
    });
    expect(pair.excluded).toContain('0 ok pages');
  });

  it('counts only HTTP 200 pages as the composition, not blocked or dead fetches', async () => {
    // A 403 is a crawl OUTCOME, not a page of the site (engine §1 node-eligibility). Letting one into
    // the digest would make a transient block look like a composition change and produce a false
    // "the sample moved" verdict on every throttling host.
    const mixed = (): EngineApi => ({
      crawlForAudit: async () => ({
        crawlOut: {
          pages: [
            { url: 'https://x.test/a', urlHash: 'a', statusCode: 200 },
            { url: 'https://x.test/blocked', urlHash: 'b', statusCode: 403 },
          ],
          links: [],
        },
        ctx: {} as never,
      }) as never,
      analyzeCrawl: () => ({ score: 70, grade: 'B-', pages: [], findings: [] }) as never,
    });
    const pair = await runEnginePair({
      url: 'https://x.test/', baseEngine: mixed(), headEngine: mixed(),
      baseV2: true, headV2: true, opts: OPTS, flags: FLAGS,
    });
    expect(pair.excluded).toBeNull();
    expect(pair.composition!.baseCount).toBe(1);
    expect(pair.composition!.identical).toBe(true);
  });
});
