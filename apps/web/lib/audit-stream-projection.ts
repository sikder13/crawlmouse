import { asNumber } from './numeric';
import { classifyFailure, type FailureCategory } from './failure-classification';

/**
 * The audit row as read SERVER-SIDE by the SSE route (service-role). It carries `user_id` (for the
 * owner/Pro gate) and the raw `failure_reason` (error.message) — NEITHER of which may reach the
 * client. `projectAuditForClient` is the single chokepoint that strips them.
 */
export interface AuditRow {
  id: string;
  status: string;
  grade: string | null;
  score: number | string | null;
  page_count: number | null;
  link_count: number | null;
  cms_detected: string | null;
  user_id: string | null;
  settings: { pageCap?: number } | null;
  failure_reason: string | null;
}

/** Client-safe projection: `user_id` and the raw `failure_reason` are never present. */
export interface ClientAudit {
  id: string;
  status: string;
  grade: string | null;
  score: number | null;
  page_count: number | null;
  link_count: number | null;
  cms_detected: string | null;
  settings: { pageCap?: number } | null;
  failureCategory: FailureCategory | null;
}

/**
 * Project a server-side audit row to the client-safe shape: drop `user_id`, coerce the
 * PostgREST-numeric-string score to a number, and replace the raw `failure_reason` with a coarse,
 * classified `failureCategory`. The category is set ONLY for a genuinely failed audit — a stray
 * reason on a non-failed row is ignored — so a transient/incidental value can never surface failure
 * copy on a running or completed audit.
 */
export function projectAuditForClient(row: AuditRow): ClientAudit {
  return {
    id: row.id,
    status: row.status,
    grade: row.grade,
    score: asNumber(row.score),
    page_count: row.page_count,
    link_count: row.link_count,
    cms_detected: row.cms_detected,
    settings: row.settings,
    failureCategory: row.status === 'failed' ? classifyFailure(row.failure_reason) : null,
  };
}
