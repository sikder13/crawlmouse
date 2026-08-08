// Pure, side-effect-free diff helpers for the backtest harness.
// NO env / DB / engine imports here (node:crypto only), so it is unit-testable (backtest-diff.test.ts)
// without running the harness (backtest-engine.ts reads .env.local + hits Supabase at import).
//
// Two axes live here:
//   - GRADE diff (`diffAudit`, SPEC 01 v2 §8) — the original cutover gate: two gradings of one crawl.
//   - COMPOSITION diff (`diffCrawlComposition`, SPEC 5.1a Stage 0.5) — which pages were fetched at all.
// The second exists because the first is structurally blind to the crawl half: a change to WHICH pages
// are fetched applies identically to both sides of a one-crawl grade diff and cancels out exactly.

import { createHash } from 'node:crypto';

export const SCORE_DELTA_THRESHOLD = 5; // |Δscore| above this must be explained before cutover (§8)

/**
 * SPEC 5.1a Stage 4 — a side of the panel either asserted a letter or declined to.
 *
 * A DISCRIMINATED UNION rather than a nullable score, deliberately. A bare `score: null` reads equally
 * as "refused", "not measured yet" and "zero", and the harness previously resolved that ambiguity by
 * throwing — filing the engine's most informative verdict as a harness error. Here the refusal has to
 * announce itself, and the `graded` arm's `score: number` makes the delta arithmetic total without a
 * non-null assertion anywhere.
 *
 * `triggers` is `readonly string[]` because this module does not know the trigger VOCABULARY and must
 * not learn it: it is engine-import-free by contract (node:crypto only, see the header). The real
 * `RefusalTrigger` union is enforced one layer up in backtest-runner.ts, where it is derived
 * structurally from the engine's own return type.
 */
export type GradeSnapshot =
  | { outcome: 'graded'; score: number; grade: string; findingCounts: Record<string, number> }
  | {
      outcome: 'refused';
      score: null;
      grade: null;
      triggers: readonly string[];
      findingCounts: Record<string, number>;
    };

/** The four transitions the panel must tell apart. `graded→refused` is the headline of SPEC 5.1a. */
export type GradeTransition = 'graded→graded' | 'graded→refused' | 'refused→graded' | 'refused→refused';

export interface AuditDiff {
  /** Which of the four cases this row is. The row renderer and the summary both switch on this. */
  transition: GradeTransition;
  /**
   * head − base, and **NULL unless both sides graded**. There is no delta between a measurement and
   * the absence of one: coercing the missing side to 0 would print a fabricated ~80-point collapse for
   * a site we merely stopped grading, and 0 renders as F.
   */
  scoreDelta: number | null;
  /** True when a letter appeared or disappeared, or when two asserted letters differ. */
  gradeChanged: boolean;
  findingDeltas: Record<string, number>; // head - base per category, non-zero only
  /**
   * |scoreDelta| > SCORE_DELTA_THRESHOLD — a property OF THE SCORE DELTA, so necessarily false on any
   * row without one. A lost letter is not "a large delta"; it is a different kind of event, and the
   * must-explain obligation for it is raised by the panel summary rather than by overloading this flag.
   */
  large: boolean;
}

/** Tally an engine result's findings by category. */
export function countFindings(findings: { category: string }[]): Record<string, number> {
  return findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.category] = (acc[f.category] ?? 0) + 1;
    return acc;
  }, {});
}

/**
 * Diff the base side against the head side.
 *
 * Since Stage 4 either side may have DECLINED to assert a letter, so this is no longer pure
 * arithmetic: three of the four transitions have no numeric delta at all, and the honest report for
 * them is the transition itself. Finding deltas are computed on every transition, because a refused
 * audit still produces findings — they are the substance a refused row carries.
 */
export function diffAudit(base: GradeSnapshot, head: GradeSnapshot): AuditDiff {
  const categories = new Set([...Object.keys(base.findingCounts), ...Object.keys(head.findingCounts)]);
  const findingDeltas: Record<string, number> = {};
  for (const c of categories) {
    const d = (head.findingCounts[c] ?? 0) - (base.findingCounts[c] ?? 0);
    if (d !== 0) findingDeltas[c] = d;
  }
  const transition = `${base.outcome}→${head.outcome}` as GradeTransition;

  if (base.outcome === 'graded' && head.outcome === 'graded') {
    const scoreDelta = head.score - base.score;
    return {
      transition,
      scoreDelta,
      gradeChanged: base.grade !== head.grade,
      findingDeltas,
      large: Math.abs(scoreDelta) > SCORE_DELTA_THRESHOLD,
    };
  }

  return {
    transition,
    scoreDelta: null,
    // A letter appeared or disappeared iff exactly one side asserted one. refused→refused is NOT a
    // change: neither side ever claimed anything, and reporting a movement there would put a claim in
    // the panel that no measurement supports.
    gradeChanged: base.outcome !== head.outcome,
    findingDeltas,
    large: false,
  };
}

