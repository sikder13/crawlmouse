import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { crawlForAudit, analyzeCrawl } from '@crawlmouse/engine';
import {
  runEnginePair,
  summarisePairs,
  formatPanelSummary,
  formatVerdict,
  type EngineApi,
  type PairResult,
  type CompletedPair,
} from './backtest-runner.js';

/**
 * Narrow a pair to the completed arm, failing loudly (with the reason) if it was excluded. Tests read
 * far better than a chain of non-null assertions, and an unexpected exclusion names itself instead of
 * surfacing as "cannot read property of null".
 */
function paired(p: PairResult): CompletedPair {
  if (p.excluded !== null) throw new Error(`expected a completed pair, got EXCLUDED: ${p.excluded}`);
  return p;
}

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
    const raw = await runEnginePair({
      url: baseUrl,
      baseEngine: engineWithCap(3), // fetches home + /a + /b
      headEngine: engineWithCap(5), // fetches home + /a…/d
      baseV2: true,
      headV2: true,
      opts: OPTS,
      flags: FLAGS,
    });
    const pair = paired(raw);

    // MEASURED, not assumed: this fixture's pages are template-identical near-duplicates, so the M9
    // classifier collapses the gradeable population below MIN_GRADEABLE_PAGES at EVERY cap (3→7) and
    // both sides refuse. That is a property of minimal fixture HTML, not of the gate.
    //
    // It makes this test STRONGER than before, and it is why the old `throw` had to go: composition is
    // still reported in full even though neither side asserted a letter. Under the throw both sides
    // became one EXCLUDED row and the entire crawl-half instrument went dark for exactly the audits
    // Stage 4 cares most about.
    expect(pair.base.outcome).toBe('refused');
    expect(pair.head.outcome).toBe('refused');
    expect(pair.grade.transition).toBe('refused→refused');

    expect(pair.composition.identical).toBe(false);
    expect(pair.composition.baseDigest).not.toBe(pair.composition.headDigest);

    // Assert the CONTENT of the set difference, not merely that it is non-empty — a diff reporting
    // "something moved" without saying what cannot attribute a grade change, which is the entire
    // purpose of the instrument. /c and /d are reached only by the wider budget.
    expect(pair.composition.onlyInHead.map((u) => new URL(u).pathname).sort()).toEqual(['/c', '/d']);
    expect(pair.composition.onlyInBase).toEqual([]);
    expect(pair.composition.baseCount).toBe(3);
    expect(pair.composition.headCount).toBe(5);
  }, 30000);

  it('reports an identical VERDICT when both sides run the same engine on the same config', async () => {
    // The repro mode (B6's shape): same engine twice, unchanged site ⇒ identical digest and identical
    // verdict.
    //
    // The verdict half used to be asserted as `base.score === head.score`. Once this fixture began
    // refusing that comparison became `null === null` — vacuously true, and therefore no longer capable
    // of failing. Fixed the ASSERTION to the general form rather than the fixture: "the same engine
    // twice yields the same verdict" holds whether the verdict is a letter or a refusal, and comparing
    // outcome + triggers is live again (a runner that dropped or reordered triggers fails here).
    const pair = paired(
      await runEnginePair({
        url: baseUrl,
        baseEngine: engineWithCap(4),
        headEngine: engineWithCap(4),
        baseV2: true,
        headV2: true,
        opts: OPTS,
        flags: FLAGS,
      }),
    );
    expect(pair.composition.identical).toBe(true);
    expect(pair.composition.baseDigest).toBe(pair.composition.headDigest);

    expect(pair.base.outcome).toBe(pair.head.outcome);
    expect(pair.base.score).toBe(pair.head.score);
    expect(pair.base.grade).toBe(pair.head.grade);
    // The live half: same engine ⇒ byte-identical trigger list, in the same order.
    expect(pair.base.outcome === 'refused' ? pair.base.triggers : null)
      .toEqual(pair.head.outcome === 'refused' ? pair.head.triggers : null);
    expect(pair.grade.transition).toBe('refused→refused');
    expect(pair.grade.gradeChanged).toBe(false);
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
    const pair = paired(await runEnginePair({
      url: 'https://x.test/', baseEngine: mixed(), headEngine: mixed(),
      baseV2: true, headV2: true, opts: OPTS, flags: FLAGS,
    }));
    expect(pair.composition.baseCount).toBe(1);
    expect(pair.composition.identical).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a Stage 4 — REFUSAL IS A PANEL OUTCOME, NOT A HARNESS ERROR (option (a)).
//
// The runner used to `throw` when the engine declined to assert a letter, so `runEnginePair`'s catch
// turned it into an EXCLUDED row with a `score: 0` sentinel. Both halves of that were wrong:
//
//   1. It filed the engine's most informative verdict as a failure of the INSTRUMENT. 10 of the 51
//      refused audits in the live corpus currently show A / A− / B+ / B, and `base B+ → head REFUSED`
//      is the single row the owner signs off in 5.1b.
//   2. `score: 0` renders as F. "We declined to assert" must never read as "we judged you badly."
//
// These pin the replacement. Stub engines, because transition classification and summary accounting
// are the RUNNER's control flow — a failure here must be unambiguously the harness and not a crawl.
// ─────────────────────────────────────────────────────────────────────────────

describe('Stage 4 — refusal as a first-class panel outcome', () => {
  const stubCrawl = (urls: string[]) => ({
    crawlOut: { pages: urls.map((u) => ({ url: u, urlHash: u, statusCode: 200 })), links: [] },
    ctx: {} as never,
  });

  /** An engine build that GRADES. */
  const grades = (score: number, grade: string, urls = ['https://x.test/a'], findings: { category: string }[] = []): EngineApi => ({
    crawlForAudit: async () => stubCrawl(urls) as never,
    analyzeCrawl: () => ({ score, grade, pages: [], findings, refusal: { refused: false, triggers: [], confidenceCapped: false, unevaluable: [] } }) as never,
  });

  /** An engine build that REFUSES — score and grade both null, carrying the trigger list. */
  const refuses = (triggers: string[], urls = ['https://x.test/a'], findings: { category: string }[] = []): EngineApi => ({
    crawlForAudit: async () => stubCrawl(urls) as never,
    analyzeCrawl: () => ({ score: null, grade: null, pages: [], findings, refusal: { refused: true, triggers, confidenceCapped: false, unevaluable: [] } }) as never,
  });

  const run = (baseEngine: EngineApi, headEngine: EngineApi, url = 'https://x.test/') =>
    runEnginePair({ url, baseEngine, headEngine, baseV2: true, headV2: true, opts: OPTS, flags: FLAGS });

  it('MUTATION TARGET 1: a refused side keeps a NULL score and is never coerced to a number', async () => {
    // Kills `score: result.score ?? 0` in runSide and `score: 0` in any sentinel. A refused side that
    // reports 0 would render as F — the exact misreading Stage 4 exists to make impossible.
    const pair = paired(await run(grades(81.39, 'B+'), refuses(['no_observed_links'])));

    expect(pair.head.outcome).toBe('refused');
    expect(pair.head.score).toBeNull();
    expect(pair.head.grade).toBeNull();
    expect(pair.head.score).not.toBe(0);
    expect(pair.head.grade).not.toBe('F');
  });

  it('carries the trigger list on the refused side, so the row can say WHY', async () => {
    const pair = paired(await run(grades(81.39, 'B+'), refuses(['too_few_gradeable_pages', 'no_observed_links'])));
    expect(pair.head.outcome === 'refused' ? pair.head.triggers : []).toEqual([
      'too_few_gradeable_pages',
      'no_observed_links',
    ]);
  });

  it('THE HEADLINE CASE: graded→refused is a reported row, NOT an excluded one', async () => {
    // The whole defect in one assertion. Under the old throw this pair came back
    // `excluded: 'refused: no verdict asserted'` and vanished from every delta in the panel.
    const pair = paired(await run(grades(81.39, 'B+'), refuses(['no_observed_links'])));
    expect(pair.grade.transition).toBe('graded→refused');
    expect(pair.grade.scoreDelta).toBeNull();
    expect(pair.base.outcome).toBe('graded');
    expect(pair.base.grade).toBe('B+');
  });

  it('handles all four transitions distinctly', async () => {
    expect(paired(await run(grades(80, 'B'), grades(85, 'B+'))).grade.transition).toBe('graded→graded');
    expect(paired(await run(grades(80, 'B'), refuses(['nothing_read']))).grade.transition).toBe('graded→refused');
    expect(paired(await run(refuses(['nothing_read']), grades(80, 'B'))).grade.transition).toBe('refused→graded');
    expect(paired(await run(refuses(['nothing_read']), refuses(['nothing_read']))).grade.transition).toBe('refused→refused');
  });

  it('still reports crawl composition across a refusal — a sample is evidence without a verdict', async () => {
    // A refused audit still fetched pages, and WHICH pages it fetched is exactly what attributes the
    // refusal. Dropping composition on a refused row would blind the crawl-half instrument on the
    // audits it matters most for.
    const pair = paired(await run(
      grades(81.39, 'B+', ['https://x.test/a', 'https://x.test/b']),
      refuses(['no_observed_links'], ['https://x.test/a', 'https://x.test/c']),
    ));
    expect(pair.composition.identical).toBe(false);
    expect(pair.composition.onlyInBase).toEqual(['https://x.test/b']);
    expect(pair.composition.onlyInHead).toEqual(['https://x.test/c']);
  });

  it('excludes a null verdict that did NOT come with a refusal — an engine contract violation', async () => {
    // `refused` and null score/grade are one contract (types/src/audit.ts). A null score without a
    // refusal is a broken engine, and reporting it as a refusal would invent a reason we never
    // received. It is a genuine instrument failure, so EXCLUDED is the honest row here.
    const nullNoRefusal: EngineApi = {
      crawlForAudit: async () => stubCrawl(['https://x.test/a']) as never,
      analyzeCrawl: () => ({ score: null, grade: null, pages: [], findings: [] }) as never,
    };
    const pair = await run(grades(80, 'B'), nullNoRefusal);
    expect(pair.excluded).toContain('without refusing');
  });

  it('renders a refused verdict as REFUSED with its triggers, never as a letter or a number', async () => {
    const pair = paired(await run(grades(81.39, 'B+'), refuses(['no_observed_links'])));
    expect(formatVerdict(pair.base)).toBe('B+/81.39');

    const rendered = formatVerdict(pair.head);
    expect(rendered).toContain('REFUSED');
    expect(rendered).toContain('no_observed_links');
    // No fabricated number anywhere in the cell — not 0, not 0.00, not a bare dash standing in for a
    // letter (SPEC 5.1a approved copy (f): "never a dash where a letter goes").
    expect(rendered).not.toMatch(/\d/);
    expect(rendered).not.toBe('—');
  });
});

describe('Stage 4 — the panel summary counts refusals separately', () => {
  const pair = (over: Partial<CompletedPair> & { url: string }): PairResult => ({
    url: over.url,
    base: over.base ?? { outcome: 'graded', score: 80, grade: 'B', urls: [], findingCounts: {}, budgetExhausted: false, health: '—' },
    head: over.head ?? { outcome: 'graded', score: 80, grade: 'B', urls: [], findingCounts: {}, budgetExhausted: false, health: '—' },
    grade: over.grade ?? { transition: 'graded→graded', scoreDelta: 0, gradeChanged: false, findingDeltas: {}, large: false },
    composition: over.composition ?? { baseDigest: 'x', headDigest: 'x', identical: true, baseCount: 1, headCount: 1, onlyInBase: [], onlyInHead: [] },
    excluded: null,
    elapsedMs: 1,
  });

  const excludedPair = (url: string, reason: string): PairResult =>
    ({ url, base: null, head: null, grade: null, composition: null, excluded: reason, elapsedMs: 1 });

  const lostLetterPair = (url: string, baseGrade: string, baseScore: number, triggers: string[]): PairResult =>
    pair({
      url,
      base: { outcome: 'graded', score: baseScore, grade: baseGrade, urls: [], findingCounts: {}, budgetExhausted: false, health: '—' },
      head: { outcome: 'refused', score: null, grade: null, triggers: triggers as never, urls: [], findingCounts: {}, budgetExhausted: false, health: '—' },
      grade: { transition: 'graded→refused', scoreDelta: null, gradeChanged: true, findingDeltas: {}, large: false },
    });

  const gainedLetterPair = (url: string): PairResult =>
    pair({
      url,
      base: { outcome: 'refused', score: null, grade: null, triggers: ['nothing_read'] as never, urls: [], findingCounts: {}, budgetExhausted: false, health: '—' },
      grade: { transition: 'refused→graded', scoreDelta: null, gradeChanged: true, findingDeltas: {}, large: false },
    });

  const refusedBothPair = (url: string): PairResult =>
    pair({
      url,
      base: { outcome: 'refused', score: null, grade: null, triggers: ['nothing_read'] as never, urls: [], findingCounts: {}, budgetExhausted: false, health: '—' },
      head: { outcome: 'refused', score: null, grade: null, triggers: ['nothing_read'] as never, urls: [], findingCounts: {}, budgetExhausted: false, health: '—' },
      grade: { transition: 'refused→refused', scoreDelta: null, gradeChanged: false, findingDeltas: {}, large: false },
    });

  const CORPUS: PairResult[] = [
    pair({ url: 'https://graded-1.test/' }),
    pair({ url: 'https://graded-2.test/' }),
    lostLetterPair('https://lost.test/', 'B+', 81.39, ['no_observed_links']),
    gainedLetterPair('https://gained.test/'),
    refusedBothPair('https://both.test/'),
    excludedPair('https://dead.test/', 'homepage fetch failed'),
  ];

  it('MUTATION TARGET 2: every pair lands in exactly one bucket — nothing is dropped', () => {
    // Kills any filter that removes refused rows before summarising. A panel reporting "mean Δ −2.1"
    // while silently dropping 51 refusals is the same class of dishonesty this spec exists to remove,
    // so the accounting must RECONCILE rather than merely be plausible.
    const s = summarisePairs(CORPUS);
    expect(s.total).toBe(6);
    expect(s.gradedBoth).toBe(2);
    expect(s.lostLetter).toHaveLength(1);
    expect(s.gainedLetter).toBe(1);
    expect(s.refusedBoth).toBe(1);
    expect(s.excluded).toBe(1);
    expect(s.gradedBoth + s.lostLetter.length + s.gainedLetter + s.refusedBoth + s.excluded).toBe(s.total);
  });

  it('ENUMERATES the sites that lost their letter, with the grade they lost and why', () => {
    // A count is not enough. `base B+ → head REFUSED` is the row the owner signs off, so the panel has
    // to name the site, the letter it used to carry, and the triggers that withdrew it.
    const s = summarisePairs(CORPUS);
    expect(s.lostLetter[0]).toEqual({
      url: 'https://lost.test/',
      baseGrade: 'B+',
      baseScore: 81.39,
      triggers: ['no_observed_links'],
    });
  });

  it('scopes the score-delta statistics to the graded→graded rows only', () => {
    // A mean over rows that have no score is not a mean. The delta stats must state the population
    // they were computed over, or "mean Δ" silently becomes a claim about sites that were never scored.
    const s = summarisePairs(CORPUS);
    expect(s.deltaPopulation).toBe(2);
    expect(s.largeDeltas).toBe(0);
  });

  it('renders the lost letters as their own section, before the counts, naming each site', () => {
    const lines = formatPanelSummary(summarisePairs(CORPUS)).join('\n');
    expect(lines).toContain('https://lost.test/');
    expect(lines).toContain('B+');
    expect(lines).toContain('no_observed_links');
    // Prominence is positional, not decorative: the headline must precede the delta statistics.
    expect(lines.indexOf('https://lost.test/')).toBeLessThan(lines.indexOf('|Δscore|'));
  });

  it('reports zero lost letters without inventing an empty section', () => {
    const s = summarisePairs([pair({ url: 'https://only-graded.test/' })]);
    expect(s.lostLetter).toEqual([]);
    expect(formatPanelSummary(s).join('\n')).not.toContain('LOST THEIR LETTER');
  });
});
