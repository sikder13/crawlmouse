/**
 * The accounts the delete step lists (CC-27b D6, plan-revision R2), on PGlite with every migration
 * applied. `erase_person_plan` is workstream B's (section B); until that merges, this file creates a
 * stand-in that answers the plan's `accounts` key in its jsonb shape, the only key read here, from
 * the person's owner seats.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../../__tests__/helpers/postgrest-pglite';
import { personalAccount, signUp } from '../../../__tests__/helpers/v2-check-tables';
import { deletionAccounts } from './deletion-plan';

let db: PGlite;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int n from pg_proc where proname = 'erase_person_plan'`,
  );
  if (rows[0]!.n === 0) {
    await db.exec(`
      create function public.erase_person_plan(p_user uuid, p_email text) returns json
      language sql stable as $$
        select json_build_object('accounts', coalesce(json_agg(s.account_id::text order by s.account_id::text), '[]'::json),
                                 'refusals', '[]'::json)
          from public.seats s where s.user_id = p_user and s.role = 'owner' and s.status = 'active'
      $$;`);
  }
}, 300_000);

const site = (accountId: string, host: string, at: string) =>
  db.query(`insert into public.sites (account_id, host, created_at) values ($1, $2, $3)`, [
    accountId,
    host,
    at,
  ]);

describe('deletionAccounts', () => {
  it('names the account by its oldest live primary site, not a newer one, a staging copy or a removed one', async () => {
    const userId = await signUp(db, `del-${randomUUID().slice(0, 8)}@example.com`);
    const { accountId } = await personalAccount(db, userId);
    await site(accountId, 'newer.example', '2026-10-02T00:00:00Z');
    await site(accountId, 'oldest.example', '2026-10-01T00:00:00Z');
    await db.query(
      `insert into public.sites (account_id, host, created_at, removed_at) values ($1, 'gone.example', '2026-09-01T00:00:00Z', now())`,
      [accountId],
    );
    expect(await deletionAccounts(postgrestOver(db), userId)).toEqual([
      { accountId, host: 'oldest.example' },
    ]);
  });

  it('an account with no site is named by none', async () => {
    const userId = await signUp(db, `nosite-${randomUUID().slice(0, 8)}@example.com`);
    const { accountId } = await personalAccount(db, userId);
    expect(await deletionAccounts(postgrestOver(db), userId)).toEqual([{ accountId, host: null }]);
  });

  it('another person’s account is not listed', async () => {
    const me = await signUp(db, `me-${randomUUID().slice(0, 8)}@example.com`);
    const other = await signUp(db, `other-${randomUUID().slice(0, 8)}@example.com`);
    const mine = await personalAccount(db, me);
    const theirs = await personalAccount(db, other);
    await site(theirs.accountId, 'theirs.example', '2026-10-01T00:00:00Z');
    expect((await deletionAccounts(postgrestOver(db), me)).map((a) => a.accountId)).toEqual([
      mine.accountId,
    ]);
  });
});
