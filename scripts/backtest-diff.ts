// Pure, side-effect-free diff helpers for the crawl-once-grade-twice backtest (SPEC 01 v2 §8).
// NO env / DB / engine imports here, so it is unit-testable (backtest-diff.test.ts) without running
// the harness (backtest-engine.ts reads .env.local + hits Supabase at import). The harness imports
// these to render its v1-vs-v2 diff; a |Δscore| over the threshold "blocks the flip" until explained.

export const SCORE_DELTA_THRESHOLD = 5; // |Δscore| above this must be explained before cutover (§8)

export interface GradeSnapshot {
  score: number;
  grade: string;
  findingCounts: Record<string, number>;
}

export interface AuditDiff {
  scoreDelta: number; // v2 - v1
  gradeChanged: boolean;
  findingDeltas: Record<string, number>; // v2 - v1 per category, non-zero only
  large: boolean; // |scoreDelta| > SCORE_DELTA_THRESHOLD
}

/** Tally an engine result's findings by category. */
export function countFindings(findings: { category: string }[]): Record<string, number> {
  return findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.category] = (acc[f.category] ?? 0) + 1;
    return acc;
  }, {});
}

/**
 * Diff a v1 grade against a v2 grade computed over the SAME crawl output. Both scores are real
 * numbers (analyzeCrawl always grades), so there is no null/NaN case as in the old re-crawl harness.
 */
export function diffAudit(v1: GradeSnapshot, v2: GradeSnapshot): AuditDiff {
  const scoreDelta = v2.score - v1.score;
  const categories = new Set([...Object.keys(v1.findingCounts), ...Object.keys(v2.findingCounts)]);
  const findingDeltas: Record<string, number> = {};
  for (const c of categories) {
    const d = (v2.findingCounts[c] ?? 0) - (v1.findingCounts[c] ?? 0);
    if (d !== 0) findingDeltas[c] = d;
  }
  return {
    scoreDelta,
    gradeChanged: v1.grade !== v2.grade,
    findingDeltas,
    large: Math.abs(scoreDelta) > SCORE_DELTA_THRESHOLD,
  };
}

/** Render non-zero finding deltas compactly, e.g. "orphan:-3, incomplete_crawl:+1" ("—" for none). */
export function formatFindingDeltas(findingDeltas: Record<string, number>): string {
  const entries = Object.entries(findingDeltas);
  if (entries.length === 0) return '—';
  return entries.map(([k, v]) => `${k}:${v > 0 ? '+' : ''}${v}`).join(', ');
}
