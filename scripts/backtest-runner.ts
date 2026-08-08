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
import {
  diffAudit,
  countFindings,
  diffCrawlComposition,
  SCORE_DELTA_THRESHOLD,
  type CompositionDiff,
  type AuditDiff,
} from './backtest-diff.js';

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

/**
 * The engine's own trigger vocabulary, derived structurally from `analyzeCrawl`'s return type rather
 * than re-declared here. Same reasoning as `EngineApi` above: a hand-written copy drifts silently, and
 * the drift would land in the one place the panel is supposed to be authoritative — the reason we gave
 * for withholding a letter.
 */
export type RefusalTriggerLike = NonNullable<AuditResultLike['refusal']>['triggers'][number];

interface SideCommon {
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

/**
 * SPEC 5.1a Stage 4 — one side of the panel either asserted a letter or DECLINED to.
 *
 * This is the replacement for the `throw` that used to sit in `runSide`. A refusal is a verdict the
 * engine reached about evidence it holds; an exception is a failure of the instrument. Conflating them
 * filed the panel's most valuable output — `base B+ → head REFUSED` — as a harness error and dropped
 * it out of every delta. A discriminated union makes the two impossible to confuse again, and gives
 * the `graded` arm a non-null `score` so the delta arithmetic needs no assertions.
 */
export type SideResult =
  | (SideCommon & { outcome: 'graded'; score: number; grade: string })
  | (SideCommon & {
      outcome: 'refused';
      /** NULL, never 0. A zero renders as F, and "we declined to assert" is not "we judged you badly." */
      score: null;
      grade: null;
      /** Every trigger that fired, so the row can say WHY rather than merely that it happened. */
      triggers: RefusalTriggerLike[];
    });

interface PairCommon {
  url: string;
  elapsedMs: number;
}

/** A pair both of whose crawls produced a verdict — graded or refused, in any combination. */
export type CompletedPair = PairCommon & {
  excluded: null;
  base: SideResult;
  head: SideResult;
  grade: AuditDiff;
  composition: CompositionDiff;
};

/**
 * A pair that could not be produced at all. `base`/`head`/`grade`/`composition` are NULL rather than
 * zeroed sentinels: a pair with an unusable crawl has no composition, and reporting "identical" — or
 * the old `{ score: 0, grade: '—' }` placeholder — would put a claim in the evidence table that no
 * measurement supports. The URL is still rendered as an EXCLUDED row, never dropped, so the corpus
 * count always reconciles.
 */
export type ExcludedPair = PairCommon & {
  excluded: string;
  base: null;
  head: null;
  grade: null;
  composition: null;
};

export type PairResult = CompletedPair | ExcludedPair;

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
  const result = engine.analyzeCrawl(crawlOut, ctx, v2);
  const common: SideCommon = {
    urls,
    findingCounts: countFindings(result.findings),
    budgetExhausted: !!crawlOut.budgetExhausted,
    health: formatHealth(result, !!crawlOut.budgetExhausted),
    fingerprint: (crawlOut as { fingerprint?: SideCommon['fingerprint'] }).fingerprint,
  };

  // THE REFUSAL BRANCH — checked BEFORE the empty-crawl guard, deliberately.
  //
  // `nothing_read` is a refusal that by construction fetched zero pages, so guarding on "0 ok pages"
  // first would file every one of those as a harness exclusion — re-creating, one layer down, exactly
  // the defect this change removes. The engine's verdict wins wherever it has one.
  if (result.refusal?.refused) {
    return { ...common, outcome: 'refused', score: null, grade: null, triggers: result.refusal.triggers };
  }

  // `refused` and a null score/grade are ONE contract (packages/types/src/audit.ts). A null verdict
  // arriving without a refusal is a broken engine, not a refusal — inventing a reason we never received
  // would be the same fabrication in the opposite direction, so this is a genuine instrument failure.
  if (result.score === null || result.grade === null) {
    throw new Error('engine asserted no verdict without refusing — refusal/score contract violated');
  }

