/**
 * Test support for the agency workspace: a second account of kind `agency` for a person who has their
 * personal one, written as postgres. CC-29's `start_agency_trial_account` makes this row in
 * production; until it is on this branch the tests seed it directly.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { GATES } from '../../entitlement-v2';
import type { Person } from '../account/sites-test-support';

export interface AgencyAccount {
  accountId: string;
  /** The owner's seat on the agency account. */
  seatId: string;
}

/** An Agency account named `name`, on the Agency plan with its stored limits, owned by `owner`. */
export async function agencyAccount(
  db: PGlite,
  owner: Pick<Person, 'id' | 'email'>,
  name = 'Summit Digital',
): Promise<AgencyAccount> {
  const g = GATES.agency;
  const account = await db.query<{ id: string }>(
    `insert into public.accounts (kind, name, state, tier, seat_limit, site_limit, competitor_limit,
                                  timezone, current_subscription_id, state_history)
     values ('agency', $1, 'agency', 'agency', $2, $3, $4, 'UTC', $5,
             jsonb_build_array(jsonb_build_object('state', 'agency', 'since', now()::text)))
     returning id`,
    [name, g.seats, g.sites, g.competitorsPerSite, `sub_${randomUUID().replaceAll('-', '')}`],
  );
  const accountId = account.rows[0]!.id;
  const seat = await db.query<{ id: string }>(
    `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
     values ($1, $2, $3, 'owner', 'active', now())
     returning id`,
    [accountId, owner.id, owner.email],
  );
  return { accountId, seatId: seat.rows[0]!.id };
}
