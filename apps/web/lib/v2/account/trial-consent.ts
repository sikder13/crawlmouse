/**
 * The Agency trial's consent, as the account's record holds it (CC-29 stores it; CC-31 reads it).
 *
 * `accounts.agency_trial_consent_at` is one of the columns migration 20261114000001 hides from
 * client roles, so the caller's session cannot read it. It is read here with the service role, for
 * the one account whose row the caller's own session has already returned (row security decided
 * that), and only when that row's history holds an Agency trial: the contract holds a consent for
 * exactly those accounts.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { hadAgencyTrial } from './rows';

type Row = Record<string, unknown>;

/** `account` is the row the caller's session read. Null for an account that had no Agency trial. */
export async function agencyTrialConsentAt(admin: SupabaseClient, account: Row): Promise<unknown> {
  if (!hadAgencyTrial(account)) return null;
  const { data, error } = await admin
    .from('accounts')
    .select('agency_trial_consent_at')
    .eq('id', account.id as string)
    .maybeSingle();
  if (error) throw new Error(`accounts consent read failed: ${error.message}`);
  return (data as { agency_trial_consent_at: unknown } | null)?.agency_trial_consent_at ?? null;
}
