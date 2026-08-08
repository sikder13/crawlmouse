import type { SupabaseClient } from '@supabase/supabase-js';
import { isUndefinedColumnError } from '@/lib/pg-errors';

export interface BadgeReportRow {
  slug: string;
  grade: string | null;
  score: number | string | null;
}

/**
 * SPEC 5.1a Stage 4 — SURFACE 5 of 13: what the embed badge may claim.
 *
 * A BADGE IS A CLAIM. It is an assertion, rendered inside a third party's page, that this domain
 * scored something — so when there is nothing to claim the badge REFUSES TO MINT rather than
 * rendering an emptied version of itself. That is the approved copy verbatim: the embed route returns
 * the "not available" badge.
 *
 * BOTH halves are required. The route rendered `Score — / 100` whenever the score was missing but a
 * letter survived: the same fabricated-glyph failure as the OG card, on a surface CDN-cached for
 * hours inside pages we do not control.
 *
 * Extracted here, pure, because a route handler cannot be unit-tested — this returns the payload the
 * badge HTML is built from, so it is the assertable boundary.
 */
export function badgeVerdict(report: BadgeReportRow | null): { slug: string; grade: string; score: number } | null {
  if (!report || !report.grade) return null;
  if (report.score === null || report.score === '') return null;
  const score = typeof report.score === 'number' ? report.score : Number(report.score);
  if (!Number.isFinite(score)) return null;
  return { slug: report.slug, grade: report.grade, score };
}

// SPEC 04 §7/§9 — the badge for a domain resolves the latest CLAIMED, VISIBLE report: claimed by a
// domain-verified owner, not taken down, not hidden. Claimed-only is the §7 badge-integrity guarantee
// (a third party's fresh unclaimed mint can't silently change a domain's badge). Deploy-order-safe:
// on an undefined-column error (pre-Runbook-B the claimed_at/hidden_at columns are absent) fall back
// to the takedown-only query — behavior-preserving, since every pre-existing report was minted under
// mandatory verification (= claimed) and nothing can be hidden yet. A transient error → null (no
// badge), never a wrong badge.
export async function readLatestVisibleReport(sb: SupabaseClient, domain: string): Promise<BadgeReportRow | null> {
  const base = () => sb.from('public_reports').select('slug, grade, score').eq('domain', domain).is('takedown_requested_at', null);

  const gated = await base().not('claimed_at', 'is', null).is('hidden_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!gated.error) return (gated.data as BadgeReportRow) ?? null;
  if (isUndefinedColumnError(gated.error)) {
    const legacy = await base().order('created_at', { ascending: false }).limit(1).maybeSingle();
    return (legacy.data as BadgeReportRow) ?? null;
  }
  return null;
}
