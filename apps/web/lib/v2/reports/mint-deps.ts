/**
 * `mintV2`'s dependencies over Supabase: `session` is the caller's own client (their auth and RLS),
 * `admin` the service role. The checks a caller's session makes come first in `mintV2`; nothing here
 * reads with `admin` before them.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { captureServerEvent } from '../../analytics-server';
import { checkRateLimit } from '../../rate-limit';
import { newReportSlug } from '../../slug';
import { verifyTurnstileToken } from '../../turnstile';
import { findCheck, siteOf } from '../fixtures';
import { loadCheck, supabaseCheckReader } from '../pipeline/load';
import { buildPublicSnapshot } from './build-snapshot';
import type { MintV2Deps } from './mint';

export function supabaseMintDeps(
  session: SupabaseClient,
  admin: SupabaseClient,
  cookieHeader: string | null,
): MintV2Deps {
  return {
    async user() {
      const { data } = await session.auth.getUser();
      return data.user ? { id: data.user.id } : null;
    },
    async checkAsCaller(checkId) {
      const { data, error } = await session
        .from('checks')
        .select('site_id, status')
        .eq('id', checkId)
        .maybeSingle();
      if (error) throw new Error(`mint: reading check ${checkId}: ${error.message}`);
      return data ? { siteId: data.site_id as string, status: data.status as string } : null;
    },
    async isMemberForSite(siteId) {
      const { data, error } = await session.rpc('is_member_for_site', { p_site: siteId });
      if (error) throw new Error(`is_member_for_site failed: ${error.message}`);
      return data === true;
    },
    checkRateLimit,
    verifyTurnstile: verifyTurnstileToken,
    async slugForCheck(checkId) {
      const { data, error } = await admin
        .from('public_reports')
        .select('slug')
        .eq('check_id', checkId)
        .maybeSingle();
      if (error) throw new Error(`mint: reading the report of check ${checkId}: ${error.message}`);
      return (data?.slug as string | undefined) ?? null;
    },
    async snapshotOf(checkId, mintedAt) {
      const dataset = await loadCheck(supabaseCheckReader(admin), checkId);
      return {
        snapshot: buildPublicSnapshot(dataset, checkId, mintedAt),
        accountId: siteOf(dataset, findCheck(dataset, checkId)).account_id,
      };
    },
    insert: async (row) => admin.from('public_reports').insert(row),
    reportMinted: (accountId) =>
      captureServerEvent(cookieHeader, {
        event: 'report_minted',
        distinctId: `account:${accountId}`,
        properties: { kind: 'v2' },
      }),
    newSlug: newReportSlug,
    now: () => new Date(),
  };
}
