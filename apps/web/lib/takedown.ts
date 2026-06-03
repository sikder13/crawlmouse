import type { SupabaseClient } from '@supabase/supabase-js';
import { purgePublicReport } from './reports';

/**
 * Action a takedown for a public report: flip `takedown_requested_at` (the switch the OG image
 * and report page read) FIRST — that is the user-visible safety write — then mark the OPEN queue
 * rows removed, then purge this report's cached render (via the single-source-of-truth
 * `purgePublicReport`) so the taken-down placeholder is served immediately instead of up to an
 * hour later. Both writes are error-checked: the report flip must succeed before anything else
 * runs, and a failed queue-status write is surfaced (not swallowed) so the ops queue can't
 * silently desync from the actioned report — re-running is idempotent because the flip already
 * took effect.
 *
 * The queue update intentionally resolves EVERY still-open request for the slug (spam can append
 * many rows per report) but is scoped to open statuses ('pending'|'verified') so it never rewrites
 * an already-decided 'rejected' (or 'removed') row — preserving the moderation history and keeping
 * a re-run a true no-op on already-actioned rows.
 */
export async function processTakedown(sb: SupabaseClient, slug: string): Promise<void> {
  const now = new Date().toISOString();
  const { error: rErr } = await sb.from('public_reports').update({ takedown_requested_at: now }).eq('slug', slug);
  if (rErr) throw rErr;
  const { error: qErr } = await sb
    .from('takedown_requests')
    .update({ status: 'removed' })
    .eq('public_report_slug', slug)
    .in('status', ['pending', 'verified']);
  if (qErr) throw qErr;
  purgePublicReport(slug);
}
