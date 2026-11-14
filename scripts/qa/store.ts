import type { SupabaseClient } from '@supabase/supabase-js';
import { scheduleFor } from '../../apps/web/lib/auth/schedule';
import { supabaseDoorStore } from '../../apps/web/lib/auth/stores';
import type { FirstLoginDeps } from '../../apps/web/lib/auth/first-login';
import { TRIAL_OUTCOMES } from '../../apps/web/lib/auth/first-login';
import { effectiveTier, type Tier } from '../../apps/web/lib/entitlement-v2';
import { supabaseSeatsStore } from '../../apps/web/lib/v2/agency/seats-store';
import { startProTrial } from '../../apps/web/lib/v2/account/pro-trial';
import { editSite, supabaseAddSite } from '../../apps/web/lib/v2/account/sites-store';
import { firstAuditRequester } from '../../apps/web/lib/v2/pipeline/first-audit';
import { supabaseKeepStore } from '../../apps/web/lib/v2/pipeline/keep-store';
import type { RequestDeps } from '../../apps/web/lib/v2/pipeline/request';
import { supabasePipelineStore } from '../../apps/web/lib/v2/pipeline/store';
import { DOMAIN_AUDITS_PER_HOUR, GLOBAL_AUDITS_PER_DAY } from '../../apps/web/lib/limits';
import { rateLimitWindowStart } from '../../apps/web/lib/rate-limit-window';
import { snapshotFromRow, type AccountRow } from '../../apps/web/lib/billing/state-machine-apply';
import type { BillingAccounts } from './billing';
import type { ResetStore } from './reset';
import type { AddResult, FirstAuditResult, QaStore, SeatResult, TrialResult } from './seed';

/**
 * The seed's store (./seed.ts `QaStore`) over a service-role Supabase client, through the app's own
 * modules wherever the app has one: `supabaseAddSite` (CC-26b), `supabaseSeatsStore` (CC-31),
 * `start_agency_trial_account` (CC-29), `startProTrial` (CC-26b, the account door's decision),
 * `firstAuditRequester` (CC-22b D7) and `editSite` (CC-26b) for an agency account's first site. The
 * reads it adds are of rows, and the only table it writes itself is `qa_accounts` (D2's marker).
 */

export interface QaStoreDeps {
  /** The pipeline's event send for a site's first audit; Inngest in production. */
  send: RequestDeps['send'];
  /** The engine's SSRF admission of a host (`admitSiteHost`). */
  admit(host: string): Promise<boolean>;
  /** The trial decision's dependencies other than the two stores, which are built here. */
  trial: Omit<FirstLoginDeps, 'store' | 'entitlement'> & Pick<FirstLoginDeps, 'entitlement'>;
  now(): Date;
  /** `isCrawlPaused` (lib/crawl-pause.ts): no first audit is requested while crawls are paused. */
  paused(): boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * The two buckets a kept site's first audit counts against (`startLimits`, app/api/checks/_lib/
 * start-limits.ts), through the same `increment_rate_limit` as lib/rate-limit.ts's `checkRateLimit`,
 * over this client: the day's ceiling fails closed, the domain's hour fails open, as there.
 */
function firstAuditLimits(sb: SupabaseClient) {
  async function count(key: string, limit: number, windowMs: number, failClosed: boolean) {
    const { data, error } = await sb.rpc('increment_rate_limit', {
      p_bucket_key: key,
      p_window_start: rateLimitWindowStart(Date.now(), windowMs).toISOString(),
    });
    if (error) return !failClosed;
    return (data as number) <= limit;
  }
  return {
    global: () => count('global:audits:day', GLOBAL_AUDITS_PER_DAY, DAY_MS, true),
    domain: (domain: string) => count(`domain:${domain}`, DOMAIN_AUDITS_PER_HOUR, HOUR_MS, false),
  };
}

function fail(what: string, error: { message: string }): never {
  throw new Error(`qa:seed: ${what} failed: ${error.message}`);
}

