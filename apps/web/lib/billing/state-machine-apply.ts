/**
 * Applies one entitlement event to an account: read it, run `next()`, and write the result through
 * the `apply_entitlement_transition` RPC (migration 001), which does it in one transaction and
 * refuses the write when the account changed since it was read.
 *
 * Not imported by any live route. CC-03's webhook handler is its first caller.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountState } from '@crawlmouse/types/v2';
import { GATES, type Extras, type PaidTier, type Tier } from '../entitlement-v2';
import {
  next,
  type EntitlementEvent,
  type EntitlementSnapshot,
  type Transition,
  type TrialVariant,
} from './state-machine';
import type { SiteEffect } from './state-machine-sites';

/** The `accounts` columns this module reads. Timestamps arrive as strings from PostgREST. */
export interface AccountRow {
  state: AccountState;
  tier: Tier;
  trial_variant: TrialVariant | null;
  trial_ends_at: string | Date | null;
  trial_used_at: string | Date | null;
  past_due_tier: PaidTier | null;
  past_due_since: string | Date | null;
  disputed_at: string | Date | null;
  seat_limit: number;
  site_limit: number;
  competitor_limit: number;
  entitlement_version: number;
  state_history: { state: AccountState; since: string }[];
}

const ACCOUNT_COLUMNS =
  'state, tier, trial_variant, trial_ends_at, trial_used_at, past_due_tier, past_due_since, disputed_at, ' +
  'seat_limit, site_limit, competitor_limit, entitlement_version, state_history';

/** The RPC's named arguments. */
export interface TransitionParams {
  p_account_id: string;
  p_expected_version: number;
  p_state: AccountState;
  p_tier: Tier;
  p_past_due_tier: PaidTier | null;
  p_past_due_since: string | null;
  p_trial_variant: TrialVariant | null;
  p_trial_ends_at: string | null;
  p_trial_used_at: string | null;
  p_disputed_at: string | null;
  p_seat_limit: number;
  p_site_limit: number;
  p_competitor_limit: number;
  p_at: string;
}

export interface StoredSnapshot {
  version: number;
  snapshot: EntitlementSnapshot;
}

export interface EntitlementStore {
  load(accountId: string): Promise<StoredSnapshot | null>;
  /** Returns the new version; throws EntitlementConflictError when the expected version is stale. */
  commit(params: TransitionParams): Promise<number>;
}

export class EntitlementConflictError extends Error {
  constructor(accountId: string) {
    super(`entitlement of account ${accountId} changed since it was read`);
    this.name = 'EntitlementConflictError';
  }
}

const date = (v: string | Date | null): Date | null => (v === null ? null : new Date(v));
const iso = (v: Date | null): string | null => (v === null ? null : v.toISOString());

/**
 * The machine's snapshot of an account row. Agency extras are what the written limits hold beyond
 * the plan's own; a row whose limits match no plan and extras throws rather than being read as one.
 */
export function snapshotFromRow(row: AccountRow): StoredSnapshot {
  const gates = GATES[row.tier];
  const extras: Extras = {
    seats: row.seat_limit - gates.seats,
    sites: row.site_limit - gates.sites,
  };
  const consistent =
    row.competitor_limit === gates.competitorsPerSite &&
    extras.seats >= 0 &&
    extras.sites >= 0 &&
    (row.tier === 'agency' || (extras.seats === 0 && extras.sites === 0));
  if (!consistent) {
    throw new Error(
      `account limits ${row.seat_limit}/${row.site_limit}/${row.competitor_limit} match no ${row.tier} plan`,
    );
  }
  return {
    version: row.entitlement_version,
    snapshot: {
      state: row.state,
      tier: row.tier,
      trialVariant: row.trial_variant,
      trialEndsAt: date(row.trial_ends_at),
      trialUsedAt: date(row.trial_used_at),
      pastDueTier: row.past_due_tier,
      pastDueSince: date(row.past_due_since),
      disputedAt: date(row.disputed_at),
      extras,
    },
  };
}

export function toTransitionParams(
  accountId: string,
  version: number,
  s: EntitlementSnapshot,
  at: Date,
): TransitionParams {
  const gates = GATES[s.tier];
  return {
    p_account_id: accountId,
    p_expected_version: version,
    p_state: s.state,
    p_tier: s.tier,
    p_past_due_tier: s.pastDueTier,
    p_past_due_since: iso(s.pastDueSince),
    p_trial_variant: s.trialVariant,
    p_trial_ends_at: iso(s.trialEndsAt),
    p_trial_used_at: iso(s.trialUsedAt),
    p_disputed_at: iso(s.disputedAt),
    p_seat_limit: gates.seats + s.extras.seats,
    p_site_limit: gates.sites + s.extras.sites,
    p_competitor_limit: gates.competitorsPerSite,
    p_at: at.toISOString(),
  };
}

export interface AppliedTransition {
  transition: Transition;
  /** The account's version after this call: unchanged when the event was ignored. */
  version: number;
  /**
   * Site effects the RPC does not apply yet, because the `sites` table arrives in migration 003.
   * Until then the caller owns them; `planSites` computes them.
   */
  siteEffects: SiteEffect[];
}

const SITE_EFFECTS: readonly string[] = ['pause_others', 'pause_over_limit', 'resume'];

export async function applyEntitlementTransition(
  store: EntitlementStore,
  accountId: string,
  event: EntitlementEvent,
): Promise<AppliedTransition> {
  const stored = await store.load(accountId);
  if (stored === null) throw new Error(`account ${accountId} not found`);
  const transition = next(stored.snapshot, event);
  if (transition.outcome === 'ignored')
    return { transition, version: stored.version, siteEffects: [] };
  const version = await store.commit(
    toTransitionParams(accountId, stored.version, transition.state, event.at),
  );
  const siteEffects = transition.effects
    .map((e) => e.kind)
    .filter((kind): kind is SiteEffect => SITE_EFFECTS.includes(kind));
  return { transition, version, siteEffects };
}

/** The store for route handlers and Inngest functions; `sb` must be the service-role client. */
export function supabaseEntitlementStore(sb: SupabaseClient): EntitlementStore {
  return {
    async load(accountId) {
      const { data, error } = await sb
        .from('accounts')
        .select(ACCOUNT_COLUMNS)
        .eq('id', accountId)
        .maybeSingle();
      if (error) throw new Error(`accounts read failed: ${error.message}`);
      return data ? snapshotFromRow(data as unknown as AccountRow) : null;
    },
    async commit(params) {
      const { data, error } = await sb.rpc('apply_entitlement_transition', params);
      if (error) {
        if (error.code === '40001') throw new EntitlementConflictError(params.p_account_id);
        throw Object.assign(new Error(`apply_entitlement_transition failed: ${error.message}`), {
          code: error.code,
        });
      }
      return data as number;
    },
  };
}
