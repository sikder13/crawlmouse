/**
 * Goal 1 row 16 (F-157): how many pages a check reads. A check of a kept site on a paid tier reads its
 * plan's pages per check (`GATES`, lib/entitlement-v2.ts) while `featureShown('pages_2000')`; every
 * other check reads DEFAULT_PAGE_CAP: a Free account's, a site no account keeps (a visitor's audit, a
 * competitor), and any check while the switch hides 2,000 pages.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { effectiveTier, GATES, type EntitlementClock } from '../../entitlement-v2';
import { featureShown } from '../../feature-switch';
import { DEFAULT_PAGE_CAP } from './limits';
import { readAccountClock } from './load-for';

type Env = Readonly<Record<string, string | undefined>>;

/** The page cap of a check of a site kept by an account on `clock` (null for none), at `now`. */
export function pageCapFor(
  clock: EntitlementClock | null,
  now: Date,
  env: Env = process.env,
): number {
  if (clock === null || !featureShown('pages_2000', env)) return DEFAULT_PAGE_CAP;
  const tier = effectiveTier(clock, now);
  return tier === 'free' ? DEFAULT_PAGE_CAP : GATES[tier].pagesPerCheck;
}

/** The page cap of a check of a site kept by `accountId`, read from its `accounts` row now. */
export async function accountPageCap(sb: SupabaseClient, accountId: string): Promise<number> {
  return pageCapFor(await readAccountClock(sb, accountId), new Date());
}
