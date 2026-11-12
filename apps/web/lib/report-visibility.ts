import type { PublicReportRow } from './report-row';
import { checksPublicEnabled } from './auth/flags';
import { isV2Snapshot } from './v2/reports/snapshot';

// SPEC 04 §3/§8 — robots + 404 gating for a public report, derived from its visibility columns.
// Deploy-order safety: when a column is `undefined` (a legacy/pre-Runbook-B read), preserve today's
// behavior — existing reports were all minted under mandatory verification, so they are treated as
// claimed + indexed. Post-migration, a NEW unclaimed report has `indexable=false`/`claimed_at=null`
// (the guardrail default) → noindex.

/**
 * A report is GONE (render 404) when hidden, taken down, missing, or ungradeable. This is v1's reading,
 * for v1's page and its OG card: a v2 report (CC-29) has no `grade` of its own (the insert trigger
 * copies it from `audits`, and a v2 row names none), so it is gone here whatever V2_CHECKS_PUBLIC
 * says, and no spelling of `/r/<slug>` that reaches v1's page renders a v2 snapshot
 * (`app/r/[slug]/page.v2-row.test.tsx`).
 */
export function isReportGone(report: PublicReportRow | null): boolean {
  if (!report || !report.grade) return true;
  if (report.takedown_requested_at) return true;
  if (report.hidden_at) return true; // undefined (pre-migration) is falsy → not hidden
  return false;
}

/**
 * Gone for a surface that serves either kind (the v2 report route and card, and the claim,
 * visibility and view APIs; `mine`, `logo` and `white-label` keep v1's reading): a row
 * holding a v2 snapshot is gone while V2_CHECKS_PUBLIC is off, and otherwise only when hidden or
 * taken down; any other row is gone as `isReportGone` says.
 */
export function isReportGoneEitherKind(report: PublicReportRow | null): boolean {
  if (report && isV2Snapshot(report.report_snapshot)) {
    if (report.takedown_requested_at || report.hidden_at) return true;
    return !checksPublicEnabled();
  }
  return isReportGone(report);
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
