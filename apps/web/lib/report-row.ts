import type { PublicReportSnapshot, WhiteLabelConfig } from '@crawlmouse/types';

export interface PublicReportRow {
  domain: string;
  grade: string | null;
  score: number | string | null;
  cms_detected: string | null;
  orphan_count: number | null;
  avg_depth: number | string | null;
  takedown_requested_at: string | null;
  created_at: string;
  // SPEC 04 §3/§4 — present after Runbook B; `undefined` on a legacy/pre-migration (42703) read, in
  // which case the page renders today's behavior (indexed, denormalized columns). `minted_by` is
  // deliberately NEVER selected (a user id must not reach the render path — §11).
  report_snapshot?: PublicReportSnapshot | null;
  claimed_at?: string | null;
  listed?: boolean | null;
  indexable?: boolean | null;
  hidden_at?: string | null;
  // SPEC 04 §5 — white-label branding (claimed Pro reports). null/undefined = Crawlmouse-branded.
  white_label?: WhiteLabelConfig | null;
}

// The legacy (pre-SPEC-04) render columns — always present. The extended set adds the visibility +
// snapshot columns (Runbook B). NEITHER selects minted_by.
export const LEGACY_REPORT_COLS =
  'domain, grade, score, cms_detected, orphan_count, avg_depth, takedown_requested_at, created_at';
export const EXTENDED_REPORT_COLS = `${LEGACY_REPORT_COLS}, report_snapshot, claimed_at, listed, indexable, hidden_at, white_label`;
