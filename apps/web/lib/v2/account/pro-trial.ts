/**
 * Starting the no-card Pro trial from the dashboard (CC-26b D7). There is no second trial rule here:
 * the decision is the account door's own `decideTrial` (lib/auth/first-login.ts), which reads the
 * account's entitlement, asks the state machine's `next()` for `trial_started`, applies it with the
 * ledger through `start_trial_with_ledger` (migration 006c), and dispatches the started trial's
 * effects through CC-03's dispatcher. This module reads the account the route names, calls it, and
 * says what each outcome answers.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { decideTrial, type FirstLoginDeps, type TrialOutcome } from '../../auth/first-login';
import type { MemberAccount } from '../../auth/door-store';

export interface ProTrialInput {
  accountId: string;
  userId: string;
  email: string;
  /** The `cm_auth_device` cookie, when the browser has one. */
  device: string | null;
  /** `getClientIp`'s value. */
  ip: string;
}

export type ProTrialAnswer =
  | { outcome: 'started'; variant: 'no_card' }
  | { outcome: Exclude<TrialOutcome, 'started'>; status: number; code: string };

/** What each outcome other than `started` answers. */
export const REFUSALS: Record<
  Exclude<TrialOutcome, 'started'>,
  { status: number; code: string }
> = {
  not_eligible: { status: 409, code: 'not_eligible' },
  denied: { status: 409, code: 'refused' },
  not_first: { status: 409, code: 'conflict' },
  failed: { status: 500, code: 'trial_failed' },
  no_pepper: { status: 503, code: 'trial_unavailable' },
  no_account: { status: 404, code: 'not_found' },
};

const date = z
  .string()
  .nullable()
  .transform((v) => (v === null ? null : new Date(v)));

const AccountRow = z.object({
  state: z.enum(['free', 'pro_trial', 'pro', 'agency_trial', 'agency', 'past_due']),
  tier: z.enum(['free', 'pro', 'agency']),
  trial_variant: z.enum(['no_card', 'card_required']).nullable(),
  trial_ends_at: date,
  trial_used_at: date,
  past_due_tier: z.enum(['pro', 'agency']).nullable(),
  past_due_since: date,
  site_limit: z.number().int(),
  timezone: z.string(),
});

/**
 * The account as the door's decision reads it, through the caller's own client, with the caller's
 * active owner seat on it; null when either is not there.
 */
export async function ownedAccount(
  session: SupabaseClient,
  accountId: string,
  userId: string,
): Promise<MemberAccount | null> {
  const a = await session
    .from('accounts')
    .select(
      'state, tier, trial_variant, trial_ends_at, trial_used_at, past_due_tier, past_due_since, site_limit, timezone',
    )
    .eq('id', accountId)
    .is('deleted_at', null)
    .maybeSingle();
  if (a.error) throw new Error(`pro trial: accounts read failed: ${a.error.message}`);
  if (a.data === null) return null;
  const s = await session
    .from('seats')
    .select('id')
    .eq('account_id', accountId)
    .eq('user_id', userId)
    .eq('role', 'owner')
    .eq('status', 'active')
    .maybeSingle();
  if (s.error) throw new Error(`pro trial: seats read failed: ${s.error.message}`);
  if (s.data === null) return null;
  const r = AccountRow.parse(a.data);
  return {
    accountId,
    ownerSeatId: (s.data as { id: string }).id,
    state: r.state,
    tier: r.tier,
    trialVariant: r.trial_variant,
    trialEndsAt: r.trial_ends_at,
    trialUsedAt: r.trial_used_at,
    pastDueTier: r.past_due_tier,
    pastDueSince: r.past_due_since,
    siteLimit: r.site_limit,
    timezone: r.timezone,
  };
}

export async function startProTrial(
  deps: FirstLoginDeps,
  account: MemberAccount,
  input: ProTrialInput,
): Promise<ProTrialAnswer> {
  const decided = await decideTrial(
    deps,
    {
      userId: input.userId,
      email: input.email,
      device: input.device,
      ip: input.ip,
      // Read by the first-login hook only; the decision itself does not look at them.
      emailConfirmedAt: null,
      lastSignInAt: null,
      signup: null,
    },
    account,
  );
  return decided.outcome === 'started'
    ? { outcome: 'started', variant: decided.variant }
    : { outcome: decided.outcome, ...REFUSALS[decided.outcome] };
}
