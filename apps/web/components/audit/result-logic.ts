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
