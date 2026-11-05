import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  compareFingerprints,
  fingerprintSql,
  formatDifferences,
  readFingerprint,
  type Fingerprint,
} from './fingerprint';
import { migratedDb, pgliteDb, withRollback } from './test-support';

const SECTIONS = [
  'acls',
  'buckets',
  'columns',
  'constraints',
  'functions',
  'indexes',
  'policies',
  'relations',
  'rls',
  'roles',
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
  ])('%s', async (mutation, sections) => {
    const after = await withRollback(db, async (tx) => {
      await tx.exec(mutation);
      return readFingerprint(tx);
    });
    expect(differingSections(base, after)).toEqual(sections);
  });

  it('a new view changes the relations section', async () => {
    const after = await withRollback(db, async (tx) => {
      await tx.exec('create view public.zz as select 1 as x');
      return readFingerprint(tx);
    });
    expect(differingSections(base, after)).toContain('relations');
  });
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
