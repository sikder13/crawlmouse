/**
 * `ops_recent_checks` (V2R inbox 023), on PGlite with every migration: what it shows, that no client
 * role can read it, and that the catalog check fails if a later migration opens it.
 */
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, readMigration, readRollback } from './helpers/pglite-migrations';
import { accountOf, anonymousCheck, doorDb, signUp } from './v2/_lib/door-pglite';

const MIGRATION = '20261122000004_v2_a2_ops_recent_checks.sql';
const REVERT = '20261122000004_v2_a2_ops_recent_checks.revert.sql';
const CATALOG = readFileSync(
  new URL('../../../infra/supabase/checks/01-client-table-privileges.sql', import.meta.url),
  'utf8',
);

let db: PGlite;
beforeAll(async () => {
  db = await doorDb();
}, 120_000);
afterAll(async () => {
  await db?.close();
});

const later = () => new Date(Date.now() + 60 * 60 * 1000);
const rowOf = async (id: string) =>
  (
    await db.query<Record<string, unknown>>(
      `select * from public.ops_recent_checks where check_id = $1`,
      [id],
    )
  ).rows[0]!;

describe('ops_recent_checks', () => {
  it('holds exactly these columns, none of them personal', async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'ops_recent_checks'
        order by ordinal_position`,
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      'host',
      'status',
      'trigger',
      'queued_at',
      'finished_at',
      'pages_read',
      'plan',
      'check_id',
    ]);
  });

  it('names the website and no account for a site nobody keeps, with no pages yet', async () => {
    const { checkId } = await anonymousCheck(db, 'unkept-view.example', later());
    expect(await rowOf(checkId)).toMatchObject({
      host: 'unkept-view.example',
      status: 'queued',
      trigger: 'first_audit',
      pages_read: null,
      plan: 'no account',
    });
  });

  it('reads the pages from the check’s coverage', async () => {
    const clone = (await db.clone()) as PGlite;
    try {
      const { checkId } = await anonymousCheck(clone, 'pages-view.example', later());
      // Only a finished check may hold coverage, and building one is not what this test is about.
      await clone.exec(`alter table public.checks drop constraint checks_coverage`);
      await clone.query(
        `update public.checks set coverage = jsonb_build_object('pages_crawled', 7) where id = $1`,
        [checkId],
      );
      const { rows } = await clone.query<{ pages_read: number }>(
        `select pages_read from public.ops_recent_checks where check_id = $1`,
        [checkId],
      );
      expect(rows[0]!.pages_read).toBe(7);
    } finally {
      await clone.close();
    }
  });

  it.each([
    ['a fraction', 7.5],
    ['a whole number written as a decimal', '7.0::jsonb'],
    ['text', 'abc'],
    ['a boolean', true],
    ['a list', [1]],
    ['a number past an integer', 2147483648],
  ])('one row whose pages are %s reads as null and breaks no other row', async (_name, bad) => {
    const clone = (await db.clone()) as PGlite;
    try {
      const { checkId } = await anonymousCheck(clone, 'bad-pages-view.example', later());
      await clone.exec(`alter table public.checks drop constraint checks_coverage`);
      const value = bad === '7.0::jsonb' ? '7.0' : JSON.stringify(bad);
      await clone.query(
        `update public.checks
            set coverage = jsonb_build_object('pages_crawled', $1::jsonb), queued_at = now() - interval '300 days'
          where id = $2`,
        [value, checkId],
      );
      await expect(
        clone.query(`select * from public.ops_recent_checks limit 1`),
      ).resolves.toBeDefined();
      const { rows } = await clone.query<{ pages_read: number | null }>(
        `select pages_read from public.ops_recent_checks where check_id = $1`,
        [checkId],
      );
      expect(rows[0]!.pages_read).toBeNull();
    } finally {
      await clone.close();
    }
  });

  it('grants one thing: SELECT, to the service role', async () => {
    const { rows } = await db.query<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'ops_recent_checks'
          and grantee <> 'postgres'`,
    );
    expect(rows).toEqual([{ grantee: 'service_role', privilege_type: 'SELECT' }]);
  });

  it('gives the plan of the account that keeps the site', async () => {
    const user = await signUp(db, 'ops-view@example.com');
    const account = await accountOf(db, user);
    const { checkId, siteId } = await anonymousCheck(db, 'kept-view.example', null);
    await db.query(`update public.sites set account_id = $1 where id = $2`, [account.id, siteId]);
    const { rows } = await db.query<{ tier: string }>(
      `select tier::text as tier from public.accounts where id = $1`,
      [account.id],
    );
    expect((await rowOf(checkId)).plan).toBe(rows[0]!.tier);
  });

  it('lists the newest first', async () => {
    const a = await anonymousCheck(db, 'older-view.example', later());
    const b = await anonymousCheck(db, 'newer-view.example', later());
    await db.query(`update public.checks set queued_at = now() + interval '1 day' where id = $1`, [
      a.checkId,
    ]);
    await db.query(`update public.checks set queued_at = now() + interval '2 days' where id = $1`, [
      b.checkId,
    ]);
    const { rows } = await db.query<{ host: string }>(
      `select host from public.ops_recent_checks limit 2`,
    );
    expect(rows.map((r) => r.host)).toEqual(['newer-view.example', 'older-view.example']);
  });

  it('reads with the rights of who asks', async () => {
    const { rows } = await db.query<{ options: string[] }>(
      `select c.reloptions as options from pg_class c
        where c.oid = 'public.ops_recent_checks'::regclass`,
    );
    expect(rows[0]!.options).toContain('security_invoker=true');
  });

  it.each(['anon', 'authenticated'] as const)('%s cannot read it', async (role) => {
    await expect(
      asRole(db, role, null, (tx) => tx.query(`select * from public.ops_recent_checks`)),
    ).rejects.toThrow(/permission denied/);
  });

  it('the service role can', async () => {
    await expect(
      asRole(db, 'service_role', null, (tx) => tx.query(`select 1 from public.ops_recent_checks`)),
    ).resolves.toBeDefined();
  });

  it.each(['anon', 'authenticated'] as const)(
    'the catalog check fails if a later migration grants it to %s',
    async (role) => {
      const clone = (await db.clone()) as PGlite;
      try {
        expect((await clone.query(CATALOG)).rows).toEqual([]);
        await clone.exec(`grant select on public.ops_recent_checks to ${role}`);
        const found = (await clone.query(CATALOG)).rows;
        expect(JSON.stringify(found)).toContain('ops_recent_checks');
      } finally {
        await clone.close();
      }
    },
  );

  it('the migration runs twice, and its revert runs twice and drops the view', async () => {
    const clone = (await db.clone()) as PGlite;
    try {
      await clone.exec(readMigration(MIGRATION));
      await clone.exec(readRollback(REVERT));
      await clone.exec(readRollback(REVERT));
      const { rows } = await clone.query<{ r: string | null }>(
        `select to_regclass('public.ops_recent_checks')::text as r`,
      );
      expect(rows[0]!.r).toBeNull();
    } finally {
      await clone.close();
    }
  });
});
