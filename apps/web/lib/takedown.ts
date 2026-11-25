import type { SupabaseClient } from '@supabase/supabase-js';
import { purgePublicReport } from './reports';

/** How many of a host's reports one read asks for. */
const SLUGS_PER_READ = 500;

/**
 * Purges each report of a domain and answers how many. It reads by key, from the last slug seen,
 * because one read is capped (`max_rows`) and an offset would skip a row removed during the walk.
 */
async function purgeHost(sb: SupabaseClient, domain: string): Promise<number> {
  let purged = 0;
  let last: string | null = null;
  for (;;) {
    const base = sb.from('public_reports').select('slug').eq('domain', domain);
    const { data, error } = await (last === null ? base : base.gte('slug', last))
      .order('slug')
      .limit(SLUGS_PER_READ);
    if (error) throw error;
    const fresh: string[] = ((data ?? []) as { slug: string }[])
      .map((r) => r.slug)
      .filter((s) => s !== last);
    if (fresh.length === 0) return purged;
    for (const s of fresh) purgePublicReport(s);
    purged += fresh.length;
    last = fresh[fresh.length - 1]!;
  }
}

/**
 * Action a takedown, and answer how many reports the host has. A takedown is about a host, so it
 * covers the public reports of the slug's domain (`normalizeDomain`'s key, as `hostTakenDown` reads
 * it), not only the report it was filed on. A slug that names no report changes nothing.
 *
 * In order: flip `takedown_requested_at` on the host's reports that do not have it (the switch the
 * OG image and report page read), so an earlier takedown keeps its time; purge each report's cached
 * render; then mark the host's OPEN requests removed. The purge comes before the queue write so a
 * failed queue write cannot leave a report's page cached. Either failure throws, and re-running is
 * safe. The queue write is scoped to 'pending' and 'verified', so a decided request keeps its status.
 *
 * What this does not reach: the embed badge's CDN cache (`s-maxage=300`,
 * `stale-while-revalidate=600`), each OG card's CDN copy (`s-maxage=300`, `lib/og-card-cache.ts`),
 * and a report minted after the flip by a mint that had already read `hostTakenDown`.
 */
export async function processTakedown(sb: SupabaseClient, slug: string): Promise<number> {
  const now = new Date().toISOString();
  const { data: named, error: readErr } = await sb
    .from('public_reports')
    .select('domain')
    .eq('slug', slug)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!named) return 0;
  const domain = (named as { domain: string }).domain;

  const { error: rErr } = await sb
    .from('public_reports')
    .update({ takedown_requested_at: now })
    .eq('domain', domain)
    .is('takedown_requested_at', null);
  if (rErr) throw rErr;

  const reports = await purgeHost(sb, domain);

  const { error: qErr } = await sb
    .from('takedown_requests')
    .update({ status: 'removed' })
    .eq('domain', domain)
    .in('status', ['pending', 'verified']);
  if (qErr) throw qErr;
  return reports;
}
