import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../../__tests__/helpers/postgrest-pglite';
import { personalAccount, signUp } from '../../../__tests__/helpers/v2-check-tables';
import { addSeat, makePaid, person } from '../account/sites-test-support';
import { hashToken } from '../account/tokens';
import { supabaseMailStore } from './store';

/**
 * The mail handlers' port over the service-role client (store.ts), run through PostgREST's calls
 * against the migrated schema, as monitor/stores.test.ts runs the alert and summary stores: what
 * the trial reminder reads of an account (review: `marked` set to false survived every other test),
 * and what an invitation's mail reads and mints of a seat.
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

describe('supabaseMailStore: a seat’s invitation', () => {
  const NOW = new Date('2026-11-14T12:00:00.000Z');

  /** An Agency account named `name` with one invited seat, as `invite_seat` writes it. */
  async function invited(name: string | null = 'Summit Digital') {
    const owner = await person(db, 'ms-owner');
    await makePaid(db, owner.accountId, 'agency');
    await db.query(`update public.accounts set name = $2 where id = $1`, [owner.accountId, name]);
    const email = `ms-invitee-${randomUUID()}@example.com`;
    const { rows } = await db.query<{ r: { seat_id: string; seq: number } }>(
      `select public.invite_seat($1, $2, 'account_manager', null, 100, $3) as r`,
      [owner.accountId, email, NOW.toISOString()],
    );
    return { owner, email, seatId: rows[0]!.r.seat_id, seq: rows[0]!.r.seq };
  }

  it('reads the invited address and the account for the seat’s current invitation, and for no other number', async () => {
    const inv = await invited();
    const store = supabaseMailStore(client());
    expect(await store.seatInvitation(inv.seatId, inv.seq)).toEqual({
      recipient: inv.email,
      accountId: inv.owner.accountId,
      marked: false,
    });
    expect(await store.seatInvitation(inv.seatId, inv.seq + 1)).toBeNull();
    expect(await store.seatInvitation(randomUUID(), 1)).toBeNull();
    await db.query(`select public.resend_seat_invite($1, $2)`, [inv.seatId, inv.owner.accountId]);
    expect(await store.seatInvitation(inv.seatId, inv.seq)).toBeNull();
    expect(await store.seatInvitation(inv.seatId, inv.seq + 1)).toMatchObject({
      recipient: inv.email,
    });
  });

  it.each([
    [
      'deletion confirmed',
      `deletion_confirmed_at = now(), purge_after = now() + interval '7 days'`,
    ],
    ['deleted', 'deleted_at = now()'],
  ])('reads the invitation of an account %s as marked', async (_, set) => {
    const inv = await invited();
    await db.query(`update public.accounts set ${set} where id = $1`, [inv.owner.accountId]);
    expect((await supabaseMailStore(client()).seatInvitation(inv.seatId, inv.seq))?.marked).toBe(
      true,
    );
  });

  it('reads nothing for a seat that is active or removed, whatever number is asked', async () => {
    const inv = await invited();
    const member = await person(db, 'ms-member');
    const active = await addSeat(db, inv.owner.accountId, member, 'developer');
    await db.query(`select public.remove_seat($1, $2, $3)`, [
      inv.seatId,
      inv.owner.accountId,
      NOW.toISOString(),
    ]);
    const store = supabaseMailStore(client());
    for (const seq of [0, 1, 2]) {
      expect(await store.seatInvitation(active, seq)).toBeNull();
      expect(await store.seatInvitation(inv.seatId, seq)).toBeNull();
    }
  });

  it('mints the link with what the mail says, stores its hash, and answers null for a number that is not current', async () => {
    const inv = await invited('Kestrel Creative');
    const store = supabaseMailStore(client());
    const issued = await store.issueSeatInvite(inv.seatId, inv.seq, NOW);
    expect(issued).toEqual({
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      recipient: inv.email,
      accountName: 'Kestrel Creative',
      role: 'account_manager',
    });
    const stored = await db.query<{ invite_token_hash: string }>(
      `select invite_token_hash from public.seats where id = $1`,
      [inv.seatId],
    );
    expect(stored.rows[0]!.invite_token_hash).toBe(hashToken(issued!.token));
    expect(await store.issueSeatInvite(inv.seatId, inv.seq + 1, NOW)).toBeNull();
    expect(await store.issueSeatInvite(randomUUID(), 1, NOW)).toBeNull();
  });

  it('an account with no name gives the mail none', async () => {
    const inv = await invited(null);
    const issued = await supabaseMailStore(client()).issueSeatInvite(inv.seatId, inv.seq, NOW);
    expect(issued?.accountName).toBeNull();
  });
});
