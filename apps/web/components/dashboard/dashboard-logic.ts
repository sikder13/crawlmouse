// The Pro dashboard's per-site view-logic. The DATA shapes are the v1.2 contract types (held in this
// branch's local shim until Phase G, then re-pointed to '@crawlmouse/types' — see lib/contract-v1_2.ts).
// This module owns only the pure VIEW helpers SPEC 03 renders with; it re-exports the contract types so
// the dashboard components keep importing them from one place.
export type {
  DashboardSite,
  DashboardSiteHistoryPoint,
  DashboardFixChecklistItem,
} from '../../lib/contract-v1_2';

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

/**
 * Warm, "remembers you" score-movement copy — feeling-known beats a bare diff (retention). Takes the
 * MonitoringDelta.scoreDelta (number | null); the grade transition (C→B) is shown separately (the badge).
 */
export function deltaSentence(scoreDelta: number | null): string {
  const delta = scoreDelta ?? 0;
  const n = Math.abs(delta);
  const pts = n === 1 ? 'point' : 'points';
  if (delta > 0) return `Your fixes are working — up ${n} ${pts} since your last visit`;
  if (delta < 0) return `Down ${n} ${pts} since your last visit — worth a look`;
  return 'Holding steady since your last visit';
}

/**
 * The re-audit endpoint returns ReauditResponse.newAuditId → the page navigates to /audit/<id>.
 * Pure extraction so the v1.2 field contract is unit-tested without a DOM.
 */
export function reauditTargetId(data: { newAuditId?: string | null }): string | null {
  return data.newAuditId ?? null;
}
