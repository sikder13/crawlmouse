/**
 * The door's stores for the routes: the service-role supabase-js client (`sb` must be
 * `supabaseAdmin()`), and Sentry as the reporter.
 * PostgREST reports a Postgres error's SQLSTATE as `error.code`; 23505 (unique violation) is read
 * here as "already there".
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CheckForClaim, DoorStore, MemberAccount, NewSite, Report } from './door-store';
import type { SiteSchedule } from './schedule';
import { parseTrialDecision } from './trial-decision';

type PgError = { code?: string; message: string } | null;

function fail(what: string, error: NonNullable<PgError>): never {
  throw Object.assign(new Error(`${what} failed: ${error.message}`), { code: error.code });
}

const date = (v: string | null): Date | null => (v === null ? null : new Date(v));

const scheduleColumns = (s: SiteSchedule | null) => ({
  schedule_cadence: s?.cadence ?? null,
  schedule_iso_weekday: s?.iso_weekday ?? null,
  schedule_hour_local: s?.hour_local ?? null,
});

export function supabaseDoorStore(sb: SupabaseClient): DoorStore {
  return {
    async loadMember(userId) {
      const u = await sb.from('users').select('default_account_id').eq('id', userId).maybeSingle();
      if (u.error) fail('users read', u.error);
      const accountId = (u.data as { default_account_id: string | null } | null)
        ?.default_account_id;
      if (!accountId) return null;
      const a = await sb
        .from('accounts')
        .select(
          'id, state, tier, trial_variant, trial_ends_at, trial_used_at, past_due_tier, past_due_since, site_limit, timezone',
        )
        .eq('id', accountId)
        .is('deleted_at', null)
        // An account marked for deletion (CC-27b) starts no trial and claims no site in its window.
        .is('deletion_confirmed_at', null)
        .maybeSingle();
      if (a.error) fail('accounts read', a.error);
      if (!a.data) return null;
      const s = await sb
        .from('seats')
        .select('id')
        .eq('account_id', accountId)
        .eq('user_id', userId)
        .eq('role', 'owner')
        .eq('status', 'active')
        .maybeSingle();
      if (s.error) fail('seats read', s.error);
      if (!s.data) return null;
      const r = a.data as Record<string, unknown>;
      return {
        accountId,
        ownerSeatId: (s.data as { id: string }).id,
        state: r.state,
        tier: r.tier,
        trialVariant: r.trial_variant,
        trialEndsAt: date(r.trial_ends_at as string | null),
        trialUsedAt: date(r.trial_used_at as string | null),
        pastDueTier: r.past_due_tier,
        pastDueSince: date(r.past_due_since as string | null),
        siteLimit: r.site_limit,
        timezone: r.timezone,
      } as MemberAccount;
    },

    async setTimezone(accountId, zone) {
      const { error } = await sb
        .from('accounts')
        .update({ timezone: zone, updated_at: new Date().toISOString() })
        .eq('id', accountId);
      if (error) fail('accounts timezone write', error);
    },

    async startTrial(accountId, hashes, transition) {
      const { data, error } = await sb.rpc('start_trial_with_ledger', {
        p_account_id: accountId,
        p_hashes: hashes,
        p_transition: transition,
      });
      if (error) fail('start_trial_with_ledger', error);
      return parseTrialDecision(data);
    },

    async countActiveSites(accountId) {
      const { count, error } = await sb
        .from('sites')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .is('removed_at', null)
        .is('staging_of_site_id', null);
      if (error) fail('sites count', error);
      return count ?? 0;
    },

    async insertSite(site: NewSite) {
      const { data, error } = await sb
        .from('sites')
        .insert({
          account_id: site.accountId,
          host: site.host,
          owner_seat_id: site.ownerSeatId,
          ...scheduleColumns(site.schedule),
        })
        .select('id')
        .single();
      if (error?.code === '23505') return 'exists';
      if (error) fail('sites insert', error);
      return { siteId: (data as { id: string }).id };
    },

    async loadCheck(checkId): Promise<CheckForClaim | null> {
      const c = await sb
        .from('checks')
        .select('id, site_id, expires_at')
        .eq('id', checkId)
        .maybeSingle();
      if (c.error) fail('checks read', c.error);
      if (!c.data) return null;
      const check = c.data as { id: string; site_id: string; expires_at: string | null };
      const s = await sb
        .from('sites')
        .select('account_id, host')
        .eq('id', check.site_id)
        .is('removed_at', null)
        .maybeSingle();
      if (s.error) fail('sites read', s.error);
      if (!s.data) return null;
      const site = s.data as { account_id: string | null; host: string };
      return {
        checkId: check.id,
        siteId: check.site_id,
        siteAccountId: site.account_id,
        host: site.host,
        expiresAt: date(check.expires_at),
      };
    },

    async takeSite(siteId, site) {
      const { data, error } = await sb
        .from('sites')
        .update({
          account_id: site.accountId,
          owner_seat_id: site.ownerSeatId,
          ...scheduleColumns(site.schedule),
          updated_at: new Date().toISOString(),
        })
        .eq('id', siteId)
        .is('account_id', null)
        .select('id');
      if (error?.code === '23505') return 'host_kept';
      if (error) fail('sites claim', error);
      return (data ?? []).length === 1 ? 'taken' : 'not_unowned';
    },

    async clearExpiry(checkId) {
      const { error } = await sb.from('checks').update({ expires_at: null }).eq('id', checkId);
      if (error) fail('checks expiry write', error);
    },
  };
}

/** A Sentry warning named by `signal`, tagged so an alert rule can match it. */
export function sentryReport(
  capture: (
    message: string,
    ctx: { level: 'warning'; tags: Record<string, string>; extra: Record<string, string> },
  ) => unknown,
): Report {
  return (signal, extra) => {
    capture(`auth.${signal}`, { level: 'warning', tags: { signal }, extra });
  };
}
