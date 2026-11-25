/**
 * The viewer's read, with its clients passed in (viewer.ts wires them from the request). What it can
 * return, and why no other account's ids or email can be in it, is stated in viewer.ts.
 */
import { AccountStateSchema, SeatRoleSchema, ThemeSchema } from '@crawlmouse/types/v2';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { siteLimitAt } from '../../auth/site-limit';
import { effectiveTier, GATES, type Tier, type TierGates } from '../../entitlement-v2';

export interface ViewerDeps {
  /** The caller's own client: row security applies. */
  session: SupabaseClient;
  /** The service role, for the caller's own `users.default_account_id` only. */
  admin: SupabaseClient;
  now(): Date;
}

export interface AccountViewer {
  userId: string;
  /** The caller's own email, from their session. */
  email: string | null;
  seat: { id: string; role: z.infer<typeof SeatRoleSchema>; theme: z.infer<typeof ThemeSchema> };
  account: {
    id: string;
    kind: 'personal' | 'agency';
    name: string | null;
    state: z.infer<typeof AccountStateSchema>;
    timezone: string;
    trialEndsAt: Date | null;
    trialUsedAt: Date | null;
    stateHistory: { state: z.infer<typeof AccountStateSchema>; since: string }[];
  };
  /** The tier at `now`, with the trial and past-due clocks read (`effectiveTier`). */
  tier: Tier;
  gates: Readonly<TierGates>;
  limits: { sites: number; seats: number; competitorsPerSite: number };
  /** Every account the caller holds an active seat on, this one included: what the switcher lists. */
  accounts: { id: string; kind: 'personal' | 'agency'; name: string | null }[];
}

export type ViewerResult =
  | { kind: 'signed_out' }
  | { kind: 'no_account'; userId: string }
  /** Several active seats and no default among them: the request has to say which account. */
  | { kind: 'ambiguous'; userId: string }
  | { kind: 'viewer'; viewer: AccountViewer };

export const SeatRow = z.object({
  id: z.string(),
  account_id: z.string(),
  role: SeatRoleSchema,
  theme: ThemeSchema,
});

const date = z
  .string()
  .nullable()
  .transform((v) => (v === null ? null : new Date(v)));

const AccountRow = z.object({
  id: z.string(),
  kind: z.enum(['personal', 'agency']),
  name: z.string().nullable(),
  state: AccountStateSchema,
  tier: z.enum(['free', 'pro', 'agency']),
  past_due_tier: z.enum(['pro', 'agency']).nullable(),
  past_due_since: date,
  trial_variant: z.enum(['no_card', 'card_required']).nullable(),
  trial_ends_at: date,
  trial_used_at: date,
  timezone: z.string(),
  seat_limit: z.number().int(),
  site_limit: z.number().int(),
  competitor_limit: z.number().int(),
  state_history: z.array(z.object({ state: AccountStateSchema, since: z.string() })),
});

const ACCOUNT_COLUMNS =
  'id, kind, name, state, tier, past_due_tier, past_due_since, trial_variant, trial_ends_at, ' +
  'trial_used_at, timezone, seat_limit, site_limit, competitor_limit, state_history';

function failed(what: string, error: { message: string }): never {
  throw new Error(`viewer: ${what} failed: ${error.message}`);
}

/**
 * `chosen` is the account the caller picked in the switcher (viewer-cookie.ts), or null. It is
 * followed only when it is the account of one of the caller's own active seats; otherwise the caller
 * acts in their default account, as before the switcher existed.
 */
export async function readViewer(
  deps: ViewerDeps,
  user: { id: string; email: string | null },
  chosen: string | null = null,
): Promise<ViewerResult> {
  const seats = await deps.session
    .from('seats')
    .select('id, account_id, role, theme')
    .eq('user_id', user.id)
    .eq('status', 'active');
  if (seats.error) failed('seats read', seats.error);
  const mine = z.array(SeatRow).parse(seats.data);
  const seat = await pickSeat(deps, user.id, mine, chosen);
  if (seat === null) return { kind: 'ambiguous', userId: user.id };
  if (seat === undefined) return { kind: 'no_account', userId: user.id };

  const entitlement = await readEntitlement(deps.session, seat.account_id, deps.now());
  if (entitlement === null) return { kind: 'no_account', userId: user.id };
  return {
    kind: 'viewer',
    viewer: {
      userId: user.id,
      email: user.email,
      seat: { id: seat.id, role: seat.role, theme: seat.theme },
      ...entitlement,
      accounts: await seatAccounts(
        deps.session,
        mine.map((s) => s.account_id),
      ),
    },
  };
}

