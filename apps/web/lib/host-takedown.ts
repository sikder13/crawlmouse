import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Whether any public report of this domain was taken down. A takedown is about a host, so it counts
 * whichever row holds it: a v1 report, another account's, one of a site since removed. `domain` is
 * `normalizeDomain`'s, which is how `public_reports.domain` is written, so a `www.` sibling matches.
 * Reads with the service role. A failed read throws, so a mint cannot go through on it.
 */
export async function hostTakenDown(admin: SupabaseClient, domain: string): Promise<boolean> {
  const { data, error } = await admin
    .from('public_reports')
    .select('slug')
    .eq('domain', domain)
    .not('takedown_requested_at', 'is', null)
    .limit(1);
  if (error) throw new Error('public_reports takedown read failed');
  return (data ?? []).length > 0;
}
