/**
 * What the Pricing and Agency trial pages read about the signed-in person. The default account comes
 * from the viewer (lib/v2/account/viewer.ts) and its entitlement from the state machine's own reader
 * (`supabaseEntitlementStore`, the one CC-03's routes use) and its customer from the portal's, for
 * that account's id and the used agency trial's only. A used agency trial is read by the rule of
 * `start_agency_trial_account` (./used-trial.ts). The agency
 * accounts are read with the person's own client, so row security returns only the accounts they
 * sit on, and only the columns members may read.
 */
import 'server-only';
import { AccountStateSchema } from '@crawlmouse/types/v2';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabasePortalAccounts } from '../../billing/portal-v2';
import { supabaseEntitlementStore } from '../../billing/state-machine-apply';
import { supabaseAdmin } from '../../supabase/admin';
import { supabaseServer } from '../../supabase/server';
import { loadViewer } from '../account/viewer';
import { agencyStanding, type AgencyAccountRow } from '../view/agency-trial';
import type { PricingAccount, PricingViewer } from '../view/pricing';
import { readUsedAgencyTrial } from './used-trial';

const date = z
  .string()
  .nullable()
  .transform((v) => (v === null ? null : new Date(v)));

const AccountRow = z.object({
  id: z.string(),
  name: z.string().nullable(),
  state: AccountStateSchema,
  tier: z.enum(['free', 'pro', 'agency']),
  past_due_tier: z.enum(['pro', 'agency']).nullable(),
  past_due_since: date,
  trial_variant: z.enum(['no_card', 'card_required']).nullable(),
  trial_ends_at: date,
  trial_used_at: date,
  current_subscription_id: z.string().nullable(),
});

function failed(what: string, error: { message: string }): never {
  throw new Error(`agency accounts: ${what} failed: ${error.message}`);
}

/** The agency accounts the person holds an active seat on, each with its oldest live site. */
export async function readAgencyAccounts(
  session: SupabaseClient,
  userId: string,
): Promise<AgencyAccountRow[]> {
  const seats = await session
    .from('seats')
    .select('account_id, role')
    .eq('user_id', userId)
    .eq('status', 'active');
  if (seats.error) failed('seats read', seats.error);
  const roles = new Map(
    z
      .array(z.object({ account_id: z.string(), role: z.string() }))
      .parse(seats.data)
      .map((s) => [s.account_id, s.role]),
  );
  if (roles.size === 0) return [];

  const accounts = await session
    .from('accounts')
    .select(
      'id, name, state, tier, past_due_tier, past_due_since, trial_variant, trial_ends_at, ' +
        'trial_used_at, current_subscription_id',
    )
    .in('id', [...roles.keys()])
    .eq('kind', 'agency')
    .is('deleted_at', null)
    .order('created_at');
  if (accounts.error) failed('accounts read', accounts.error);
  const rows = z.array(AccountRow).parse(accounts.data);
  if (rows.length === 0) return [];

  const sites = await session
    .from('sites')
    .select('account_id, host')
    .in(
      'account_id',
      rows.map((r) => r.id),
    )
    .is('removed_at', null)
    .order('created_at');
  if (sites.error) failed('sites read', sites.error);
  const firstSite = new Map<string, string>();
  for (const s of z
    .array(z.object({ account_id: z.string(), host: z.string() }))
    .parse(sites.data)) {
    if (!firstSite.has(s.account_id)) firstSite.set(s.account_id, s.host);
  }

  return rows.map((r) => ({
    id: r.id,
    role: roles.get(r.id)!,
    name: r.name,
    state: r.state,
    tier: r.tier,
    pastDueTier: r.past_due_tier,
    pastDueSince: r.past_due_since,
    trialVariant: r.trial_variant,
    trialEndsAt: r.trial_ends_at,
    trialUsedAt: r.trial_used_at,
    subscriptionId: r.current_subscription_id,
    firstSite: firstSite.get(r.id) ?? null,
  }));
}

/**
 * An account as Pricing's paid buttons need it: its entitlement through the state machine's reader
 * and its Stripe customer through the portal's, both over the service role (neither is
 * member-readable). Null when the account is not there.
 */
async function pricingAccount(admin: SupabaseClient, id: string): Promise<PricingAccount | null> {
  const stored = await supabaseEntitlementStore(admin).load(id);
  if (stored === null) return null;
  return {
    id,
    snapshot: stored.snapshot,
    customer: await supabasePortalAccounts(admin).customerOf(id),
  };
}

/** The person as the Pricing page's buttons need them. */
export async function readPricingViewer(now: Date): Promise<PricingViewer> {
  const r = await loadViewer();
  if (r.kind === 'signed_out') return { kind: 'signed_out' };
  const userId = r.kind === 'viewer' ? r.viewer.userId : r.userId;
  const admin = supabaseAdmin();
  const used = await readUsedAgencyTrial(admin, userId);
  const standing = agencyStanding(
    await readAgencyAccounts(await supabaseServer(), userId),
    used,
    now,
  );
  const agency = {
    held: standing.held,
    used:
      used === null
        ? null
        : { account: used.deleted ? null : await pricingAccount(admin, used.accountId) },
  };
  if (r.kind !== 'viewer') return { kind: 'signed_in', account: null, agency };

  const { account, seat, tier } = r.viewer;
  const read = await pricingAccount(admin, account.id);
  if (read === null) return { kind: 'signed_in', account: null, agency };
  return {
    kind: 'signed_in',
    account: { ...read, owner: seat.role === 'owner', tier },
    agency,
  };
}
