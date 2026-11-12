/**
 * Who may do what, and which sites a seat reads (CC-31 D2).
 *
 * `SEAT_GUARD` is the Guard column of docs/specs/v2/31-agency.md §3 for the screens: which buttons a
 * role is shown. The rule a route enforces is SQL's `seat_may` (migration 20261114000002, section S),
 * asked as the caller; `__tests__/v2-031-seam.test.ts` asks SQL every role and action and compares
 * the answers with this table and with a table written out in the test.
 *
 * Whether a seat covers a site is SQL's `is_member_for_site`, asked as the caller: directly
 * (`siteInScope`), or through the caller's own read of `sites`, whose row policy is that function
 * (`sitesInScope`). A service-role read of a site's rows is keyed by ids one of these returned.
 */
import type { SeatRole } from '@crawlmouse/types/v2';
import type { SupabaseClient } from '@supabase/supabase-js';

export const SEAT_ACTIONS = [
  'export_report',
  'share_report',
  'schedule_report',
  'prospect_report',
  'add_site',
  'edit_site',
  'remove_site',
  'invite_seat',
  'change_seat',
  'remove_seat',
  'buy_seats',
  'edit_account_alerts',
] as const;

export type SeatAction = (typeof SEAT_ACTIONS)[number];

/** What an account manager does: the clients' work, and the account's alerts as Settings has it. */
const MANAGER: readonly SeatAction[] = [
  'export_report',
  'share_report',
  'schedule_report',
  'prospect_report',
  'add_site',
  'edit_site',
  'remove_site',
  'edit_account_alerts',
];

export const SEAT_GUARD: Readonly<Record<SeatRole, readonly SeatAction[]>> = {
  owner: SEAT_ACTIONS,
  account_manager: MANAGER,
  developer: ['export_report'],
};

/** Whether the screens offer `action` to a seat of `role`. */
export const roleMay = (role: SeatRole, action: SeatAction): boolean =>
  SEAT_GUARD[role].includes(action);

/** `seat_may`, asked as the caller: false for a role the Guard column refuses and for no seat at all. */
export async function mayDo(
  session: SupabaseClient,
  accountId: string,
  action: SeatAction,
): Promise<boolean> {
  const { data, error } = await session.rpc('seat_may', { p_account: accountId, p_action: action });
  if (error) throw new Error(`seat_may failed: ${error.message}`);
  return data === true;
}

/** `is_member_for_site`, asked as the caller. */
export async function siteInScope(session: SupabaseClient, siteId: string): Promise<boolean> {
  const { data, error } = await session.rpc('is_member_for_site', { p_site: siteId });
  if (error) throw new Error(`is_member_for_site failed: ${error.message}`);
  return data === true;
}

/** The ids of `accountId`'s live sites the caller's seat covers, from the caller's own read. */
export async function sitesInScope(session: SupabaseClient, accountId: string): Promise<string[]> {
  const { data, error } = await session
    .from('sites')
    .select('id')
    .eq('account_id', accountId)
    .is('removed_at', null);
  if (error) throw new Error(`sites read failed: ${error.message}`);
  return ((data ?? []) as { id: string }[]).map((s) => s.id);
}
