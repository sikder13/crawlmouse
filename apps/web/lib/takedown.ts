import type { SupabaseClient } from '@supabase/supabase-js';
import { purgePublicReport } from './reports';

/**
 * Action a takedown. A takedown is about a host, so it covers each public report of the slug's
 * domain (`normalizeDomain`'s key, as `hostTakenDown` reads it), not the one report it was filed on.
 *
 * In order: flip `takedown_requested_at` on the host's reports that do not have it (the switch the
 * OG image and report page read), so an earlier takedown keeps its time; mark the OPEN queue rows
 * for those reports removed; then purge each report's cached render, so the placeholder is served
 * at once instead of up to an hour later. Each write is error-checked: the flip must succeed before
 * anything else runs, and a failed queue write is surfaced so the ops queue cannot silently desync.
 * Re-running is safe, because the flip already took effect.
 *
 * The queue update is scoped to open statuses ('pending'|'verified') so it never rewrites a decided
 * 'rejected' or 'removed' row, which keeps the moderation history.
 *
 * The embed badge is cached at the CDN (`s-maxage=300`, `stale-while-revalidate=600`), which a purge
 * here does not reach.
 */
export async function processTakedown(sb: SupabaseClient, slug: string): Promise<void> {
  const now = new Date().toISOString();
  const { data: named, error: readErr } = await sb
    .from('public_reports')
    .select('domain')
    .eq('slug', slug)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!named) return;
  const domain = (named as { domain: string }).domain;

  const { error: rErr } = await sb
    .from('public_reports')
    .update({ takedown_requested_at: now })
    .eq('domain', domain)
    .is('takedown_requested_at', null);
  if (rErr) throw rErr;

  const { data: rows, error: listErr } = await sb
    .from('public_reports')
    .select('slug')
    .eq('domain', domain);
  if (listErr) throw listErr;
  const slugs = ((rows ?? []) as { slug: string }[]).map((r) => r.slug);

  const { error: qErr } = await sb
    .from('takedown_requests')
    .update({ status: 'removed' })
    .in('public_report_slug', slugs)
    .in('status', ['pending', 'verified']);
  if (qErr) throw qErr;
  for (const s of slugs) purgePublicReport(s);
}
