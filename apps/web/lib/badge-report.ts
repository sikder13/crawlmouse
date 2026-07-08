import type { SupabaseClient } from '@supabase/supabase-js';
import { isUndefinedColumnError } from '@/lib/pg-errors';

export interface BadgeReportRow {
  slug: string;
  grade: string | null;
  score: number | string | null;
}

// SPEC 04 §3/§9 — the latest VISIBLE report for a domain (badge resolution): not taken down and not
// HIDDEN. Deploy-order-safe: prefer the hidden_at exclusion, but fall back to the takedown-only query
// on an undefined-column error (pre-Runbook-B the column is absent — and nothing can be hidden yet, so
// the fallback is exactly correct). A transient error returns null (no badge), never a wrong badge.
// (Stage C reworks this to CLAIMED-only resolution; the hidden exclusion is required now that hide ships.)
export async function readLatestVisibleReport(sb: SupabaseClient, domain: string): Promise<BadgeReportRow | null> {
  const base = () => sb.from('public_reports').select('slug, grade, score').eq('domain', domain).is('takedown_requested_at', null);

  const withHidden = await base().is('hidden_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!withHidden.error) return (withHidden.data as BadgeReportRow) ?? null;
  if (isUndefinedColumnError(withHidden.error)) {
    const legacy = await base().order('created_at', { ascending: false }).limit(1).maybeSingle();
    return (legacy.data as BadgeReportRow) ?? null;
  }
  return null;
}
