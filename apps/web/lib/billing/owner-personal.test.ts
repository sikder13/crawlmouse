import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations, freshDb } from '../../__tests__/helpers/pglite-migrations';
import { addSeat, person, sessionOver } from '../v2/account/sites-test-support';
import { agencyAccount } from '../v2/agency/test-support';
import { ownedAccountId, ownPersonalAccountId } from './owner';

// The two resolvers over the real seats and accounts tables, as the caller: a person who owns their
// personal account and an agency account, the person CC-31's switcher exists for.

let db: PGlite;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 120_000);
afterAll(async () => db.close());

/** A person who also owns an agency account. */
async function agencyOwner(tag: string) {
  const p = await person(db, tag);
  return { ...p, agencyId: (await agencyAccount(db, p)).accountId };
}

describe('ownPersonalAccountId', () => {
  it('is the personal account of a person who owns an agency account too', async () => {
    const p = await agencyOwner('both');
    expect(await ownPersonalAccountId(sessionOver(db, p), p.id)).toEqual({
      ok: true,
      accountId: p.accountId,
    });
  });

  it('is 403 for a person who owns no account, a manager elsewhere included', async () => {
    const owner = await person(db, 'host');
    const guest = await person(db, 'guest');
    await db.query(`update public.seats set role = 'account_manager' where id = $1`, [
      guest.seatId,
    ]);
    await addSeat(db, owner.accountId, guest, 'account_manager');
    expect(await ownPersonalAccountId(sessionOver(db, guest), guest.id)).toEqual({
      ok: false,
      status: 403,
      error: 'not_owner',
    });
  });
});

describe('ownedAccountId, for a person who owns two accounts', () => {
  it('is ambiguous with no choice, and the chosen one with either choice', async () => {
    const p = await agencyOwner('chooser');
    const sb = sessionOver(db, p);
    expect(await ownedAccountId(sb, p.id)).toEqual({
      ok: false,
      status: 409,
      error: 'account_ambiguous',
    });
    expect(await ownedAccountId(sb, p.id, p.agencyId)).toEqual({ ok: true, accountId: p.agencyId });
    expect(await ownedAccountId(sb, p.id, p.accountId)).toEqual({
      ok: true,
      accountId: p.accountId,
    });
  });

  it('acting in an account the caller only manages is 403, not one of the two they own', async () => {
    const p = await agencyOwner('manager-elsewhere');
    const other = await person(db, 'other-owner');
    await addSeat(db, other.accountId, p, 'account_manager');
    expect(await ownedAccountId(sessionOver(db, p), p.id, other.accountId)).toEqual({
      ok: false,
      status: 403,
      error: 'not_owner',
    });
  });
});
