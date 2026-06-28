import type { ClientAuditV2 } from '@/lib/audit-stream-projection';
import type { ConfidenceBand, Finding, FixDiagnosis, ProjectedGrade } from '@crawlmouse/types';

// Pure view-logic for the result page — no rendering, no side effects, unit-tested. The conversion
// arc renders on these helpers; the discipline (relative deltas, never summed) lives here.

/** Ledger sorted by relative impact, highest first. Never mutates the input; never sums deltas. */
export function sortedLedger(ledger: FixDiagnosis[]): FixDiagnosis[] {
  return [...ledger].sort((a, b) => b.marginalDelta - a.marginalDelta);
}

/** Relative per-fix impact label (e.g. "+8 pts"). Relative — NEVER summed into a total. */
export function relativeImpactLabel(marginalDelta: number): string {
  return `+${Math.round(marginalDelta)} pts`;
}

/** The gap between the current grade and the achievable (engine-projected) grade. */
export function gradeGap(projected: ProjectedGrade): {
  current: { score: number; grade: string };
  projected: { score: number; grade: string };
  scoreGain: number;
} {
  return {
    current: projected.current,
    projected: projected.projected,
    scoreGain: Math.max(0, projected.projected.score - projected.current.score),
  };
}

/** Severity → human display word (decision: medium → "Warning", minor → "Info"). */
export function severityLabel(severity: Finding['severity']): string {
  switch (severity) {
    case 'critical':
      return 'Critical';
    case 'medium':
      return 'Warning';
    case 'minor':
      return 'Info';
    default:
      return 'Info';
  }
}

// Site-wide caveats that render as informational banners, not actionable ledger rows.
const INFORMATIONAL: ReadonlySet<string> = new Set(['js_rendered', 'incomplete_crawl']);

/** Findings to render as site-wide informational banners (e.g. js_rendered, incomplete_crawl). */
export function informationalFindings(findings: Finding[]): Finding[] {
  return findings.filter((f) => INFORMATIONAL.has(f.category));
}

/** How many cures sit behind the wall (locked), for the "N more fixes" affordance. */
export function lockedCureCount(
  audit: Pick<ClientAuditV2, 'projectedGrade' | 'freeFix' | 'hasMorePrescriptions'>,
): number {
  if (!audit.hasMorePrescriptions) return 0;
  const total = audit.projectedGrade?.ledger.length ?? 0;
  const free = audit.freeFix ? 1 : 0;
  return Math.max(0, total - free);
}

/** Estimate basis copy: "based on N of ~M pages" (or "based on N pages" when M is unknown). */
export function estimateBasisText(band: ConfidenceBand): string {
  const { crawled, estimatedTotal } = band.basis;
  return estimatedTotal != null
    ? `based on ${crawled} of ~${estimatedTotal} pages`
    : `based on ${crawled} pages`;
}

/** The exact text the action-packet copy button writes to the clipboard (U7). */
export function actionPacketClipboardText(packet: { body: string }): string {
  return packet.body;
}

// ── Grade gauge (D0) ──────────────────────────────────────────────────────────
export type GaugeTier = 'strong' | 'fair' | 'weak';
export interface GaugeMeta {
  tier: GaugeTier;
  arcClass: string; // SVG stroke color (via currentColor)
  icon: string; // non-color tier signal (a11y)
  headline: string;
  sub: string;
}

// Tier by grade letter — an A and an F must FEEL different. A/B = strong (sage), C/D = fair (the
// reserved brand orange #ff7849 = text-peach), F = weak (warning). Low grades are framed as a
// supportive, fixable opportunity — never humiliation.
export function gaugeTier(grade: string): GaugeMeta {
  const c = (grade.trim()[0] ?? '').toUpperCase();
  if (c === 'A' || c === 'B') {
    return {
      tier: 'strong',
      arcClass: 'text-sage',
      icon: '✓',
      headline: 'Strong internal linking',
      sub: 'Your pages connect well — keep it up.',
    };
  }
  if (c === 'C' || c === 'D') {
    return {
      tier: 'fair',
      arcClass: 'text-peach',
      icon: '↗',
      headline: 'Solid, with room to climb',
      sub: 'A few fixes could lift this noticeably — start with the one below.',
    };
  }
  return {
    tier: 'weak',
    arcClass: 'text-warning',
    icon: '!',
    headline: 'This is very fixable',
    sub: 'Let’s start with the highest-impact fix below.',
  };
}

/** SVG stroke-dashoffset for a 0–100 value on a ring of the given circumference (0 = empty ring). */
export function gaugeDashoffset(value: number, circumference: number): number {
  const pct = Math.max(0, Math.min(100, value)) / 100;
  return circumference * (1 - pct);
}
