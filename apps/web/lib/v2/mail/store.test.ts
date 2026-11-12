import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../../__tests__/helpers/postgrest-pglite';
import { personalAccount, signUp } from '../../../__tests__/helpers/v2-check-tables';
import { supabaseMailStore } from './store';

/**
 * The mail handlers' port over the service-role client (store.ts), run through PostgREST's calls
 * against the migrated schema, as monitor/stores.test.ts runs the alert and summary stores: here, what
 * the trial reminder reads of an account (review: `marked` set to false survived every other test).
 */

let db: PGlite;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 300_000);
afterAll(async () => db.close());

const client = () => postgrestOver(db, { maxRows: 1000 });

async function trialAccount() {
  const email = `ms-${randomUUID()}@example.com`;
  const userId = await signUp(db, email);
  const { accountId } = await personalAccount(db, userId);
  await db.query(
    `update public.accounts
        set timezone = 'Europe/Berlin', state = 'pro_trial', tier = 'pro', trial_variant = 'no_card',
            trial_ends_at = now() + interval '7 days', trial_used_at = now(),
            state_history = state_history || jsonb_build_array(
              jsonb_build_object('state', 'pro_trial', 'since', now()))
      where id = $1`,
    [accountId],
  );
  return { accountId, email };
}

describe('supabaseMailStore.trialAccount', () => {
  it('reads an unmarked trial account and its owner’s address', async () => {
    const a = await trialAccount();
    const got = await supabaseMailStore(client()).trialAccount(a.accountId);
    expect(got).toMatchObject({
      state: 'pro_trial',
      trialVariant: 'no_card',
      timezone: 'Europe/Berlin',
      remind: true,
      marked: false,
      ownerEmail: a.email,
    });
  });

  it.each([
    [
      'deletion confirmed',
      `deletion_confirmed_at = now(), purge_after = now() + interval '7 days'`,
    ],
    ['deleted', 'deleted_at = now()'],
  ])('reads an account %s as marked', async (_, set) => {
    const a = await trialAccount();
    await db.query(`update public.accounts set ${set} where id = $1`, [a.accountId]);
    expect((await supabaseMailStore(client()).trialAccount(a.accountId))?.marked).toBe(true);
  });

  it('answers null for no such account', async () => {
    expect(await supabaseMailStore(client()).trialAccount(randomUUID())).toBeNull();
  });
});