/** Render non-zero finding deltas compactly, e.g. "orphan:-3, incomplete_crawl:+1" ("—" for none). */
export function formatFindingDeltas(findingDeltas: Record<string, number>): string {
  const entries = Object.entries(findingDeltas);
  if (entries.length === 0) return '—';
  return entries.map(([k, v]) => `${k}:${v > 0 ? '+' : ''}${v}`).join(', ');
}

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a Stage 0.5 — crawl composition (the crawl-half instrument)
// ─────────────────────────────────────────────────────────────────────────────

export interface CompositionDiff {
  baseDigest: string;
  headDigest: string;
  identical: boolean;
  baseCount: number;
  headCount: number;
  /** Sorted URLs fetched by base and not by head. */
  onlyInBase: string[];
  /** Sorted URLs fetched by head and not by base. */
  onlyInHead: string[];
}

/**
 * Stable digest over the SET of fetched URLs — SPEC 5.1a §6.7's instrument, computed harness-side so
 * it is available before the engine persists one.
 *
 * Sorted and deduped first, so ARRIVAL ORDER cannot reach the digest. That is the entire point:
 * arrival order is a forbidden input to the frontier (§6.6), so two crawls that reached the same pages
 * in different orders must be indistinguishable here, and a digest difference is then evidence about
 * the SAMPLE rather than about the network.
 *
 * Construction: sha256 over each sorted-unique URL followed by '\n'. The terminator is what stops
 * ['ab','c'] and ['a','bc'] colliding. `.sort()` is a codepoint comparison (never `localeCompare`,
 * which is ICU/locale-dependent and would differ across Node builds — the url-canonical.ts lesson).
 */
export function crawlDigest(urls: string[]): string {
  const h = createHash('sha256');
  for (const u of [...new Set(urls)].sort()) h.update(`${u}\n`);
  return h.digest('hex');
}

/**
 * Diff two crawls by WHICH pages they fetched. This is the signal `diffAudit` cannot carry: two crawls
 * can produce an identical grade from different page sets — measured in production, where two
 * duskroute.com runs both scored 61.20 from discovered sets of 2 526 and 2 979 URLs. Reporting the set
 * DIFFERENCE (not merely a boolean) is what lets a grade movement be attributed to named pages.
 */
export function diffCrawlComposition(baseUrls: string[], headUrls: string[]): CompositionDiff {
  const base = new Set(baseUrls);
  const head = new Set(headUrls);
  const baseDigest = crawlDigest(baseUrls);
  const headDigest = crawlDigest(headUrls);
  return {
    baseDigest,
    headDigest,
    identical: baseDigest === headDigest,
    baseCount: base.size,
    headCount: head.size,
    onlyInBase: [...base].filter((u) => !head.has(u)).sort(),
    onlyInHead: [...head].filter((u) => !base.has(u)).sort(),
  };
}

/**
 * One-cell rendering of a composition diff for the evidence table. Bounded, and it STATES what it
 * withheld ("+9 more") rather than truncating silently — a table that prints 3 of 500 moved URLs
 * without saying so reads as "only 3 moved", which is the reporting failure this whole stage exists
 * to stop.
 */
export function formatCompositionDelta(d: CompositionDiff, maxUrls: number): string {
  if (d.identical) return 'identical';
  const moved = [...d.onlyInBase, ...d.onlyInHead];
  const shown = moved.slice(0, maxUrls).map((u) => {
    try {
      const { pathname, search } = new URL(u);
      return (pathname + search).slice(0, 60) || '/';
    } catch {
      return u.slice(0, 60);
    }
  });
  const withheld = moved.length - shown.length;
  const tail = withheld > 0 ? `, +${withheld} more` : '';
  return `−${d.onlyInBase.length}/+${d.onlyInHead.length} (${shown.join(' ')}${tail})`;
}
