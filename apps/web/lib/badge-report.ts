import type { SupabaseClient } from '@supabase/supabase-js';
import { isUndefinedColumnError } from '@/lib/pg-errors';

export interface BadgeReportRow {
  slug: string;
  grade: string | null;
  score: number | string | null;
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
