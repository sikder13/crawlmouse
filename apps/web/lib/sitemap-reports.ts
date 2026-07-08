import type { SupabaseClient } from '@supabase/supabase-js';

export interface SitemapReportEntry {
  slug: string;
  lastModified: string;
}

// SPEC 04 §8 (V13) — the claimed+indexable /r/ sitemap section. Lists ONLY reports that are
// indexable (unclaimed mints default indexable=false → excluded; a claimed report the owner opted out
// of also drops out), non-hidden, and non-taken-down — matching the partial index
// `public_reports_indexable_idx (created_at desc) where indexable and hidden_at is null`.
//
// MUST NEVER THROW: the sitemap route falls back to its static set if this returns []. Any error —
// the pre-Runbook-B undefined-column error (42703) OR a transient one — yields [] (no /r/ section)
// rather than breaking the whole sitemap. Truncation at `limit` is logged, never silent.
export async function fetchIndexableReportSlugs(
  sb: SupabaseClient,
  limit: number,
): Promise<SitemapReportEntry[]> {
  try {
    const { data, error } = await sb
      .from('public_reports')
      .select('slug, created_at')
      .eq('indexable', true)
      .is('hidden_at', null)
      .is('takedown_requested_at', null)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return [];
    const rows = (data as Array<{ slug: string; created_at: string }> | null) ?? [];
    if (rows.length >= limit) {
      console.warn(`[sitemap] /r/ report section hit the ${limit}-row cap; some claimed reports are omitted`);
    }
    return rows.map((r) => ({ slug: r.slug, lastModified: r.created_at }));
  } catch {
    return [];
  }
}
