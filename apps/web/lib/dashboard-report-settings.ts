import type { SupabaseClient } from '@supabase/supabase-js';
import type { WhiteLabelConfig } from '@crawlmouse/types';
import { normalizeDomain } from './domain';

// SPEC 04.1 §3 (dashboard) — the owner's per-site report settings, keyed by site URL. apps/web-local
// (packages/types untouched). Ownership is re-derived from domain_verifications (there is no claimed_by),
// and only CLAIMED, non-hidden reports for a VERIFIED domain surface. `minted_by` is never selected.
export interface SiteReportSettings {
  slug: string;
  claimed: boolean;
  listed: boolean;
  indexable: boolean;
  whiteLabel: WhiteLabelConfig | null;
  canWhiteLabel: boolean;
}

interface ReportRow {
  slug: string;
  domain: string;
  listed: boolean | null;
  indexable: boolean | null;
  white_label: WhiteLabelConfig | null;
}

/**
 * Map each of the owner's sites to its claimed report's settings. Reads via the admin client, scoped to
 * the user's own verified domains. FAIL-SOFT: any error (incl. a deploy-order/undefined-column state)
 * yields an empty map so the dashboard never breaks — the settings are supplementary.
 */
export async function loadReportSettingsForSites(
  admin: SupabaseClient,
  userId: string,
  siteUrls: string[],
  isPro: boolean,
): Promise<Map<string, SiteReportSettings>> {
  const out = new Map<string, SiteReportSettings>();
  if (siteUrls.length === 0) return out;

  try {
    const { data: verifs, error: vErr } = await admin
      .from('domain_verifications')
      .select('domain')
      .eq('user_id', userId)
      .not('verified_at', 'is', null);
    if (vErr) return out;
    const verifiedDomains = new Set(
      (verifs ?? []).map((v) => normalizeDomain((v as { domain: string }).domain)),
    );
    if (verifiedDomains.size === 0) return out;

    const { data: reports, error: rErr } = await admin
      .from('public_reports')
      .select('slug, domain, listed, indexable, white_label')
      .in('domain', [...verifiedDomains])
      .not('claimed_at', 'is', null)
      .is('hidden_at', null);
    if (rErr) return out;

    const byDomain = new Map<string, ReportRow>();
    for (const r of (reports ?? []) as ReportRow[]) byDomain.set(normalizeDomain(r.domain), r);

    for (const url of siteUrls) {
      let d: string;
      try {
        d = normalizeDomain(url);
      } catch {
        continue; // skip an unparseable site URL
      }
      const rep = byDomain.get(d);
      if (rep) {
        out.set(url, {
          slug: rep.slug,
          claimed: true,
          listed: rep.listed === true,
          indexable: rep.indexable === true,
          whiteLabel: rep.white_label ?? null,
          canWhiteLabel: isPro,
        });
      }
    }
    return out;
  } catch {
    return out;
  }
}
