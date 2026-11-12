/**
 * The accounts a person's deletion removes, as the delete step lists them (plan-revision R2): the
 * `accounts` of the erasure's own plan (`erase_person_plan`, migration 027b section B), each named by
 * its primary site, the oldest live site that is not a staging copy, or by none. Read with the
 * service role, after the page has established through the caller's session that they are the
 * owner. The plan's other keys (its counts, what it keeps, its refusals) are the deletion routes'.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

const Plan = z.object({ accounts: z.array(z.uuid()) });

export async function deletionAccounts(
  admin: SupabaseClient,
  userId: string,
): Promise<{ accountId: string; host: string | null }[]> {
  const plan = await admin.rpc('erase_person_plan', { p_user: userId, p_email: null });
  if (plan.error) throw new Error(`deletion plan: erase_person_plan failed: ${plan.error.message}`);
  const { accounts } = Plan.parse(plan.data);
  if (accounts.length === 0) return [];
  const sites = await admin
    .from('sites')
    .select('id, account_id, host, created_at')
    .in('account_id', accounts)
    .is('staging_of_site_id', null)
    .is('removed_at', null);
  if (sites.error) throw new Error(`deletion plan: sites read failed: ${sites.error.message}`);
  const rows = (sites.data ?? []) as {
    id: string;
    account_id: string;
    host: string;
    created_at: string;
  }[];
  return accounts.map((accountId) => {
    const primary = rows
      .filter((s) => s.account_id === accountId)
      .sort(
        (x, y) => Date.parse(x.created_at) - Date.parse(y.created_at) || x.id.localeCompare(y.id),
      )[0];
    return { accountId, host: primary?.host ?? null };
  });
}

/**
 * The code the owner's deletion request would be refused with past the hostname check
 * (`account_deletion_blocked`, migration 027b section C), or null. Read with the service role after
 * the page has shown the caller is the owner.
 */
export async function deletionBlocked(
  admin: SupabaseClient,
  accountId: string,
  userId: string,
): Promise<string | null> {
  const { data, error } = await admin.rpc('account_deletion_blocked', {
    p_account: accountId,
    p_user: userId,
  });
  if (error) throw new Error(`deletion plan: account_deletion_blocked failed: ${error.message}`);
  return z.string().nullable().parse(data);
}
