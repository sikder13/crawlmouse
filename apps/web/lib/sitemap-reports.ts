import type { SupabaseClient } from '@supabase/supabase-js';
import { checksPublicEnabled } from './auth/flags';

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
    let query = sb
      .from('public_reports')
      .select('slug, created_at')
      .eq('indexable', true)
      // claimed_at is explicit (not just implied by indexable=true) so a future write path can never
      // silently advertise an unclaimed page — the "unclaimed → unlisted" guardrail lives in the query.
      .not('claimed_at', 'is', null)
      .is('hidden_at', null)
      .is('takedown_requested_at', null);
    // A v2 report (CC-29) is a 404 while V2_CHECKS_PUBLIC is off (`isReportGoneEitherKind`), so it is
    // listed only while the flag is on. It is told apart by its grade, which a v2 row never has (the
    // insert trigger copies it from `audits`); a v1 row without one is a 404 on v1's page as well.
    // `filter` rather than `.not(…)`, whose column-typed overload is too deep for tsc on this chain.
    if (!checksPublicEnabled()) query = query.filter('grade', 'not.is', null);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
    if (error) return [];
    const rows = (data as Array<{ slug: string; created_at: string }> | null) ?? [];
    if (rows.length >= limit) {
      console.warn(
        `[sitemap] /r/ report section hit the ${limit}-row cap; some claimed reports are omitted`,
      );
    }
    return rows.map((r) => ({ slug: r.slug, lastModified: r.created_at }));
  } catch {
    return [];
  }
}
