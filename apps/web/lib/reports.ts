import { unstable_cache, revalidateTag, revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase/admin';

export interface PublicReportRow {
  domain: string;
  grade: string | null;
  score: number | string | null;
  cms_detected: string | null;
  orphan_count: number | null;
  avg_depth: number | string | null;
  takedown_requested_at: string | null;
  created_at: string;
}

// Module-local: the cache tag is only ever read inside this file (takedown.ts purges via
// purgePublicReport, the single source of truth), so it stays off the public surface.
const reportTag = (slug: string) => `public-report:${slug}`;

async function readReport(slug: string): Promise<PublicReportRow | null> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from('public_reports')
    .select('domain, grade, score, cms_detected, orphan_count, avg_depth, takedown_requested_at, created_at')
    .eq('slug', slug)
    .maybeSingle();
  return (data as PublicReportRow) ?? null;
}

/**
 * Cache the by-slug read and tag it with `public-report:<slug>` so a takedown can purge exactly
 * this report's cached render (OG card + page) without waiting out the time-based revalidate.
 */
export function getPublicReport(slug: string): Promise<PublicReportRow | null> {
  return unstable_cache(() => readReport(slug), ['public-report', slug], {
    tags: [reportTag(slug)],
    revalidate: 3600,
  })();
}

/** Purge a single report's cached OG image + page so a takedown takes effect on the next request. */
export function purgePublicReport(slug: string): void {
  // Invalidate the shared by-slug data read (getPublicReport's unstable_cache) so any cold
  // re-render reads the now-taken-down row.
  revalidateTag(reportTag(slug));
  // Purge the report PAGE's full-route cache.
  revalidatePath(`/r/${slug}`);
  // The OG card lives at the SEPARATE `/r/<slug>/opengraph-image` route segment, which has its
  // own `revalidate = 3600` full-route cache. revalidatePath('/r/<slug>') does NOT cascade into
  // that child segment, and the tag purge only clears the data layer — the already-rendered PNG
  // would keep serving for up to an hour. Purge the OG segment explicitly so the viral-unfurl
  // card flips to the placeholder immediately (the privacy-sensitive surface this exists for).
  revalidatePath(`/r/${slug}/opengraph-image`);
}
