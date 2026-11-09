import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PGlite, Transaction } from '@electric-sql/pglite';
import { describe, expect, it, vi } from 'vitest';
import { catalogSnapshot } from './helpers/catalog-snapshot';
import {
  applyAllMigrations,
  asRole,
  asWorker,
  freshDb,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';
import { personalAccount, signUp } from './helpers/v2-check-tables';

/**
 * Migration 20261108000002 (docs/specs/v2/sec-baseline.md, D6). With pg_temp left out of a SECURITY
 * DEFINER function's search_path, Postgres searches it first for relations and types, so a caller's
 * temp domain can stand in for a type the body names without its schema, and the domain's CHECK runs
 * as the function's owner. Each case below is a function a client or the worker role may call, made
 * to resolve a name through a temp domain whose CHECK raises with the role it runs as. The name can be
 * the body's own or one in a SQL function Postgres inlines into it (auth.uid(), auth.jwt()).
 */

// The first case in each state migrates its template database, which takes several seconds.
vi.setConfig({ testTimeout: 120_000 });

const MIGRATION = '20261108000002_v2_definer_search_path.sql';
const ROLLBACK = '20261108000002_v2_definer_search_path.revert.sql';
const CHECK_09 = readFileSync(
  resolve(__dirname, '../../../infra/supabase/checks/09-definer-search-path.sql'),
  'utf8',
);

let beforeTemplate: Promise<PGlite> | null = null;
let afterTemplate: Promise<PGlite> | null = null;

async function migrated(include: (f: string) => boolean): Promise<PGlite> {
  const db = await freshDb();
  await applyAllMigrations(db, undefined, include);
  return db;
}

/**
 * A fresh session (plpgsql compiles a function once per session) on the database before or after this
 * migration. Later migrations are left out of both, so the counts and the rollback's catalog compare
 * this file's change alone. Check 09 over every migration runs in scripts/db/check.test.ts ("all pass
 * on a database with every migration applied").
 */
async function database(state: 'before' | 'after'): Promise<PGlite> {
  const template =
    state === 'before'
      ? (beforeTemplate ??= migrated((f) => f < MIGRATION))
      : (afterTemplate ??= migrated((f) => f <= MIGRATION));
  return (await template).clone() as Promise<PGlite>;
}

/** For each type, a temp domain over `pg_catalog.<type>` named `<type>`, whose CHECK raises `RAN AS <role>`. */
async function plantDomains(tx: Transaction, ...types: string[]): Promise<void> {
  await tx.exec(`
    create function pg_temp.ran_as(v pg_catalog.text) returns boolean language plpgsql as $f$
    begin raise exception 'RAN AS %', current_user; end; $f$;
    ${types.map((t) => `create domain pg_temp.${t} as pg_catalog.${t} check (pg_temp.ran_as(value::pg_catalog.text));`).join('\n')}`);
}

/** The error a call raised, or null when it returned. */
async function errorOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

interface Vector {
  fn: string;
  call: (db: PGlite) => Promise<string | null>;
  /** The error before the migration: the caller's domain stood in for the catalog type. */
  before: string | RegExp;
}

const asMember = async (db: PGlite, type: string, sql: (account: string) => string) => {
  const userId = await signUp(db, `member-${type}@example.com`);
  const { accountId } = await personalAccount(db, userId);
  return errorOf(() =>
    asRole(db, 'authenticated', userId, async (tx) => {
      await plantDomains(tx, type);
      await tx.query(sql(accountId));
    }),
  );
};

const asCrawlWorker = (db: PGlite, type: string, sql: string) =>
  errorOf(() =>
    asWorker(db, {}, async (tx) => {
      await plantDomains(tx, type);
      await tx.query(sql);
    }),
  );

const REACHABLE: Vector[] = [
  // The membership helpers name no type themselves. They call auth.uid(), a plain SQL function that
  // Postgres inlines, and its `::uuid` cast is then resolved under the helper's search_path.
  {
    fn: 'is_member (authenticated), auth.uid() inlined: ::uuid',
    call: (db) => asMember(db, 'uuid', (a) => `select public.is_member('${a}')`),
    before: 'RAN AS postgres',
  },
  {
    fn: 'member_role (authenticated), auth.uid() inlined: ::uuid',
    call: (db) => asMember(db, 'uuid', (a) => `select public.member_role('${a}')`),
    before: 'RAN AS postgres',
  },
  {
    fn: 'is_member_for_site (authenticated), auth.uid() inlined: ::uuid',
    call: (db) => asMember(db, 'uuid', (a) => `select public.is_member_for_site('${a}')`),
    before: 'RAN AS postgres',
  },
  // The cast resolves to the caller's domain, and RETURN QUERY then refuses the result's shape before
  // any row is cast, so the domain's CHECK never runs: the name is taken over, no code runs as owner.
  {
    fn: 'usage_counts (authenticated), ::date',
    call: (db) => asMember(db, 'date', (a) => `select * from public.usage_counts('${a}')`),
    before: /^structure of query does not match function result type/,
  },
  // A variable's declared type resolves to the caller's domain, whose CHECK runs on assignment.
  {
    fn: 'crawl_worker_check_id (crawl_worker), a jsonb variable',
    call: (db) => asCrawlWorker(db, 'jsonb', 'select public.crawl_worker_check_id()'),
    before: 'RAN AS postgres',
  },
  {
    fn: 'crawl_worker_lineage_id (crawl_worker), a text variable',
    call: (db) => asCrawlWorker(db, 'text', 'select public.crawl_worker_lineage_id()'),
    before: 'RAN AS postgres',
  },
  {
    fn: 'crawl_worker_part_path_ok (crawl_worker), a uuid variable',
    call: (db) => asCrawlWorker(db, 'uuid', `select public.crawl_worker_part_path_ok('x')`),
    before: 'RAN AS postgres',
  },
];

describe("before 20261108000002: a caller's temp domain stands in for a catalog type", () => {
  it.each(REACHABLE.map((v) => [v.fn, v] as const))('%s', async (_, v) => {
    const db = await database('before');
    try {
      const error = await v.call(db);
      if (typeof v.before === 'string') expect(error).toBe(v.before);
      else expect(error).toMatch(v.before);
    } finally {
      await db.close();
    }
  });
});

describe('after 20261108000002: the same calls resolve the catalog type and return', () => {
  it.each(REACHABLE.map((v) => [v.fn, v] as const))('%s', async (_, v) => {
    const db = await database('after');
    try {
      expect(await v.call(db)).toBeNull();
    } finally {
      await db.close();
    }
  });
});

describe("search_path = '' still searches pg_temp first", () => {
  // A probe, not a production function: SECURITY DEFINER, owned by postgres, callable by
  // authenticated, with one variable whose type it names without a schema. With '' the caller's
  // temp domain named uuid stands in for it and the domain's CHECK runs as postgres; with pg_temp
  // named last, pg_catalog.uuid is found first and the call returns.
  it.each([
    ["''", 'RAN AS postgres'],
    ['pg_catalog, pg_temp', null],
  ])(
    'a definer function with search_path = %s and an unqualified uuid variable',
    async (path, want) => {
      const db = await database('after');
      try {
        await db.exec(`
        create function public.zz_unqualified_uuid() returns pg_catalog.text
          language plpgsql security definer set search_path = ${path} as $f$
          declare v uuid := '00000000-0000-0000-0000-000000000000';
          begin return v::pg_catalog.text; end; $f$;
        grant execute on function public.zz_unqualified_uuid() to authenticated;`);
        const error = await errorOf(() =>
          asRole(db, 'authenticated', null, async (tx) => {
            await plantDomains(tx, 'uuid');
            await tx.query('select public.zz_unqualified_uuid()');
          }),
        );
        expect(error).toBe(want);
      } finally {
        await db.close();
      }
    },
  );
});

describe('check 09', () => {
  it('finds the 20 definer functions before the migration and none after', async () => {
    const before = await database('before');
    const after = await database('after');
    try {
      const found = (await before.query<{ object: string }>(CHECK_09)).rows.map((r) => r.object);
      expect(found).toHaveLength(20);
      // 006c wrote search_path = '', which leaves pg_temp searched first as well.
      expect(found).toContain('public.start_trial_with_ledger(uuid, jsonb, jsonb)');
      expect((await after.query(CHECK_09)).rows).toEqual([]);
    } finally {
      await before.close();
      await after.close();
    }
  });

  const allowed = '; allowed: "pg_catalog, pg_temp", "pg_catalog, public, pg_temp"';
  it.each([
    ["set search_path = ''", [`search_path=""${allowed}`]],
    ['set search_path = pg_catalog, public, pg_temp', []],
    ['set search_path = pg_catalog, pg_temp', []],
    ['set search_path = pg_temp', [`search_path=pg_temp${allowed}`]],
    ['set search_path = public, pg_catalog', [`search_path=public, pg_catalog${allowed}`]],
    [
      'set search_path = pg_catalog, pg_temp, public',
      [`search_path=pg_catalog, pg_temp, public${allowed}`],
    ],
    [
      'set search_path = "$user", public, pg_temp',
      [`search_path="$user", public, pg_temp${allowed}`],
    ],
    ['set search_path = pg_catalog, my_pg_temp', [`search_path=pg_catalog, my_pg_temp${allowed}`]],
    ['', ['SECURITY DEFINER with no search_path setting']],
  ])('a definer function with %s', async (setting, problems) => {
    const db = await database('after');
    try {
      await db.exec('create schema if not exists my_pg_temp');
      for (const schema of ['public', 'research', 'partitions']) {
        await db.exec(
          `create function ${schema}.zz_probe() returns int language sql security definer ${setting} as $$ select 1 $$;`,
        );
      }
      const rows = (await db.query<{ object: string; problem: string }>(CHECK_09)).rows;
      expect(rows.map((r) => r.problem)).toEqual(problems.flatMap((p) => [p, p, p]));
      if (problems.length) {
        expect(rows.map((r) => r.object)).toEqual([
          'partitions.zz_probe()',
          'public.zz_probe()',
          'research.zz_probe()',
        ]);
      }
    } finally {
      await db.close();
    }
  });

  it('a client role, or PUBLIC, that may create objects in public is a finding', async () => {
    const db = await database('after');
    try {
      await db.exec('grant create on schema public to authenticated');
      expect((await db.query<{ object: string }>(CHECK_09)).rows.map((r) => r.object)).toEqual([
        'schema public: role authenticated',
      ]);
      await db.exec(
        'revoke create on schema public from authenticated; grant create on schema public to public',
      );
      const objects = (await db.query<{ object: string }>(CHECK_09)).rows.map((r) => r.object);
      expect(objects).toContain('schema public: PUBLIC');
      expect(objects).toContain('schema public: role anon');
    } finally {
      await db.close();
    }
  });

  it('an invoker function, and a definer function in another schema, are not its business', async () => {
    const db = await database('after');
    try {
      await db.exec(`create function public.zz_invoker() returns int language sql as $$ select 1 $$;
                     create schema zz_other;
                     create function zz_other.zz_definer() returns int language sql security definer as $$ select 1 $$;`);
      expect((await db.query(CHECK_09)).rows).toEqual([]);
    } finally {
      await db.close();
    }
  });
});

describe('the migration sets what it says and its rollback restores the catalog exactly', () => {
  it('every definer function in public searches pg_temp last; two of them name no other schema', async () => {
    const db = await database('after');
    try {
      const { rows } = await db.query<{ name: string; config: string[] }>(
        `select p.proname as name, p.proconfig as config from pg_proc p
          where p.prosecdef and p.pronamespace = 'public'::regnamespace order by 1`,
      );
      expect(rows).toHaveLength(20);
      for (const r of rows) {
        const path = r.config.find((c) => c.startsWith('search_path='));
        const want = ['start_trial_with_ledger', 'v2_premake_month_partitions'].includes(r.name)
          ? 'search_path=pg_catalog, pg_temp'
          : 'search_path=pg_catalog, public, pg_temp';
        expect(path, r.name).toBe(want);
      }
      // ALTER FUNCTION ... SET changes the setting it names and keeps the others, in their place.
      expect(rows.find((r) => r.name === 'start_trial_with_ledger')!.config).toEqual([
        'search_path=pg_catalog, pg_temp',
        'lock_timeout=3s',
      ]);
    } finally {
      await db.close();
    }
  });

  it('the rollback returns the catalog to the state before the migration', async () => {
    const before = await database('before');
    const after = await database('after');
    try {
      const pre = await catalogSnapshot(before);
      expect(await catalogSnapshot(after)).not.toEqual(pre); // anti-vacuity
      await after.exec(readRollback(ROLLBACK));
      expect(await catalogSnapshot(after)).toEqual(pre);
    } finally {
      await before.close();
      await after.close();
    }
  });

  it('applying it twice changes nothing more', async () => {
    const db = await database('after');
    try {
      const once = await catalogSnapshot(db);
      await db.exec(readMigration(MIGRATION));
      expect(await catalogSnapshot(db)).toEqual(once);
    } finally {
      await db.close();
    }
  });
});
