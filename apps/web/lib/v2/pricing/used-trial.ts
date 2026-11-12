/**
 * Whether a person's agency trial is used, by the rule `start_agency_trial_account` (migration
 * 20261114000001) answers `trial_used` with: they hold an active owner seat on an agency account
 * whose trial was used. A deleted account counts, so deleting one does not give a second trial.
 *
 * Read with the service role, for the caller's own id only: a deleted account is not
 * member-readable (`is_member` leaves it out), so the caller's own client cannot see it.
 * `__tests__/v2-029-public-pages.test.ts` holds this read to the function over a sweep of seats and
 * accounts.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

export interface UsedTrial {
  accountId: string;
  trialUsedAt: Date;
  /** The account is deleted: it still counts, but nothing can be done on it. */
  deleted: boolean;
}

const Row = z.object({
  id: z.string(),
  trial_used_at: z.string(),
  deleted_at: z.string().nullable(),
});

function failed(what: string, error: { message: string }): never {
  throw new Error(`used agency trial: ${what} failed: ${error.message}`);
}

/** The person's used agency trial, a live account before a deleted one; null when none is used. */
export async function readUsedAgencyTrial(
  admin: SupabaseClient,
  userId: string,
): Promise<UsedTrial | null> {
  const seats = await admin
    .from('seats')
    .select('account_id')
    .eq('user_id', userId)
    .eq('role', 'owner')
    .eq('status', 'active');
  if (seats.error) failed('seats read', seats.error);
  const ids = z
    .array(z.object({ account_id: z.string() }))
    .parse(seats.data)
    .map((s) => s.account_id);
  if (ids.length === 0) return null;

  const accounts = await admin
    .from('accounts')
    .select('id, trial_used_at, deleted_at')
    .in('id', ids)
    .eq('kind', 'agency')
    .not('trial_used_at', 'is', null)
    .order('trial_used_at');
  if (accounts.error) failed('accounts read', accounts.error);
  const rows = z.array(Row).parse(accounts.data);
  const row = rows.find((r) => r.deleted_at === null) ?? rows[0];
  return row
    ? {
        accountId: row.id,
        trialUsedAt: new Date(row.trial_used_at),
        deleted: row.deleted_at !== null,
      }
    : null;
}
