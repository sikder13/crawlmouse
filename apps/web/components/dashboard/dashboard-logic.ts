import type { Confidence } from '@crawlmouse/types';

// The Pro dashboard's per-site "what changed since last visit" shape + pure view-logic. This shape
// is a PROPOSED aggregation (per-site delta + history + fix-checklist) that SPEC 02 must provide at
// integration — it is NOT in the frozen §1 contract (which is per-audit). Built against fixtures now;
// the exact shape is flagged for owner/SPEC 02 confirmation at the dashboard checkpoint.

export interface DashboardSitePoint {
  auditId: string;
  grade: string;
  score: number;
  ranAt: string; // ISO
}

export interface DashboardSiteDelta {
  gradeFrom: string;
  gradeTo: string;
  scoreDelta: number; // current − previous
}

export interface DashboardSite {
  url: string;
  latestAuditId: string;
  grade: string;
  score: number;
  confidence: Confidence | null;
  lastRunAt: string; // ISO
  delta: DashboardSiteDelta | null; // null on the first audit of a site
  history: DashboardSitePoint[]; // oldest → newest, for the sparkline
  fixChecklist: { done: number; total: number }; // the open-loop ("3 of 7 done")
}

export type DeltaDirection = 'up' | 'down' | 'flat';

export function deltaDirection(scoreDelta: number): DeltaDirection {
  if (scoreDelta > 0) return 'up';
  if (scoreDelta < 0) return 'down';
  return 'flat';
}

export function deltaArrow(dir: DeltaDirection): string {
  return dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■';
}

/** SVG polyline points for a sparkline; scores 0..100 mapped into [w,h] with y inverted. */
export function sparklinePoints(scores: number[], w: number, h: number): string {
  const y = (s: number) => h - (Math.max(0, Math.min(100, s)) / 100) * h;
  if (scores.length === 0) return '';
  if (scores.length === 1) return `0,${y(scores[0] ?? 0).toFixed(1)}`;
  const step = w / (scores.length - 1);
  return scores.map((s, i) => `${(i * step).toFixed(1)},${y(s).toFixed(1)}`).join(' ');
}

/** Open-loop pull: how many fixes remain. */
export function checklistRemaining(done: number, total: number): number {
  return Math.max(0, total - done);
}

/** Human time-span of a history ("over 25 days" / "over 3 months"); null when < 2 points. */
export function historySpanLabel(points: { ranAt: string }[]): string | null {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  const days = Math.round((new Date(last.ranAt).getTime() - new Date(first.ranAt).getTime()) / 86_400_000);
  if (days < 1) return null;
  return days < 45 ? `over ${days} days` : `over ${Math.round(days / 30)} months`;
}

/** Warm, "remembers you" delta copy — feeling-known beats a bare diff (retention). */
export function deltaSentence(delta: DashboardSiteDelta): string {
  const n = Math.abs(delta.scoreDelta);
  const pts = n === 1 ? 'point' : 'points';
  if (delta.scoreDelta > 0) return `Your fixes are working — up ${n} ${pts} since your last visit`;
  if (delta.scoreDelta < 0) return `Down ${n} ${pts} since your last visit — worth a look`;
  return 'Holding steady since your last visit';
}
