import { unstable_cache, revalidateTag, revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isUndefinedColumnError } from '@/lib/pg-errors';
import { EXTENDED_REPORT_COLS, LEGACY_REPORT_COLS, type PublicReportRow } from './report-row';

export type { PublicReportRow } from './report-row';

// The row type and the column sets live in report-row.ts, which imports no module of the app, so
// the slug sweep (scripts/db/report-slug-sweep.ts) reads a report as this page does.
export { LEGACY_REPORT_COLS, EXTENDED_REPORT_COLS } from './report-row';

// Module-local: the cache tag is only ever read inside this file (takedown.ts purges via
// purgePublicReport, the single source of truth), so it stays off the public surface.
const reportTag = (slug: string) => `public-report:${slug}`;

/**
 * Deploy-order-safe by-slug read (injectable sb for tests). Tries the extended columns; on a Postgres
 * undefined-column error (42703 — Runbook B not yet applied) falls back to the legacy set so every
 * existing report still renders. A transient (non-42703) error returns null (today's on-error
 * behavior), never a silent legacy downgrade.
 */
export async function readReportRow(
  sb: SupabaseClient,
  slug: string,
): Promise<PublicReportRow | null> {
  const ext = await sb
    .from('public_reports')
    .select(EXTENDED_REPORT_COLS)
    .eq('slug', slug)
    .maybeSingle();
  if (!ext.error) return (ext.data as PublicReportRow) ?? null;
  if (isUndefinedColumnError(ext.error)) {
    const leg = await sb
      .from('public_reports')
      .select(LEGACY_REPORT_COLS)
      .eq('slug', slug)
      .maybeSingle();
    return (leg.data as PublicReportRow) ?? null;
  }
  return null;
}

async function readReport(slug: string): Promise<PublicReportRow | null> {
  return readReportRow(supabaseAdmin(), slug);
}

/**
 * Cache the by-slug read and tag it with `public-report:<slug>` so a takedown/hide can purge exactly
 * this report's cached read without waiting out the time-based revalidate. The page and the OG card
 * render from it; a card copy the CDN already holds is not reached (`lib/og-card-cache.ts`).
 */
export function getPublicReport(slug: string): Promise<PublicReportRow | null> {
  return unstable_cache(() => readReport(slug), ['public-report', slug], {
    tags: [reportTag(slug)],
    revalidate: 3600,
  })();
}

/**
 * Purge a single report's cached read and page, so a takedown/hide shows on the page's next request
 * and in each OG card rendered after it. A card copy the CDN already holds lasts at most
 * OG_CARD_EDGE_SECONDS (F-241).
 */
export function purgePublicReport(slug: string): void {
  // Invalidate the shared by-slug data read (getPublicReport's unstable_cache) so any cold
  // re-render reads the now-taken-down/hidden row.
  revalidateTag(reportTag(slug));
  // Purge the report PAGE's full-route cache.
  revalidatePath(`/r/${slug}`);
  // With V2_CHECKS_PUBLIC on, /r/<slug> is rewritten to /v2-report/<slug>, which keeps a route cache
  // of its own under that path (CC-29 Q12).
  revalidatePath(`/v2-report/${slug}`);
  // The OG card, `/r/<slug>/opengraph-image`, keeps no route cache to purge: it renders per request
  // from the tagged read above, so its next render is the placeholder. A copy the CDN already holds
  // is not reached from here and lasts at most OG_CARD_EDGE_SECONDS (lib/og-card-cache.ts, F-241).
}
