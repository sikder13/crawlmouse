/**
 * SPEC 01 §10 — the props for the `audit-completed` PostHog funnel event. Extracted as a pure helper
 * so the v2 crawl-health enrichment is unit-testable without a React render (AuditView calls it).
 *
 * v1 contract (load-bearing): with no crawl-health the returned object is byte-identical to the
 * pre-v2 call site (`{ status, grade, score }`), so an `ENGINE_V2`-off audit emits nothing new.
 */
export interface AuditCompletedCrawlHealth {
  confidence: string;
  coveragePct: number;
  blockRate: number;
  partial: boolean;
}

export interface AuditCompletedSnapshot {
  status: string;
  grade?: string | null;
  score?: number | null;
  crawlHealth?: AuditCompletedCrawlHealth | null;
}

export function auditCompletedProps(snapshot: AuditCompletedSnapshot): Record<string, unknown> {
  const base = { status: snapshot.status, grade: snapshot.grade ?? null, score: snapshot.score ?? null };
  if (!snapshot.crawlHealth) return base;
  const { confidence, coveragePct, blockRate, partial } = snapshot.crawlHealth;
  return { ...base, confidence, coveragePct, blockRate, partial };
}