async function ownerSeat(
  sb: SupabaseClient,
  accountId: string,
  userId: string,
): Promise<string | null> {
  const s = await sb
    .from('seats')
    .select('id')
    .eq('account_id', accountId)
    .eq('user_id', userId)
    .eq('role', 'owner')
    .eq('status', 'active')
    .maybeSingle();
  if (s.error) fail('seats read', s.error);
  return (s.data as { id: string } | null)?.id ?? null;
}

interface LimitsRow {
  state: string;
  tier: Tier;
  trial_variant: 'no_card' | 'card_required' | null;
  trial_ends_at: string | null;
  past_due_tier: 'pro' | 'agency' | null;
  past_due_since: string | null;
  site_limit: number;
  timezone: string;
}

async function limitsOf(sb: SupabaseClient, accountId: string, now: Date) {
  const a = await sb
    .from('accounts')
    .select(
      'state, tier, trial_variant, trial_ends_at, past_due_tier, past_due_since, site_limit, timezone',
    )
    .eq('id', accountId)
    .maybeSingle();
  if (a.error) fail('accounts read', a.error);
  const row = a.data as LimitsRow;
  const tier = effectiveTier(
    {
      state: row.state as never,
      tier: row.tier,
      trialVariant: row.trial_variant,
      trialEndsAt: row.trial_ends_at === null ? null : new Date(row.trial_ends_at),
      pastDueTier: row.past_due_tier,
      pastDueSince: row.past_due_since === null ? null : new Date(row.past_due_since),
    },
    now,
  );
  return { tier, siteLimit: row.site_limit, timezone: row.timezone };
}

