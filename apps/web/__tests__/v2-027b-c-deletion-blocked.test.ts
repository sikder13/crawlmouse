import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations, asRole, freshDb } from './helpers/pglite-migrations';
import { FIX_EMAIL_REQUESTS } from './helpers/v2-027b-standins';
import { personalAccount, signUp } from './helpers/v2-check-tables';

/**
 * Migration 027b section C's `account_deletion_blocked` (CC-27b review, item 6): what the delete
 * step shows instead of a form the request would refuse. It answers the codes
 * `request_account_deletion` refuses with past the hostname, in its order: `email_change_pending`,
 * then `deletion_refusal`'s (`others_seated`, `v1_subscription`); null when none applies.
 */

let db: PGlite;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  await db.exec(FIX_EMAIL_REQUESTS);
}, 300_000);
afterAll(async () => db.close());

const blocked = async (accountId: string, userId: string) =>
  (
    await db.query<{ v: string | null }>(`select public.account_deletion_blocked($1, $2) v`, [
      accountId,
      userId,
    ])
  ).rows[0]!.v;

async function owner(tag: string) {
  const userId = await signUp(db, `${tag}-${crypto.randomUUID().slice(0, 8)}@example.com`);
  return { userId, ...(await personalAccount(db, userId)) };
}

describe('account_deletion_blocked', () => {
  it('is null for an owner alone on the account with nothing in the way', async () => {
    const o = await owner('clear');
    expect(await blocked(o.accountId, o.userId)).toBeNull();
  });

  it('others_seated when another person has an active seat', async () => {
    const o = await owner('shared');
    const other = await signUp(db, `other-${crypto.randomUUID().slice(0, 8)}@example.com`);
    await db.query(
      `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
       values ($1, $2, 'm@example.com', 'account_manager', 'active', now())`,
      [o.accountId, other],
    );
    expect(await blocked(o.accountId, o.userId)).toBe('others_seated');
  });

  it('v1_subscription while users.pro_until is in the future', async () => {
    const o = await owner('v1');
    await db.query(`update public.users set pro_until = now() + interval '3 days' where id = $1`, [
      o.userId,
    ]);
    expect(await blocked(o.accountId, o.userId)).toBe('v1_subscription');
  });

  it('email_change_pending while an email change is in flight, before the others', async () => {
    const o = await owner('pending');
    await db.query(`update public.users set pro_until = now() + interval '3 days' where id = $1`, [
      o.userId,
    ]);
    await db.query(
      `select public.create_account_token($1, $2, 'email_change', now() + interval '1 hour', 'new@example.com', 'old@example.com', null)`,
      [o.accountId, o.userId],
    );
    expect(await blocked(o.accountId, o.userId)).toBe('email_change_pending');
  });

  it('is the service role’s alone', async () => {
    const o = await owner('grants');
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(
        asRole(db, role, role === 'anon' ? null : o.userId, (tx) =>
          tx.query(`select public.account_deletion_blocked($1, $2)`, [o.accountId, o.userId]),
        ),
      ).rejects.toThrow(/permission denied/);
    }
    await expect(
      asRole(db, 'service_role', null, (tx) =>
        tx.query(`select public.account_deletion_blocked($1, $2)`, [o.accountId, o.userId]),
      ),
    ).resolves.toBeDefined();
  });
});