const SwitcherRow = z.object({
  id: z.string(),
  kind: z.enum(['personal', 'agency']),
  name: z.string().nullable(),
});

/** The accounts of the caller's active seats, read with the caller's own client. */
async function seatAccounts(
  session: SupabaseClient,
  accountIds: string[],
): Promise<AccountViewer['accounts']> {
  const accounts = await session
    .from('accounts')
    .select('id, kind, name')
    .in('id', accountIds)
    .is('deleted_at', null);
  if (accounts.error) failed('accounts list', accounts.error);
  return z.array(SwitcherRow).parse(accounts.data);
}

export type Entitlement = Pick<AccountViewer, 'account' | 'tier' | 'gates' | 'limits'>;

/**
 * An account's tier, gates and limits at `now`, read with the caller's own client, so it is null for
 * an account the caller does not sit on (or a deleted one). A route that acts on a row reads the
 * row's own account here once the caller's membership of it is established: the viewer's account is
 * the one they act in by default, which need not be the row's.
 */
export async function readEntitlement(
  session: SupabaseClient,
  accountId: string,
  now: Date,
): Promise<Entitlement | null> {
  const account = await session
    .from('accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('id', accountId)
    .is('deleted_at', null)
    .maybeSingle();
  if (account.error) failed('accounts read', account.error);
  if (account.data === null) return null;
  const row = AccountRow.parse(account.data);

  const clock = {
    state: row.state,
    tier: row.tier,
    pastDueTier: row.past_due_tier,
    pastDueSince: row.past_due_since,
    trialVariant: row.trial_variant,
    trialEndsAt: row.trial_ends_at,
  };
  const tier = effectiveTier(clock, now);
  // The stored limits are the plan's with its extras; once the clock has moved the account to
  // another tier than the stored one, that tier's own limits apply.
  const stored = tier === row.tier;
  return {
    account: {
      id: row.id,
      kind: row.kind,
      name: row.name,
      state: row.state,
      timezone: row.timezone,
      trialEndsAt: row.trial_ends_at,
      trialUsedAt: row.trial_used_at,
      stateHistory: row.state_history,
    },
    tier,
    gates: GATES[tier],
    limits: {
      sites: siteLimitAt({ ...clock, siteLimit: row.site_limit }, now),
      seats: stored ? row.seat_limit : GATES[tier].seats,
      competitorsPerSite: stored ? row.competitor_limit : GATES[tier].competitorsPerSite,
    },
  };
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
  deps: Pick<ViewerDeps, 'session' | 'admin'>,
  userId: string,
  mine: z.infer<typeof SeatRow>[],
): Promise<z.infer<typeof SeatRow> | null> {
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

/** One active seat of the caller's, as `SeatRow` reads it. */
export type SeatChoice = z.infer<typeof SeatRow>;

/**
 * The seat a caller acts in: the one on the account the switcher names, else their only seat, else
 * `landingSeat`'s. Undefined with no seat, null when none can be chosen. The viewer and the page
 * theme (`session-theme.tsx`) both choose here, so they cannot land on different seats.
 */
export async function pickSeat(
  deps: Pick<ViewerDeps, 'session' | 'admin'>,
  userId: string,
  mine: SeatChoice[],
  chosen: string | null,
): Promise<SeatChoice | null | undefined> {
  const picked = chosen === null ? undefined : mine.find((s) => s.account_id === chosen);
  return picked ?? (mine.length <= 1 ? mine[0] : await landingSeat(deps, userId, mine));
}

/** The seat on the caller's default account, or null when the default is none of their seats. */
async function defaultSeat(
  deps: Pick<ViewerDeps, 'session' | 'admin'>,
  userId: string,
  mine: z.infer<typeof SeatRow>[],
): Promise<z.infer<typeof SeatRow> | null> {
  const u = await deps.admin
    .from('users')
    .select('default_account_id')
    .eq('id', userId)
    .maybeSingle();
  if (u.error) failed('users read', u.error);
  const id = (u.data as { default_account_id: string | null } | null)?.default_account_id;
  return mine.find((s) => s.account_id === id) ?? null;
}
