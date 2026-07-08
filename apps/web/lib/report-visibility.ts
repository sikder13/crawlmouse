import type { PublicReportRow } from './reports';

// SPEC 04 §3/§8 — robots + 404 gating for a public report, derived from its visibility columns.
// Deploy-order safety: when a column is `undefined` (a legacy/pre-Runbook-B read), preserve today's
// behavior — existing reports were all minted under mandatory verification, so they are treated as
// claimed + indexed. Post-migration, a NEW unclaimed report has `indexable=false`/`claimed_at=null`
// (the guardrail default) → noindex.

/** A report is GONE (render 404) when hidden, taken down, missing, or ungradeable. */
export function isReportGone(report: PublicReportRow | null): boolean {
  if (!report || !report.grade) return true;
  if (report.takedown_requested_at) return true;
  if (report.hidden_at) return true; // undefined (pre-migration) is falsy → not hidden
  return false;
}

/** Claimed = domain-verified owner. Pre-migration rows (undefined) were all verified → claimed. */
export function isReportClaimed(report: PublicReportRow): boolean {
  return report.claimed_at === undefined ? true : report.claimed_at != null;
}

/**
 * Whether search engines may index this report. Unclaimed reports are noindex by default (§8); a
 * claimed report is indexable unless the owner opted out; hidden/taken-down reports are never indexed.
 * Pre-migration (indexable undefined) preserves today's indexed behavior.
 */
export function reportRobotsIndex(report: PublicReportRow): boolean {
  if (report.takedown_requested_at || report.hidden_at) return false;
  if (report.indexable === undefined) return true; // legacy/pre-migration: indexed as today
  return report.indexable === true;
}
