import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  compareFingerprints,
  fingerprintSql,
  formatDifferences,
  readFingerprint,
  type Fingerprint,
} from './fingerprint';
import { migratedDb, partitionOf, pgliteDb, withRollback } from './test-support';

const SECTIONS = [
  'acls',
  'buckets',
  'columns',
  'constraints',
  'default_acls',
  'functions',
  'indexes',
  'policies',
  'publications',
  'relations',
  'rls',
  'roles',
  'schemas',
  'triggers',
  'types',
];

let db: PGlite;
let base: Fingerprint;
beforeAll(async () => {
  db = await migratedDb();
  base = await readFingerprint(pgliteDb(db));
}, 180_000);

const differingSections = (a: Fingerprint, b: Fingerprint) =>
  compareFingerprints(a, b).map((d) => d.section);

describe('the fingerprint', () => {
  it('returns every section, even an empty one', () => {
    expect([...base.keys()]).toEqual(SECTIONS);
    expect(base.get('types')!.items).toBe(0);
    expect(base.get('columns')!.items).toBeGreaterThan(500);
  });

  it('is equal for two databases migrated independently', async () => {
    const other = await migratedDb();
    expect(compareFingerprints(base, await readFingerprint(pgliteDb(other)))).toEqual([]);
  }, 180_000);

  it('does not depend on the order of aclitems', async () => {
    const make = async (order: string[]) =>
      withRollback(db, async (tx) => {
        await tx.exec('create table public.zz_acl_order (id int)');
        await tx.exec('revoke all on public.zz_acl_order from anon, authenticated, service_role');
        for (const role of order) await tx.exec(`grant select on public.zz_acl_order to ${role}`);
        const [acl] = await tx.query<{ relacl: string }>(
          `select relacl::text from pg_class where oid = 'public.zz_acl_order'::regclass`,
        );
        return { acl: acl!.relacl, fp: await readFingerprint(tx) };
      });
    const a = await make(['anon', 'authenticated']);
    const b = await make(['authenticated', 'anon']);
    expect(a.acl).not.toEqual(b.acl);
    expect(compareFingerprints(a.fp, b.fp)).toEqual([]);
  });

  it('does not depend on the session search_path, because the file sets it for itself', async () => {
    const under = (path: string, sql?: string) =>
      withRollback(db, async (tx) => {
        await tx.exec(`set local search_path = ${path}`);
        return readFingerprint(tx, sql);
      });
    expect(
      compareFingerprints(await under('pg_catalog'), await under('public, extensions')),
    ).toEqual([]);

    // Without the set_config the same two sessions disagree: that call is what makes it hold.
    const unpinned = fingerprintSql().replace(
      "set_config('search_path', 'pg_catalog', true)",
      "'unpinned'::text",
    );
    expect(unpinned).not.toEqual(fingerprintSql());
    const diff = differingSections(
      await under('pg_catalog', unpinned),
      await under('public, extensions', unpinned),
    );
    expect(diff.length).toBeGreaterThan(0);
  });
});

