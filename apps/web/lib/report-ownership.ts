import type { SupabaseClient } from '@supabase/supabase-js';

// SPEC 04 §8/§9 — the ownership check for report-mutating routes (claim, visibility, Stage-D
// white-label). There is no claimed_by column on public_reports (§11 keeps user ids off the report),
// so ownership is re-derived from domain_verifications on every write: a user owns a report's domain
// iff they hold a verified row for it. "Verified" is a non-null verified_at (there is no boolean
// column — see 20260524000006_sharing.sql). Domains on both sides are normalizeDomain() outputs, so a
// direct equality match is sound. Uses the injected (service-role) client so callers control auth.
export async function isDomainVerifiedForUser(
  sb: SupabaseClient,
  userId: string,
  domain: string,
): Promise<boolean> {
  const { data } = await sb
    .from('domain_verifications')
    .select('id')
    .eq('user_id', userId)
    .eq('domain', domain)
    .not('verified_at', 'is', null)
    .maybeSingle();
  return !!data;
}
