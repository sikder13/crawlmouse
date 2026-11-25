/**
 * The seat a caller acts in (F-105), in a module of its own: the viewer read (`viewer-read.ts`) and
 * the page theme (`session-theme.ts`) both choose here, so they cannot land on different seats, and
 * the theme reaches no viewer read.
 */
import { SeatRoleSchema, ThemeSchema } from '@crawlmouse/types/v2';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

export interface SeatDeps {
  /** The caller's own client: row security applies. */
  session: SupabaseClient;
  /** The service role, for the caller's own `users.default_account_id` only. */
  admin: SupabaseClient;
}

export const SeatRow = z.object({
  id: z.string(),
  account_id: z.string(),
  role: SeatRoleSchema,
  theme: ThemeSchema,
});

/** One active seat of the caller's, as `SeatRow` reads it. */
export type SeatChoice = z.infer<typeof SeatRow>;

function failed(what: string, error: { message: string }): never {
  throw new Error(`viewer: ${what} failed: ${error.message}`);
}

/**
 * Where a person with several seats lands when nothing recorded chooses (F-105): their personal
 * account if it holds a site, else the one agency they own, else the default. An account they only
 * hold a seat on is not chosen for them, because the account landed in is the one their next site
 * is added to. Read with the caller's own client, and nothing is written. An account marked for
 * deletion is never among `mine`: `seats` is read through row security, whose `is_member` is false
 * once `deletion_confirmed_at` is set, and the caller's grant does not include that column.
 */
async function landingSeat(
  deps: SeatDeps,
  userId: string,
  mine: SeatChoice[],
): Promise<SeatChoice | null> {
  const home = await defaultSeat(deps, userId, mine);
  if (home === null) return null;
  const owned = mine.filter((s) => s.role === 'owner' && s.account_id !== home.account_id);
  if (owned.length === 0) return home;

  const accounts = await deps.session
    .from('accounts')
    .select('id, kind')
    .in('id', [home.account_id, ...owned.map((s) => s.account_id)])
    .is('deleted_at', null);
  if (accounts.error) failed('accounts kinds', accounts.error);
  const kinds = new Map(
    z
      .array(z.object({ id: z.string(), kind: z.string() }))
      .parse(accounts.data)
      .map((a) => [a.id, a.kind]),
  );
  if (kinds.get(home.account_id) !== 'personal') return home;
  const agencies = owned.filter((s) => kinds.get(s.account_id) === 'agency');
  if (agencies.length !== 1) return home;

  const sites = await deps.session
    .from('sites')
    .select('id')
    .eq('account_id', home.account_id)
    .is('staging_of_site_id', null)
    .is('removed_at', null)
    .limit(1);
  if (sites.error) failed('personal sites', sites.error);
  return sites.data.length > 0 ? home : agencies[0]!;
}

/**
 * The seat a caller acts in: the one on the account the switcher names, else their only seat, else
 * `landingSeat`'s. Undefined with no seat, null when none can be chosen. The viewer and the page
 * theme (`session-theme.ts`) both choose here, so they cannot land on different seats.
 */
export async function pickSeat(
  deps: SeatDeps,
  userId: string,
  mine: SeatChoice[],
  chosen: string | null,
): Promise<SeatChoice | null | undefined> {
  const picked = chosen === null ? undefined : mine.find((s) => s.account_id === chosen);
  return picked ?? (mine.length <= 1 ? mine[0] : await landingSeat(deps, userId, mine));
}

/** The seat on the caller's default account, or null when the default is none of their seats. */
async function defaultSeat(
  deps: SeatDeps,
  userId: string,
  mine: SeatChoice[],
): Promise<SeatChoice | null> {
  const u = await deps.admin
    .from('users')
    .select('default_account_id')
    .eq('id', userId)
    .maybeSingle();
  if (u.error) failed('users read', u.error);
  const id = (u.data as { default_account_id: string | null } | null)?.default_account_id;
  return mine.find((s) => s.account_id === id) ?? null;
}