describe('each section detects a change of its own kind, and names it', () => {
  it.each([
    ['alter table public.sites add column zz text', ['columns']],
    ['alter table research.check_runs add column zz text', ['columns']],
    ['alter table public.sites add constraint zz check (true)', ['constraints']],
    ['create index zz on public.sites (host)', ['indexes']],
    ["create function public.zz() returns int language sql as 'select 1'", ['acls', 'functions']],
    ['create policy zz on public.sites for select to anon using (false)', ['policies']],
    ['create policy zz on storage.objects for select to anon using (false)', ['policies']],
    [
      'create trigger zz before insert on public.sites for each statement execute function public.accounts_keep_first_history_entry()',
      ['triggers'],
    ],
    ['alter table public.sites force row level security', ['rls']],
    ['revoke select (client_scope_all) on public.seats from authenticated', ['acls']],
    ['grant usage on schema research to authenticated', ['acls']],
    ['alter role crawl_worker createdb', ['roles']],
    ['revoke crawl_worker from authenticator', ['roles']],
    ["update storage.buckets set public = true where id = 'reports'", ['buckets']],
    ["create type public.zz as enum ('a')", ['types']],
    // The reviewers' list of what an earlier version could not see.
    ['drop trigger on_auth_user_created on auth.users', ['triggers']],
    ['alter table storage.objects disable row level security', ['rls']],
    ['alter default privileges in schema public grant all on sequences to anon', ['default_acls']],
    [
      'alter default privileges in schema public revoke all on tables from authenticated',
      ['default_acls'],
    ],
    ['grant service_role to authenticated', ['roles']],
    ['grant authenticated to anon', ['roles']],
    ['alter role authenticated bypassrls', ['roles']],
    ['alter role anon set statement_timeout = 0', ['roles']],
    [
      'revoke crawl_worker from authenticator; grant crawl_worker to authenticator with set false',
      ['roles'],
    ],
    ['alter role crawl_worker set search_path = public', ['roles']],
    ['alter role crawl_worker connection limit 3', ['roles']],
    ['grant all on storage.objects to public', ['acls']],
    ['revoke all on storage.buckets from authenticated', ['acls']],
    ['create schema zz', ['schemas']],
    ['create publication zz for table public.sites', ['publications']],
    ['alter table public.sites alter column client_name type text collate "C"', ['columns']],
    ['alter table public.sites replica identity full', ['relations']],
  ])('%s', async (mutation, sections) => {
    const after = await withRollback(db, async (tx) => {
      await tx.exec(mutation);
      return readFingerprint(tx);
    });
    expect(differingSections(base, after)).toEqual(sections);
  });

  it('a trigger argument changes the triggers section and never appears in its lines', async () => {
    const after = await withRollback(db, async (tx) => {
      await tx.exec(`create trigger zz_hook after insert on public.sites for each statement
        execute function public.accounts_keep_first_history_entry('Bearer sk_test_secret_value')`);
      return readFingerprint(tx);
    });
    expect(differingSections(base, after)).toEqual(['triggers']);
    const lines = [...after.values()].flatMap((s) => s.lines).join('\n');
    expect(lines).toContain('public.sites zz_hook enabled=O definition=');
    expect(lines).not.toContain('sk_test_secret_value');
  });

  it('a grant on one partition changes the acls section', async () => {
    const name = await partitionOf(db, 'public_page_results');
    const after = await withRollback(db, async (tx) => {
      await tx.exec(`grant select on partitions.${name} to anon`);
      return readFingerprint(tx);
    });
    expect(differingSections(base, after)).toEqual(['acls']);
  });

  it('more or other months of partitions do not change it', async () => {
    const after = await withRollback(db, async (tx) => {
      const [before] = await tx.query<{ n: number }>(
        `select count(*)::int as n from pg_class where relnamespace = 'partitions'::regnamespace`,
      );
      await tx.exec(`select public.v2_premake_month_partitions('2031-01-01', '2031-04-01')`);
      const [later] = await tx.query<{ n: number }>(
        `select count(*)::int as n from pg_class where relnamespace = 'partitions'::regnamespace`,
      );
      expect(later!.n).toBeGreaterThan(before!.n);
      return readFingerprint(tx);
    });
    expect(compareFingerprints(base, after)).toEqual([]);
  });

  it('a database without the earliest month, as a branch built a month later is, matches', async () => {
    const earliest = await partitionOf(db, 'public_page_results');
    const after = await withRollback(db, async (tx) => {
      await tx.exec(`drop table partitions.${earliest}`);
      return readFingerprint(tx);
    });
    expect(compareFingerprints(base, after)).toEqual([]);
  });

  it('a role setting changes the roles section and its value never appears in the lines', async () => {
    const after = await withRollback(db, async (tx) => {
      await tx.exec(`alter role authenticator set app.webhook_key = 'sk_test_role_secret'`);
      return readFingerprint(tx);
    });
    expect(differingSections(base, after)).toEqual(['roles']);
    const lines = [...after.values()].flatMap((s) => s.lines).join('\n');
    expect(lines).toContain('app.webhook_key=md5:');
    expect(lines).not.toContain('sk_test_role_secret');
  });

  it.each([
    ['create schema realtime', 'a schema of Supabase'],
    [
      'create table auth.zz_new (id int); alter table auth.zz_new enable row level security',
      'a new auth table',
    ],
    [
      'create table public.zz_pub (id int); create publication zz for table public.zz_pub; drop table public.zz_pub',
      'a publication holding no app table',
    ],
    [
      'alter default privileges in schema auth grant all on tables to anon',
      'default privileges in a schema of Supabase',
    ],
  ])('ignores what Supabase manages: %s (%s)', async (mutation) => {
    const after = await withRollback(db, async (tx) => {
      await tx.exec(mutation);
      return readFingerprint(tx);
    });
    expect(compareFingerprints(base, after)).toEqual([]);
  });

  it('a new view changes the relations section', async () => {
    const after = await withRollback(db, async (tx) => {
      await tx.exec('create view public.zz as select 1 as x');
      return readFingerprint(tx);
    });
    expect(differingSections(base, after)).toContain('relations');
  });
});

