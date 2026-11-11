/**
 * The accounts the delete step lists (CC-27b D6, plan-revision R2), on PGlite with every migration
 * applied, read from the erasure's own `erase_person_plan` (section B).
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { FIX_EMAIL_REQUESTS } from '../../../__tests__/helpers/v2-027b-standins';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../../__tests__/helpers/postgrest-pglite';
import { personalAccount, signUp } from '../../../__tests__/helpers/v2-check-tables';
import { deletionAccounts } from './deletion-plan';

let db: PGlite;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  // erase_person_plan reads CC-26b's fix_email_requests, not yet on this branch's migrations.
  await db.exec(FIX_EMAIL_REQUESTS);
}, 300_000);

const site = (accountId: string, host: string, at: string) =>
  db.query(`insert into public.sites (account_id, host, created_at) values ($1, $2, $3)`, [
    accountId,
    host,
    at,
  ]);

describe('deletionAccounts', () => {
  it('names the account by its oldest live site, not a newer one or a removed one', async () => {
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

  it('a staging copy older than the primary site does not name the account', async () => {
    const userId = await signUp(db, `staging-${randomUUID().slice(0, 8)}@example.com`);
    const { accountId } = await personalAccount(db, userId);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.sites (account_id, host, created_at) values ($1, 'primary.example', '2026-10-02T00:00:00Z')
       returning id`,
      [accountId],
    );
    await db.query(
      `insert into public.sites (account_id, host, created_at, staging_of_site_id)
       values ($1, 'staging.primary.example', '2026-10-01T00:00:00Z', $2)`,
      [accountId, rows[0]!.id],
    );
    expect(await deletionAccounts(postgrestOver(db), userId)).toEqual([
      { accountId, host: 'primary.example' },
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
