/**
 * The traits a signed-in page identifies its browser with (lib/analytics/person.ts), read on the
 * server for the IdentifyPersonMount the signed-in layouts render.
 *
 * Reads: the viewer (`loadViewer`, the caller's own client); whether the account is internal
 * (`is_internal_subject` through internal-marker.ts's cached lookup); and the count of the account's
 * finished and partial checks, with the caller's own client, so row security bounds it to an account
 * they sit on. Nothing here reads an email or a name, and PersonTraits has no field for one.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer } from '../supabase/server';
import { loadViewer, type AccountViewer } from '../v2/account/viewer';
import { defaultInternalLookup, type InternalLookup } from '../v2/ops/internal-marker';
import { personSet, type PersonTraits } from './person';

export interface TraitsDeps {
  /** The account's finished and partial checks. */
  checksFinished(accountId: string): Promise<number>;
  internal: InternalLookup;
  now: Date;
}

export async function readPersonTraits(
  viewer: AccountViewer,
  deps: TraitsDeps,
): Promise<PersonTraits> {
  const { account } = viewer;
  const [internal, checksFinished] = await Promise.all([
    deps.internal({ kind: 'account', id: account.id }),
    deps.checksFinished(account.id),
  ]);
  return {
    userId: viewer.userId,
    set: personSet(
      {
        accountId: account.id,
        state: account.state,
        stateHistory: account.stateHistory,
        internal,
        checksFinished,
      },
      deps.now,
    ),
  };
}

/** The count of an account's finished and partial checks, over its sites, with `session`. */
export function sessionChecksFinished(session: SupabaseClient) {
  return async (accountId: string): Promise<number> => {
    const sites = await session.from('sites').select('id').eq('account_id', accountId);
    if (sites.error) throw new Error(`person traits: sites read failed: ${sites.error.message}`);
    const ids = (sites.data as { id: string }[]).map((s) => s.id);
    if (ids.length === 0) return 0;
    const checks = await session
      .from('checks')
      .select('id', { count: 'exact', head: true })
      .in('site_id', ids)
      .in('status', ['finished', 'partial']);
    if (checks.error)
      throw new Error(`person traits: checks count failed: ${checks.error.message}`);
    return checks.count ?? 0;
  };
}

/**
 * This request's person traits, or null: signed out, no single account, or no PostHog project key
 * (the browser starts no PostHog then, so nothing is read).
 */
export async function signedInPersonTraits(): Promise<PersonTraits | null> {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return null;
  const r = await loadViewer();
  if (r.kind !== 'viewer') return null;
  return readPersonTraits(r.viewer, {
    checksFinished: sessionChecksFinished(await supabaseServer()),
    internal: defaultInternalLookup,
    now: new Date(),
  });
}
