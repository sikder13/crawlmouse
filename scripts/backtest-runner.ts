// SPEC 5.1a Stage 0.5 — the backtest's engine-facing half, with NO env and NO database access.
//
// WHY THIS MODULE EXISTS (the defect it repairs)
// The pre-5.1 harness crawled a site ONCE and graded that single output under v1 and v2
// (`analyzeCrawl(crawlOut, ctx, false)` vs `…true`), so its axis was the GRADING half. SPEC 5.1a's
// Stage 1 (robots on every entry path, canonicalisation, trap caps) and Stage 3 (stratified frontier)
// change WHICH PAGES ARE FETCHED. A crawl-half change is applied identically to both sides of a
// one-crawl diff and cancels out EXACTLY, so the old harness would report Δ0.00 across the corpus
// while every production grade moved. That is the same blindness SPEC 05 discovered when the harness
// silently could not observe AI-readiness output.
//
// The axis here is therefore BASE ENGINE vs HEAD ENGINE: two independent crawls, each graded by the
// engine that produced it, compared on BOTH grade and crawl composition. Composition is reported even
// when the grade is unchanged, because equal grades do not imply equal samples — measured in
// production, two duskroute.com runs scored an identical 61.20 from discovered sets of 2 526 and
// 2 979 URLs.
//
// Kept free of env/DB imports so it is unit-testable (`backtest-runner.test.ts`) with injected engines
// and against a loopback fixture; `backtest-engine.ts` is the thin CLI that supplies the corpus.

import type { crawlForAudit, analyzeCrawl } from '@crawlmouse/engine';
import { diffAudit, countFindings, diffCrawlComposition, type CompositionDiff, type AuditDiff } from './backtest-diff.js';

/**
 * The slice of the engine's public surface the harness drives, typed as the REAL signatures rather
 * than a hand-written structural approximation. A hand-written one drifts from the engine silently
 * and, worse, is what let the first version of this file compile while accepting an `opts` shape the
 * engine would reject at runtime. A SECOND engine build — a checkout at the base SHA, loaded through
 * `loadEngineFromPath` — is the same code, so it satisfies these by construction.
 */
export interface EngineApi {
  crawlForAudit: typeof crawlForAudit;
  analyzeCrawl: typeof analyzeCrawl;
}

type CrawlOutputLike = Awaited<ReturnType<typeof crawlForAudit>>['crawlOut'];
type AuditResultLike = ReturnType<typeof analyzeCrawl>;
type AuditOptionsLike = Parameters<typeof crawlForAudit>[0];
type FlagsLike = Parameters<typeof crawlForAudit>[1];

export interface SideResult {
  score: number;
  grade: string;
  /** HTTP-200 page identities — the composition basis (see `okUrls`). */
  urls: string[];
  findingCounts: Record<string, number>;
  budgetExhausted: boolean;
  health: string;
  /**
   * SPEC 5.1a §6.7 — the engine's own fingerprint, when the deterministic frontier produced one.
   * Reported even before it has a database home: an unattributed live delta is the E3 problem
   * repeating, so the instrument has to be present at the moment of measurement, not after it.
   */
  fingerprint?: { discoveredCount: number; selectedCount: number; digest: string; strata: { templateKey: string; discovered: number; selected: number }[] };
}

export interface PairResult {
  url: string;
  base: SideResult;
  head: SideResult;
  grade: AuditDiff;
  /**
   * NULL on an excluded row, and deliberately so: a pair with only one usable crawl has no
   * composition, and reporting "identical" (or a fabricated difference) for it would put a claim in
   * the evidence table that no measurement supports.
   */
  composition: CompositionDiff | null;
  /** Non-null when the pair could not be produced; the row is rendered EXCLUDED, never dropped. */
  excluded: string | null;
  elapsedMs: number;
}

export interface RunPairInput {
  url: string;
  baseEngine: EngineApi;
  headEngine: EngineApi;
  /** Engine-path selector per side. Both true in normal base-vs-head use; differing only in tests. */
  baseV2: boolean;
  headV2: boolean;
  opts: Omit<AuditOptionsLike, 'url'>;
  flags: FlagsLike;
  /** Wall-clock guard per crawl; a non-settling crawl becomes an EXCLUDED row, never a dead run. */
  watchdogMs?: number;
  now?: () => number;
}

const DEFAULT_WATCHDOG_MS = 300_000;

/**
 * HTTP-200 page identities only.
 *
 * A 403/429/0 row is a crawl OUTCOME, not a page of the site (engine §1 node-eligibility), and it is
 * exactly the kind of row that varies with a host's mood. Letting one into the digest would make a
 * transient block indistinguishable from a real sampling change and produce a false "the sample moved"
 * verdict on every throttling host — the instrument would then be noisier than the thing it measures.
 */
function okUrls(crawlOut: CrawlOutputLike): string[] {
  return crawlOut.pages.filter((p) => p.statusCode === 200).map((p) => p.url);
}

