import { unstable_cache, revalidateTag, revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PublicReportSnapshot, WhiteLabelConfig } from '@crawlmouse/types';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isUndefinedColumnError } from '@/lib/pg-errors';

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
export const LEGACY_REPORT_COLS = 'domain, grade, score, cms_detected, orphan_count, avg_depth, takedown_requested_at, created_at';
export const EXTENDED_REPORT_COLS = `${LEGACY_REPORT_COLS}, report_snapshot, claimed_at, listed, indexable, hidden_at, white_label`;

// Module-local: the cache tag is only ever read inside this file (takedown.ts purges via
// purgePublicReport, the single source of truth), so it stays off the public surface.
const reportTag = (slug: string) => `public-report:${slug}`;

/**
 * Deploy-order-safe by-slug read (injectable sb for tests). Tries the extended columns; on a Postgres
 * undefined-column error (42703 — Runbook B not yet applied) falls back to the legacy set so every
 * existing report still renders. A transient (non-42703) error returns null (today's on-error
 * behavior), never a silent legacy downgrade.
 */
export async function readReportRow(sb: SupabaseClient, slug: string): Promise<PublicReportRow | null> {
  const ext = await sb.from('public_reports').select(EXTENDED_REPORT_COLS).eq('slug', slug).maybeSingle();
  if (!ext.error) return (ext.data as PublicReportRow) ?? null;
  if (isUndefinedColumnError(ext.error)) {
    const leg = await sb.from('public_reports').select(LEGACY_REPORT_COLS).eq('slug', slug).maybeSingle();
    return (leg.data as PublicReportRow) ?? null;
  }
  return null;
}

async function readReport(slug: string): Promise<PublicReportRow | null> {
  return readReportRow(supabaseAdmin(), slug);
}

/**
 * Cache the by-slug read and tag it with `public-report:<slug>` so a takedown/hide can purge exactly
 * this report's cached render (OG card + page) without waiting out the time-based revalidate.
 */
export function getPublicReport(slug: string): Promise<PublicReportRow | null> {
  return unstable_cache(() => readReport(slug), ['public-report', slug], {
    tags: [reportTag(slug)],
    revalidate: 3600,
  })();
}

/** Purge a single report's cached OG image + page so a takedown/hide takes effect on the next request. */
export function purgePublicReport(slug: string): void {
  // Invalidate the shared by-slug data read (getPublicReport's unstable_cache) so any cold
  // re-render reads the now-taken-down/hidden row.
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
