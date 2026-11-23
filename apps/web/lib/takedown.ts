import type { SupabaseClient } from '@supabase/supabase-js';
import { purgePublicReport } from './reports';

/** How many of a host's reports one read asks for; the walk continues until a read is empty. */
const SLUGS_PER_READ = 500;

/** Each report slug of a domain, read in pages, because one read is capped (`max_rows`). */
async function slugsOfDomain(sb: SupabaseClient, domain: string): Promise<string[]> {
  const slugs: string[] = [];
  for (;;) {
    const { data, error } = await sb
      .from('public_reports')
      .select('slug')
      .eq('domain', domain)
      .order('slug')
      .range(slugs.length, slugs.length + SLUGS_PER_READ - 1);
    if (error) throw error;
    const page = ((data ?? []) as { slug: string }[]).map((r) => r.slug);
    if (page.length === 0) return slugs;
    slugs.push(...page);
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
 * `stale-while-revalidate=600`), and a report minted after the flip by a mint that had already read
 * `hostTakenDown`.
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

  const slugs = await slugsOfDomain(sb, domain);
  for (const s of slugs) purgePublicReport(s);

  const { error: qErr } = await sb
    .from('takedown_requests')
    .update({ status: 'removed' })
    .eq('domain', domain)
    .in('status', ['pending', 'verified']);
  if (qErr) throw qErr;
  return slugs.length;
}