function formatHealth(r: AuditResultLike, budgetExhausted: boolean): string {
  const h = r.crawlHealth;
  if (!h) return '—';
  const partial = h.partial || budgetExhausted;
  return `${h.confidence} cov=${(h.coveragePct * 100).toFixed(0)}% blk=${(h.blockRate * 100).toFixed(0)}%${partial ? ' partial' : ''}`;
}

/** Race a crawl against a watchdog so an orphaned (never-settling) promise cannot drain the event
 *  loop and kill the whole run — a non-settling promise is not a rejection, so try/catch cannot see
 *  it. Carried over from the previous harness, which learned this the hard way (Node exit 13). */
async function crawlWithWatchdog(
  engine: EngineApi,
  url: string,
  opts: Omit<AuditOptionsLike, 'url'>,
  flags: FlagsLike,
  v2: boolean,
  watchdogMs: number,
): Promise<Awaited<ReturnType<typeof crawlForAudit>>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      engine.crawlForAudit({ ...opts, url }, flags, v2),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`crawl did not settle within ${(watchdogMs / 1000).toFixed(0)}s (watchdog)`)),
          watchdogMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runSide(
  engine: EngineApi,
  url: string,
  v2: boolean,
  input: RunPairInput,
): Promise<SideResult> {
  const { crawlOut, ctx } = await crawlWithWatchdog(
    engine, url, input.opts, input.flags, v2, input.watchdogMs ?? DEFAULT_WATCHDOG_MS,
  );
  const urls = okUrls(crawlOut);
  if (urls.length === 0) {
    throw new Error(`0 ok pages${crawlOut.budgetExhausted ? ', budget exhausted' : ''}`);
  }
  const result = engine.analyzeCrawl(crawlOut, ctx, v2);
  return {
    score: result.score,
    grade: result.grade,
    urls,
    findingCounts: countFindings(result.findings),
    budgetExhausted: !!crawlOut.budgetExhausted,
    health: formatHealth(result, !!crawlOut.budgetExhausted),
    fingerprint: (crawlOut as { fingerprint?: SideResult['fingerprint'] }).fingerprint,
  };
}

/**
 * Crawl and grade one URL under BOTH engines, then diff grade AND composition.
 *
 * The two crawls run SEQUENTIALLY and back to back so the interval in which the site could genuinely
 * change is as small as this design allows. It cannot be zero, which is why a composition difference
 * is reported as evidence to be attributed — the digest names the pages that moved — and never as a
 * verdict on its own.
 */
export async function runEnginePair(input: RunPairInput): Promise<PairResult> {
  const now = input.now ?? Date.now;
  const t0 = now();
  const empty: SideResult = { score: 0, grade: '—', urls: [], findingCounts: {}, budgetExhausted: false, health: '—' };
  try {
    const base = await runSide(input.baseEngine, input.url, input.baseV2, input);
    const head = await runSide(input.headEngine, input.url, input.headV2, input);
    return {
      url: input.url,
      base,
      head,
      grade: diffAudit(
        { score: base.score, grade: base.grade, findingCounts: base.findingCounts },
        { score: head.score, grade: head.grade, findingCounts: head.findingCounts },
      ),
      composition: diffCrawlComposition(base.urls, head.urls),
      excluded: null,
      elapsedMs: now() - t0,
    };
  } catch (e) {
    // Never drop a URL silently: an unrunnable site becomes a named EXCLUDED row so the corpus
    // count in the evidence file always reconciles.
    return {
      url: input.url,
      base: empty,
      head: empty,
      grade: diffAudit({ score: 0, grade: '—', findingCounts: {} }, { score: 0, grade: '—', findingCounts: {} }),
      composition: null,
      excluded: (e as Error).message,
      elapsedMs: now() - t0,
    };
  }
}

/**
 * Load a SECOND engine build from an absolute path to another checkout's `packages/engine/src/index.ts`
 * (typically a `git worktree` pinned at the base SHA). Dynamic import, so the base engine is a fully
 * independent module graph — the only way to compare two crawl halves in one process.
 *
 * Deliberately takes a PATH rather than a git ref: creating or mutating a worktree is the operator's
 * action, not the harness's, and a harness that silently checks out revisions is a harness that can
 * lose uncommitted work.
 */
export async function loadEngineFromPath(absPath: string): Promise<EngineApi> {
  const mod = (await import(absPath)) as Partial<EngineApi>;
  if (typeof mod.crawlForAudit !== 'function' || typeof mod.analyzeCrawl !== 'function') {
    throw new Error(
      `base engine at ${absPath} does not export crawlForAudit + analyzeCrawl — ` +
        'point --base-engine at <checkout>/packages/engine/src/index.ts',
    );
  }
  return { crawlForAudit: mod.crawlForAudit, analyzeCrawl: mod.analyzeCrawl };
}