export function qaStore(sb: SupabaseClient, deps: QaStoreDeps): QaStore {
  const seats = supabaseSeatsStore(sb);
  // A send that throws after add_site's insert would leave the site added and the seed stopped; it
  // is caught here and reported with the site instead, as the queued check is the reaper's to fail.
  let unsent: string | undefined;
  const addSite = supabaseAddSite(sb, async (event) => {
    try {
      return await deps.send(event);
    } catch (e) {
      unsent = e instanceof Error ? e.message : String(e);
      return undefined;
    }
  });
  const door = supabaseDoorStore(sb);
  const keep = supabaseKeepStore(sb);
  // The door's first audit (lib/auth/door-deps.ts), over this client, with the same send as addSite.
  const requestFirstAudit = firstAuditRequester({
    request: {
      store: supabasePipelineStore(sb),
      send: async (event) => {
        try {
          return await deps.send(event);
        } catch (e) {
          unsent = e instanceof Error ? e.message : String(e);
          return undefined;
        }
      },
      now: () => deps.now().getTime(),
    },
    hasLiveOrGradedCheck: (siteId) => keep.hasLiveOrGradedCheck(siteId),
    limits: firstAuditLimits(sb),
    paused: () => deps.paused(),
  });

  async function hosts(accountId: string): Promise<string[]> {
    const r = await sb
      .from('sites')
      .select('host')
      .eq('account_id', accountId)
      .is('removed_at', null)
      .is('staging_of_site_id', null);
    if (r.error) fail('sites read', r.error);
    return ((r.data ?? []) as { host: string }[]).map((x) => x.host);
  }

  return {
    async personal(userId) {
      const member = await door.loadMember(userId);
      return member === null
        ? null
        : { accountId: member.accountId, ownerSeatId: member.ownerSeatId };
    },

    async agency(userId, name) {
      const owned = await sb
        .from('seats')
        .select('id, account_id')
        .eq('user_id', userId)
        .eq('role', 'owner')
        .eq('status', 'active');
      if (owned.error) fail('seats read', owned.error);
      const seatOf = new Map(
        ((owned.data ?? []) as { id: string; account_id: string }[]).map((x) => [
          x.account_id,
          x.id,
        ]),
      );
      if (seatOf.size === 0) return null;
      const a = await sb
        .from('accounts')
        .select('id')
        .in('id', [...seatOf.keys()])
        .eq('kind', 'agency')
        .eq('name', name)
        .is('deleted_at', null);
      if (a.error) fail('accounts read', a.error);
      const hit = (a.data ?? []) as { id: string }[];
      if (hit.length > 1) throw new Error(`qa:seed: ${hit.length} agency accounts named ${name}`);
      return hit[0] ? { accountId: hit[0].id, ownerSeatId: seatOf.get(hit[0].id)! } : null;
    },

    async startAgency(userId, name, firstHost) {
      const { data, error } = await sb.rpc('start_agency_trial_account', {
        p_user: userId,
        p_name: name,
        p_host: firstHost,
      });
      if (error) fail('start_agency_trial_account', error);
      const r = data as { outcome: string; account_id?: string };
      if (!r.account_id)
        throw new Error(`qa:seed: start_agency_trial_account answered ${r.outcome}`);
      const seat = await ownerSeat(sb, r.account_id, userId);
      if (seat === null) throw new Error('qa:seed: the agency account has no owner seat');
      return { accountId: r.account_id, ownerSeatId: seat };
    },

    async marker(accountId) {
      const r = await sb
        .from('qa_accounts')
        .select('qa_key')
        .eq('account_id', accountId)
        .maybeSingle();
      if (r.error) fail('qa_accounts read', r.error);
      return (r.data as { qa_key: string } | null)?.qa_key ?? null;
    },

    async addMarker(accountId, key) {
      const r = await sb.from('qa_accounts').insert({ account_id: accountId, qa_key: key });
      if (r.error) fail('qa_accounts insert', r.error);
    },

    async isInternal(accountId) {
      const r = await sb.from('accounts').select('internal').eq('id', accountId).maybeSingle();
      if (r.error) fail('accounts read', r.error);
      return (r.data as { internal: boolean } | null)?.internal === true;
    },

    hosts,

    async addSite(seat, host, userId): Promise<AddResult> {
      // As POST /api/sites answers 503 while crawls are paused: adding a site requests its first audit.
      if (deps.paused()) return { outcome: 'paused' };
      if (!(await deps.admit(host)))
        throw new Error(`qa:seed: ${host} is refused by the SSRF guard`);
      const now = deps.now();
      const { tier, siteLimit, timezone } = await limitsOf(sb, seat.accountId, now);
      const first = (await hosts(seat.accountId)).length === 0;
      unsent = undefined;
      // As POST /api/sites calls it (app/api/sites/route.ts).
      const r = await addSite({
        accountId: seat.accountId,
        ownerSeatId: seat.ownerSeatId,
        host,
        schedule: scheduleFor(tier, first, now, timezone),
        limit: siteLimit,
        perDomain: tier === 'free',
        requestedByUserId: userId,
      });
      switch (r.outcome) {
        case 'created':
          return unsent === undefined ? { outcome: 'created' } : { outcome: 'created', unsent };
        case 'adds_capped':
        case 'domain_capped':
          return { outcome: r.outcome, nextAllowedAt: r.nextAllowedAt };
        default:
          return { outcome: r.outcome };
      }
    },

    async firstAudit(seat, host, userId): Promise<FirstAuditResult> {
      const s = await sb
        .from('sites')
        .select('id, schedule_cadence')
        .eq('account_id', seat.accountId)
        .eq('host', host)
        .is('removed_at', null)
        .is('staging_of_site_id', null)
        .maybeSingle();
      if (s.error) fail('sites read', s.error);
      const site = s.data as { id: string; schedule_cadence: string | null } | null;
      if (site === null) return { outcome: 'no_site' };
      // Any check at all, read here as rows: the requester's own read counts with `head`, and a run
      // that finds one must send nothing, so this one is the seed's.
      const c = await sb.from('checks').select('id').eq('site_id', site.id).limit(1);
      if (c.error) fail('checks read', c.error);
      if ((c.data ?? []).length > 0) return { outcome: 'has_check' };
      unsent = undefined;
      const answer = await requestFirstAudit({ siteId: site.id, host, userId });
      if (answer !== 'requested') return { outcome: answer };
      // add_site stores a first site's schedule with it; start_agency_trial_account stores none.
      if (site.schedule_cadence === null) {
        const now = deps.now();
        const { tier, timezone } = await limitsOf(sb, seat.accountId, now);
        const schedule = scheduleFor(tier, true, now, timezone);
        if (schedule !== null) await editSite(sb, site.id, { schedule });
      }
      return unsent === undefined ? { outcome: 'requested' } : { outcome: 'requested', unsent };
    },

    async developerSeat(seat, email, userId): Promise<SeatResult> {
      const a = await sb
        .from('accounts')
        .select('seat_limit')
        .eq('id', seat.accountId)
        .maybeSingle();
      if (a.error) fail('accounts read', a.error);
      const cap = (a.data as { seat_limit: number }).seat_limit;
      const first = await sb
        .from('sites')
        .select('id')
        .eq('account_id', seat.accountId)
        .is('removed_at', null)
        .is('staging_of_site_id', null)
        .order('created_at', { ascending: true })
        .limit(1);
      if (first.error) fail('sites read', first.error);
      const client = ((first.data ?? []) as { id: string }[])[0];
      if (!client) return 'refused';
      const now = deps.now();
      const invited = await seats.invite({
        accountId: seat.accountId,
        email,
        role: 'developer',
        siteIds: [client.id],
        cap,
        now,
      });
      if (invited.outcome === 'full') return 'full';
      if (invited.outcome !== 'invited') return 'refused';
      // The link the invitation mail carries (`issue_seat_invite`), opened by the developer.
      const issued = await sb.rpc('issue_seat_invite', {
        p_seat: invited.seatId,
        p_seq: invited.seq,
        p_now: now.toISOString(),
      });
      if (issued.error) fail('issue_seat_invite', issued.error);
      const token = ((issued.data ?? []) as { token: string }[])[0]?.token;
      if (!token) return 'refused';
      const accepted = await seats.accept(token, userId, now);
      return accepted.outcome === 'accepted' || accepted.outcome === 'already_member'
        ? accepted.outcome
        : 'refused';
    },

    async memberRole(accountId, userId) {
      const r = await sb
        .from('seats')
        .select('role')
        .eq('account_id', accountId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle();
      if (r.error) fail('seats read', r.error);
      return (r.data as { role: string } | null)?.role ?? null;
    },

    async proTrial(seat, userId, email): Promise<TrialResult> {
      const member = await door.loadMember(userId);
      if (member === null || member.accountId !== seat.accountId) {
        return { outcome: 'refused', reason: 'the trial is for the personal account only' };
      }
      // No device and no IP: the seed is not a browser, so the ledger records the email alone.
      const answer = await startProTrial({ ...deps.trial, store: door }, member, {
        accountId: seat.accountId,
        userId,
        email,
        device: null,
        ip: '',
      });
      if (answer.outcome === 'started') return { outcome: 'started' };
      if (answer.outcome === 'not_eligible') return { outcome: 'not_eligible' };
      return { outcome: 'refused', reason: `${answer.outcome}: ${TRIAL_OUTCOMES[answer.outcome]}` };
    },
  };
}

/** `--billing`'s read of an account: its entitlement as the checkout route reads it, and its customer. */
export function qaBillingAccounts(sb: SupabaseClient): BillingAccounts {
  return {
    async read(accountId) {
      const r = await sb.from('accounts').select('*').eq('id', accountId).maybeSingle();
      if (r.error) fail('accounts read', r.error);
      if (!r.data) return null;
      const row = r.data as AccountRow & { stripe_customer_id: string | null };
      return { snapshot: snapshotFromRow(row).snapshot, stripeCustomerId: row.stripe_customer_id };
    },
  };
}

/** qa:reset's port: D2's table, and its guarded function (migration 20261117000002). */
export function qaResetStore(sb: SupabaseClient): ResetStore {
  return {
    async marked() {
      const r = await sb
        .from('qa_accounts')
        .select('account_id, qa_key')
        .order('created_at', { ascending: true })
        .order('account_id', { ascending: true });
      if (r.error) fail('qa_accounts read', r.error);
      return ((r.data ?? []) as { account_id: string; qa_key: string }[]).map((x) => ({
        accountId: x.account_id,
        key: x.qa_key,
      }));
    },
    async reset(accountId) {
      const { data, error } = await sb.rpc('qa_reset', { p_account: accountId });
      if (error) {
        // 42501: the function's own refusal (no qa_accounts row, or the account is not internal).
        if (error.code === '42501') return { refused: error.message };
        fail('qa_reset', error);
      }
      const n = data as { sites: number; seats: number };
      return { sites: n.sites, seats: n.seats };
    },
  };
}