describe('SUPABASE_MANAGED_MEMBERS: memberships Supabase grants a new branch', () => {
  // What a branch built on 2026-11-06 held and production did not (docs/ops/db-migrations.md §5).
  const GRANT_AS_ON_A_BRANCH =
    'create role supabase_realtime_admin noinherit; ' +
    'grant anon, authenticated, service_role to supabase_realtime_admin with inherit false';
  const MANAGED_LINES = ['anon', 'authenticated', 'service_role'].map(
    (r) => `supabase_realtime_admin member of ${r} admin=f inherit=f set=t`,
  );
  const roleLines = (fp: Fingerprint) => fp.get('roles')!.lines;

  it('ignores supabase_realtime_admin as a member of anon, authenticated and service_role', async () => {
    const after = await withRollback(db, async (tx) => {
      await tx.exec(GRANT_AS_ON_A_BRANCH);
      return readFingerprint(tx);
    });
    expect(compareFingerprints(base, after)).toEqual([]);
  });

  it('the exclusion list is what hides them: without its entry the three lines show', async () => {
    const unlisted = fingerprintSql().replace(
      "values ('supabase_realtime_admin')",
      "values ('zz_no_such_role')",
    );
    expect(unlisted).not.toEqual(fingerprintSql());
    const [without, after] = await withRollback(db, async (tx) => {
      const before = await readFingerprint(tx, unlisted);
      await tx.exec(GRANT_AS_ON_A_BRANCH);
      return [before, await readFingerprint(tx, unlisted)] as const;
    });
    expect(differingSections(without, after)).toEqual(['roles']);
    expect(roleLines(after).filter((l) => !roleLines(without).includes(l))).toEqual(MANAGED_LINES);
  });

  // The list matches the member's name exactly; vary the name to show nothing near it is hidden.
  it.each([
    'zz_invented_member',
    'supabase_realtime_admin_2',
    'xsupabase_realtime_admin',
    '"Supabase_Realtime_Admin"',
    'supabase_admin_realtime',
  ])('a membership by %s still shows in the roles section', async (member) => {
    const after = await withRollback(db, async (tx) => {
      await tx.exec(`create role ${member} noinherit; grant authenticated to ${member}`);
      return readFingerprint(tx);
    });
    expect(differingSections(base, after)).toEqual(['roles']);
    // The membership line itself, not only the role's own line (which some of these names have).
    const name = member.replace(/"/g, '');
    expect(roleLines(after)).toContain(`${name} member of authenticated admin=f inherit=f set=t`);
  });

  it('supabase_realtime_admin granted to a client role (it is the role, not the member) still shows', async () => {
    const after = await withRollback(db, async (tx) => {
      await tx.exec(
        'create role supabase_realtime_admin; grant supabase_realtime_admin to authenticated',
      );
      return readFingerprint(tx);
    });
    expect(differingSections(base, after)).toEqual(['roles']);
  });

  it.each([
    // The owner's own privileges are part of a table's ACL, so ownership shows in both.
    [
      'owning a table',
      'alter table public.sites owner to supabase_realtime_admin',
      ['acls', 'relations'],
    ],
    [
      'holding a grant on a table',
      'grant select on public.sites to supabase_realtime_admin',
      ['acls'],
    ],
    [
      'holding a grant on a column',
      'grant update (client_name) on public.sites to supabase_realtime_admin',
      ['acls'],
    ],
    [
      'holding execute on a function',
      'grant execute on function public.is_member(uuid) to supabase_realtime_admin',
      ['acls'],
    ],
  ])(
    'the exclusion is by member name only: supabase_realtime_admin %s is still seen',
    async (_label, mutation, sections) => {
      const after = await withRollback(db, async (tx) => {
        await tx.exec(`${GRANT_AS_ON_A_BRANCH}; ${mutation}`);
        return readFingerprint(tx);
      });
      expect(differingSections(base, after)).toEqual(sections);
    },
  );
});

describe('formatDifferences', () => {
  it('names the section and its lines, and says how many lines it withheld', () => {
    const lines = Array.from({ length: 25 }, (_, i) => `line ${String(i).padStart(2, '0')}`);
    const a: Fingerprint = new Map([['columns', { md5: 'a', items: 0, lines: [] }]]);
    const b: Fingerprint = new Map([['columns', { md5: 'b', items: 25, lines }]]);
    const text = formatDifferences(compareFingerprints(a, b), {
      expected: 'production',
      actual: 'branch',
    });
    expect(text).toContain('section columns: 25 only on branch, 0 only on production');
    expect(text).toContain('+ line 19');
    expect(text).not.toContain('+ line 20');
    expect(text).toContain('+ ... 5 more not shown');
  });
});