  // Not a refusal and not a contract break: the engine graded, but on nothing. There is no sample to
  // diff, so the pair is genuinely unrunnable.
  if (urls.length === 0) {
    throw new Error(`0 ok pages${crawlOut.budgetExhausted ? ', budget exhausted' : ''}`);
  }

  return { ...common, outcome: 'graded', score: result.score, grade: result.grade };
}

/** One-cell verdict for the evidence table. A refusal renders as REFUSED + its reasons — never a
 *  letter, never a number, and never a bare dash standing where a letter goes (approved copy (f)). */
export function formatVerdict(side: SideResult): string {
  if (side.outcome === 'refused') {
    return `REFUSED (${side.triggers.join(', ') || 'no trigger reported'})`;
  }
  return `${side.grade}/${side.score.toFixed(2)}`;
}

function toSnapshot(side: SideResult) {
  return side.outcome === 'refused'
    ? { outcome: 'refused' as const, score: null, grade: null, triggers: side.triggers, findingCounts: side.findingCounts }
    : { outcome: 'graded' as const, score: side.score, grade: side.grade, findingCounts: side.findingCounts };
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
  try {
    const base = await runSide(input.baseEngine, input.url, input.baseV2, input);
    const head = await runSide(input.headEngine, input.url, input.headV2, input);
    return {
      url: input.url,
      base,
      head,
      grade: diffAudit(toSnapshot(base), toSnapshot(head)),
      // Composition is reported on EVERY completed pair, including one where neither side asserted a
      // letter. Which pages a refused crawl reached is precisely what attributes the refusal, so
      // dropping it here would blind the crawl-half instrument on the audits it matters most for.
      composition: diffCrawlComposition(base.urls, head.urls),
      excluded: null,
      elapsedMs: now() - t0,
    };
  } catch (e) {
    // Never drop a URL silently: an unrunnable site becomes a named EXCLUDED row so the corpus
    // count in the evidence file always reconciles. Every field a measurement would have filled is
    // NULL — there is no zeroed stand-in, because a stand-in is a claim.
    return {
      url: input.url,
      base: null,
      head: null,
      grade: null,
      composition: null,
      excluded: (e as Error).message,
      elapsedMs: now() - t0,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a Stage 4 — the panel summary.
//
// A panel that reports "mean Δ −2.1" while silently dropping 51 refusals is the same class of
// dishonesty this spec exists to remove. So the summary is a first-class, unit-tested value rather
// than counters accumulated inline in the CLI loop, and its central property is that it RECONCILES:
// every pair lands in exactly one bucket and the buckets sum to the corpus size.
// ─────────────────────────────────────────────────────────────────────────────

/** A site that carried a letter under the base engine and carries none under head. THE headline row. */
export interface LostLetter {
  url: string;
  baseGrade: string;
  baseScore: number;
  triggers: RefusalTriggerLike[];
}

export interface PanelSummary {
  total: number;
  excluded: number;
  gradedBoth: number;
  /** ENUMERATED, not counted: the owner signs off these rows individually in 5.1b. */
  lostLetter: LostLetter[];
  gainedLetter: number;
  refusedBoth: number;
  /**
   * The population the score-delta statistics were computed over — i.e. `gradedBoth`. Reported
   * explicitly so "mean Δ" can never be read as a claim about sites that were never scored.
   */
  deltaPopulation: number;
  largeDeltas: number;
  sampleMoved: number;
  /** Verdict moved on an IDENTICAL sample — an engine change, the only kind needing no crawl caveat. */
  engineOnly: number;
}

/** Did the verdict move at all? Generalised past the score, so a lost or gained letter counts even
 *  though it has no numeric delta. `refused→refused` is not a movement: neither side ever claimed. */
function verdictMoved(d: AuditDiff): boolean {
  return d.transition === 'graded→graded' ? d.scoreDelta !== 0 : d.transition !== 'refused→refused';
}

export function summarisePairs(pairs: PairResult[]): PanelSummary {
  const s: PanelSummary = {
    total: pairs.length,
    excluded: 0,
    gradedBoth: 0,
    lostLetter: [],
    gainedLetter: 0,
    refusedBoth: 0,
    deltaPopulation: 0,
    largeDeltas: 0,
    sampleMoved: 0,
    engineOnly: 0,
  };

  for (const p of pairs) {
    if (p.excluded !== null) {
      s.excluded += 1;
      continue;
    }
    if (!p.composition.identical) s.sampleMoved += 1;
    else if (verdictMoved(p.grade)) s.engineOnly += 1;

    switch (p.grade.transition) {
      case 'graded→graded':
        s.gradedBoth += 1;
        if (p.grade.large) s.largeDeltas += 1;
        break;
      case 'graded→refused':
        // Reading the base letter off the BASE side rather than the diff: the diff deliberately carries
        // no score for this transition, and the letter that was lost is the whole point of the row.
        if (p.base.outcome === 'graded' && p.head.outcome === 'refused') {
          s.lostLetter.push({
            url: p.url,
            baseGrade: p.base.grade,
            baseScore: p.base.score,
            triggers: p.head.triggers,
          });
        }
        break;
      case 'refused→graded':
        s.gainedLetter += 1;
        break;
      case 'refused→refused':
        s.refusedBoth += 1;
        break;
    }
  }

  s.deltaPopulation = s.gradedBoth;
  return s;
}

/**
 * Render the summary. Order is load-bearing: the lost letters come FIRST, named, before any delta
 * statistic — a headline buried under a mean is a headline nobody reads, and this panel exists so the
 * owner can sign off `base B+ → head REFUSED` row by row.
 */
export function formatPanelSummary(s: PanelSummary): string[] {
  const lines: string[] = [''];

  if (s.lostLetter.length > 0) {
    lines.push(
      `### ⚠ ${s.lostLetter.length} site(s) LOST THEIR LETTER (graded → REFUSED)`,
      '',
      'These carried a grade under the base engine and carry none under head. This is the headline of',
      'SPEC 5.1a: a withheld verdict, never a failing one. Each is signed off individually (§10).',
      '',
      ...s.lostLetter.map(
        (l) => `- \`${l.url}\` — base **${l.baseGrade}** (${l.baseScore.toFixed(2)}) → **REFUSED** (${l.triggers.join(', ')})`,
      ),
      '',
    );
  }

  lines.push(
    '### Verdict transitions',
    '',
    `- **${s.gradedBoth}** graded → graded`,
    `- **${s.lostLetter.length}** graded → REFUSED (letter lost)`,
    `- **${s.gainedLetter}** REFUSED → graded (letter gained)`,
    `- **${s.refusedBoth}** REFUSED → REFUSED (no letter either side)`,
    `- **${s.excluded}** excluded — the pair could not be produced (logged above, never silently dropped)`,
    '',
    `Reconciles: ${s.gradedBoth} + ${s.lostLetter.length} + ${s.gainedLetter} + ${s.refusedBoth} + ${s.excluded} = **${s.total}** sites.`,
    '',
    '### Score deltas',
    '',
    `Computed over the **${s.deltaPopulation}** graded→graded row(s) ONLY — the rows that have a score on`,
    'both sides. A refusal has no score, so it has no delta, and averaging it in as a zero would be a',
    'fabricated measurement.',
    '',
    `- **${s.largeDeltas}** site(s) with |Δscore| > ${SCORE_DELTA_THRESHOLD} — each must be explained before merge (SPEC 5.1 §10).`,
    `- **${s.sampleMoved}** site(s) where the fetched-page set changed (an explained input change; the moved URLs are named in the row).`,
    `- **${s.engineOnly}** site(s) where the verdict moved on an IDENTICAL sample — that is an engine change, and the only kind that needs no crawl caveat.`,
  );

  return lines;
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
