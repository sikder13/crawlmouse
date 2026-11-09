import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  applyAllMigrations,
  freshDb,
  migrationFiles,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';

// B-F2: public.users references auth.users on delete cascade, so deleting an auth user (what
// scripts/ops/erase-account.ts does through the Auth admin API) takes the profile and everything
// that cascades from it.

const FILE = migrationFiles().find((f) => f.endsWith('_users_auth_cascade.sql'))!;
const ROLLBACK = FILE.replace(/\.sql$/, '.revert.sql');

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 300_000);

const one = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0];

describe('users_id_auth_fkey (B-F2)', () => {
  it('is a validated foreign key from public.users(id) to auth.users(id), on delete cascade', async () => {
    expect(
      await one(
        `select confrelid::regclass::text as ref, confdeltype as on_delete, convalidated as valid,
                pg_get_constraintdef(oid) as def
           from pg_constraint where conname = 'users_id_auth_fkey' and conrelid = 'public.users'::regclass`,
      ),
    ).toEqual({
      ref: 'auth.users',
      on_delete: 'c',
      valid: true,
      def: 'FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE',
    });
  });

  it("deleting the auth user deletes the profile and what cascades from it, and leaves another user's rows", async () => {
    const id = randomUUID();
    const other = randomUUID();
    await db.query(
      `insert into auth.users (id, email) values ($1, 'gone@example.com'), ($2, 'stays@example.com')`,
      [id, other],
    );
    const audit = randomUUID();
    await db.query(
      `insert into public.audits (id, user_id, url, status) values ($1, $2, 'https://example.com', 'completed')`,
      [audit, id],
    );
    await db.query(`delete from auth.users where id = $1`, [id]);
    const left = await one<Record<string, number>>(
      `select (select count(*)::int from public.users where id = $1) as users,
              (select count(*)::int from public.audits where id = $2) as audits,
              (select count(*)::int from public.seats where user_id = $1) as seats,
              (select count(*)::int from public.users where id = $3) as other_user,
              (select count(*)::int from public.seats where user_id = $3) as other_seats`,
      [id, audit, other],
    );
    expect(left).toEqual({ users: 0, audits: 0, seats: 0, other_user: 1, other_seats: 1 });
  });

  it('refuses a profile with no auth user', async () => {
    await expect(
      db.query(`insert into public.users (id, email) values ($1, 'orphan@example.com')`, [
        randomUUID(),
      ]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('fails to apply over an existing orphan, rather than leaving the key unvalidated', async () => {
    const before = await freshDb();
    await applyAllMigrations(before, undefined, (f) => f < FILE);
    await before.query(`insert into public.users (id, email) values ($1, 'orphan@example.com')`, [
      randomUUID(),
    ]);
    await expect(before.exec(readMigration(FILE))).rejects.toMatchObject({ code: '23503' });
    await before.close();
  }, 300_000);

  it('can be applied twice, and its rollback twice, without an error', async () => {
    const twice = await freshDb();
    await applyAllMigrations(twice);
    await twice.exec(readMigration(FILE));
    const count = async () =>
      (
        await twice.query(
          `select 1 from pg_constraint where conname = 'users_id_auth_fkey' and conrelid = 'public.users'::regclass`,
        )
      ).rows.length;
    expect(await count()).toBe(1);
    await twice.exec(readRollback(ROLLBACK));
    await twice.exec(readRollback(ROLLBACK));
    expect(await count()).toBe(0);
    await twice.close();
  }, 300_000);
});
