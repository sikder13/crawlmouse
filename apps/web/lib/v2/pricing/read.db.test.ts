/**
 * The agency accounts the Agency trial page reads (`readAgencyAccounts`), run as the signed-in person
 * over the migrated schema (PGlite, every migration applied, the PostgREST stand-in with `as`), so row
 * security, the column grants and the reader's own filters decide the answer (correctness B-r2-1).
 * A subscription set to cancel at its period's end is read from the mirror the way Settings reads it
 * (`loadSettingsDataset`): `cancel_at_period_end` and `current_period_end`.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, asRole, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../../__tests__/helpers/postgrest-pglite';
import { signUp } from '../../../__tests__/helpers/v2-check-tables';

vi.mock('server-only', () => ({}));

const { readAgencyAccounts } = await import('./read');

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 300_000);
afterAll(async () => {
  await db?.close();
});

const PERIOD_END = '2026-11-26T15:00:00.000Z';

/**
 * A person with an agency account: on the trial with its subscription mirrored with `cancel`, or,
 * for `null`, Free with none.
 */
async function trialist(cancel: boolean | null) {
  const userId = await signUp(db, `trialist-${randomUUID()}@example.com`);
  const answer = await asRole(db, 'service_role', null, async (tx) => {
    const { rows } = await tx.query<{ r: { account_id: string } }>(
      `select public.start_agency_trial_account($1, 'Summit Digital', 'client.example') as r`,
      [userId],
    );
    return rows[0]!.r;
  });
  const accountId = answer.account_id;
  // With no subscription the account stays Free: the trial states require one (accounts_subscription).
  if (cancel === null) return { userId, accountId };
  const sub = `sub_${randomUUID().replace(/-/g, '')}`;
  await db.query(
    `insert into public.subscriptions
       (id, account_id, status, plan, interval, current_period_end, trial_end, cancel_at_period_end)
     values ($1, $2, 'trialing', 'agency', 'month', $3, $3, $4)`,
    [sub, accountId, PERIOD_END, cancel],
  );
  await db.query(
    `update public.accounts
        set state = 'agency_trial', tier = 'agency', trial_variant = 'card_required',
            trial_ends_at = $2, trial_used_at = now(), current_subscription_id = $3,
            state_history = state_history || jsonb_build_array(
              jsonb_build_object('state', 'agency_trial', 'since', now()))
      where id = $1`,
    [accountId, PERIOD_END, sub],
  );
  return { userId, accountId };
}

const read = (userId: string) =>
  readAgencyAccounts(postgrestOver(db, { as: { userId } }) as never, userId);

describe('readAgencyAccounts, as the person', () => {
  it('a trial set to cancel: billingEnd is the mirror’s current_period_end', async () => {
    const t = await trialist(true);
    const rows = await read(t.userId);
    expect(rows.map((r) => [r.id, r.state, r.billingEnd?.toISOString() ?? null])).toEqual([
      [t.accountId, 'agency_trial', PERIOD_END],
    ]);
  });

  it('a trial not set to cancel: billingEnd is null', async () => {
    const t = await trialist(false);
    const [row] = await read(t.userId);
    expect(row!.subscriptionId).toMatch(/^sub_/);
    expect(row!.billingEnd).toBeNull();
  });

  it('no subscription followed: billingEnd is null', async () => {
    const t = await trialist(null);
    const [row] = await read(t.userId);
    expect(row!.subscriptionId).toBeNull();
    expect(row!.billingEnd).toBeNull();
  });

  it('another person’s cancelled trial is not read', async () => {
    const t = await trialist(true);
    const stranger = await signUp(db, `stranger-${randomUUID()}@example.com`);
    expect(
      await readAgencyAccounts(postgrestOver(db, { as: { userId: stranger } }) as never, t.userId),
    ).toEqual([]);
  });
});
