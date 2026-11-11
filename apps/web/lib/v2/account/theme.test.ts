/**
 * The theme write on the database (CC-26b D10), on PGlite with every migration applied, through the
 * PostgREST stand-in as the service role, as the route makes it.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../../__tests__/helpers/postgrest-pglite';
import { personalAccount, signUp } from '../../../__tests__/helpers/v2-check-tables';
import { saveTheme, ThemeBody } from './theme';

let db: PGlite;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 300_000);

const themes = async (userId: string) =>
  (
    await db.query<{ status: string; theme: string }>(
      `select status, theme from public.seats where user_id = $1 order by status`,
      [userId],
    )
  ).rows;

describe('saveTheme', () => {
  it('sets every active seat of the caller, and leaves another person’s seat on the same account as it was', async () => {
    const me = await signUp(db, `me-${randomUUID().slice(0, 8)}@example.com`);
    const mine = await personalAccount(db, me);
    const other = await signUp(db, `other-${randomUUID().slice(0, 8)}@example.com`);
    const theirs = await personalAccount(db, other);
    // I also sit on their account, and they on mine.
    await db.query(
      `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
       values ($1, $2, 'me@example.com', 'developer', 'active', now()),
              ($3, $4, 'other@example.com', 'developer', 'active', now())`,
      [theirs.accountId, me, mine.accountId, other],
    );
    await saveTheme(postgrestOver(db), me, 'dark');
    expect(await themes(me)).toEqual([
      { status: 'active', theme: 'dark' },
      { status: 'active', theme: 'dark' },
    ]);
    expect(await themes(other)).toEqual([
      { status: 'active', theme: 'system' },
      { status: 'active', theme: 'system' },
    ]);
  });

  it('leaves the caller’s removed seat as it was', async () => {
    const me = await signUp(db, `rm-${randomUUID().slice(0, 8)}@example.com`);
    await personalAccount(db, me);
    const owner = await signUp(db, `own-${randomUUID().slice(0, 8)}@example.com`);
    const acct = await personalAccount(db, owner);
    await db.query(
      `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at, removed_at)
       values ($1, $2, 'rm@example.com', 'developer', 'removed', now(), now())`,
      [acct.accountId, me],
    );
    await saveTheme(postgrestOver(db), me, 'light');
    expect(await themes(me)).toEqual([
      { status: 'active', theme: 'light' },
      { status: 'removed', theme: 'system' },
    ]);
  });
});

describe('saveTheme for a caller with no active seat', () => {
  it('answers no_seat and writes nothing', async () => {
    const owner = await signUp(db, `own2-${randomUUID().slice(0, 8)}@example.com`);
    const acct = await personalAccount(db, owner);
    // A user with only a removed seat: their own personal account's seat is removed too.
    const me = await signUp(db, `gone-${randomUUID().slice(0, 8)}@example.com`);
    await db.query(
      `update public.seats set status = 'removed', removed_at = now() where user_id = $1`,
      [me],
    );
    await db.query(
      `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at, removed_at)
       values ($1, $2, 'gone@example.com', 'developer', 'removed', now(), now())`,
      [acct.accountId, me],
    );
    expect(await saveTheme(postgrestOver(db), me, 'dark')).toBe('no_seat');
    expect((await themes(me)).every((r) => r.theme === 'system')).toBe(true);
  });
});

describe('ThemeBody', () => {
  it('takes {theme} and nothing else', () => {
    expect(ThemeBody.safeParse({ theme: 'system' }).success).toBe(true);
    expect(ThemeBody.safeParse({ theme: 'dark', user_id: 'x' }).success).toBe(false);
    expect(ThemeBody.safeParse({ theme: 'blue' }).success).toBe(false);
  });
});
