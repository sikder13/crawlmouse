/**
 * Row 17's monthly count of full renders, on PGlite with every migration: take_full_render against
 * the plan's limit (10 on Pro, 30 on Agency), the same use for a retried step, a new month starting at
 * zero, a use given back, the account's erasure, and the privileges. PGlite has one connection, so the
 * advisory lock that makes concurrent takes wait their turn is not raced here.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, readMigration, readRollback } from './helpers/pglite-migrations';
import { accountOf, doorDb, signUp } from './v2/_lib/door-pglite';

const MIGRATION = '20261125000002_v2_a2_full_render_uses.sql';
const REVERT = '20261125000002_v2_a2_full_render_uses.revert.sql';
const FUNCTIONS = [
  'public.take_full_render(uuid, uuid, integer)',
  'public.give_back_full_render(uuid, uuid)',
  'public.full_renders_used(uuid)',
];

let db: PGlite;
let n = 0;
beforeAll(async () => {
  db = await doorDb();
}, 120_000);
afterAll(async () => {
  await db?.close();
});

async function account(): Promise<string> {
  return (await accountOf(db, await signUp(db, `fr-${++n}@example.com`))).id;
}
const take = (accountId: string, checkId: string, limit: number) =>
  asRole(db, 'service_role', null, async (tx) => {
    const { rows } = await tx.query<{ ok: boolean }>(
      `select public.take_full_render($1::uuid, $2::uuid, $3) as ok`,
      [accountId, checkId, limit],
    );
    return rows[0]!.ok;
  });
const giveBack = (accountId: string, checkId: string) =>
  asRole(db, 'service_role', null, (tx) =>
    tx.query(`select public.give_back_full_render($1::uuid, $2::uuid)`, [accountId, checkId]),
  );
const used = (accountId: string) =>
  asRole(db, 'service_role', null, async (tx) => {
    const { rows } = await tx.query<{ n: number }>(
      `select public.full_renders_used($1::uuid) as n`,
      [accountId],
    );
    return rows[0]!.n;
  });

describe('full_render_uses (row 17)', () => {
  it('takes uses up to the limit, then refuses, and counts them', async () => {
    const a = await account();
    const checks = Array.from({ length: 11 }, () => randomUUID());
    for (const c of checks.slice(0, 10)) expect(await take(a, c, 10)).toBe(true);
    expect(await take(a, checks[10]!, 10)).toBe(false);
    expect(await used(a)).toBe(10);
  });

  it('answers true again for a check that took one, without taking a second', async () => {
    const a = await account();
    const c = randomUUID();
    expect(await take(a, c, 1)).toBe(true);
    expect(await take(a, c, 1)).toBe(true);
    expect(await used(a)).toBe(1);
    expect(await take(a, randomUUID(), 1)).toBe(false);
  });

  it('refuses for a limit of zero or less, as Free has, and counts each account apart', async () => {
    const a = await account();
    const b = await account();
    expect(await take(a, randomUUID(), 0)).toBe(false);
    expect(await take(a, randomUUID(), -1)).toBe(false);
    expect(await take(b, randomUUID(), 1)).toBe(true);
    expect(await used(a)).toBe(0);
    expect(await used(b)).toBe(1);
  });

  it('counts this UTC month only: a use from an earlier month leaves this month’s whole', async () => {
    const a = await account();
    await db.query(
      `insert into public.full_render_uses (account_id, month, check_id) values ($1, '2020-01-01', $2)`,
      [a, randomUUID()],
    );
    expect(await used(a)).toBe(0);
    expect(await take(a, randomUUID(), 1)).toBe(true);
  });

  it('refuses a month that is not the first of one', async () => {
    const a = await account();
    await expect(
      db.query(
        `insert into public.full_render_uses (account_id, month, check_id) values ($1, '2026-11-02', $2)`,
        [a, randomUUID()],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('gives a use back, so the month has it again; a repeat changes nothing', async () => {
    const a = await account();
    const c = randomUUID();
    expect(await take(a, c, 1)).toBe(true);
    await giveBack(a, c);
    await giveBack(a, c);
    expect(await used(a)).toBe(0);
    expect(await take(a, randomUUID(), 1)).toBe(true);
  });

  it('goes with the account when the account is deleted', async () => {
    const a = await account();
    expect(await take(a, randomUUID(), 3)).toBe(true);
    await db.query(`delete from public.accounts where id = $1`, [a]);
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.full_render_uses where account_id = $1`,
      [a],
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('lets no client role call the functions or touch the table', async () => {
    for (const fn of FUNCTIONS) {
      const { rows } = await db.query<Record<string, boolean>>(
        `select has_function_privilege('anon', $1, 'execute') as anon,
                has_function_privilege('authenticated', $1, 'execute') as authed,
                has_function_privilege('service_role', $1, 'execute') as service`,
        [fn],
      );
      expect(rows[0], fn).toEqual({ anon: false, authed: false, service: true });
    }
    const a = await account();
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(
        asRole(db, role, null, (tx) => tx.query(`select * from public.full_render_uses`)),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asRole(db, role, null, (tx) =>
          tx.query(`select public.take_full_render($1::uuid, $2::uuid, 10)`, [a, randomUUID()]),
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('runs twice, and its revert runs twice and removes the table and the functions', async () => {
    const clone = (await db.clone()) as PGlite;
    try {
      await clone.exec(readMigration(MIGRATION));
      await clone.exec(readRollback(REVERT));
      await clone.exec(readRollback(REVERT));
      const { rows } = await clone.query<{ t: string | null; f: number }>(
        `select to_regclass('public.full_render_uses')::text as t,
                (select count(*)::int from pg_proc
                  where proname in ('take_full_render', 'give_back_full_render', 'full_renders_used')) as f`,
      );
      expect(rows[0]).toEqual({ t: null, f: 0 });
    } finally {
      await clone.close();
    }
  });
});
