import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { catalogSnapshot } from './helpers/catalog-snapshot';
import {
  applyAllMigrations,
  asRole,
  asWorker,
  freshDb,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';
import {
  LINEAGE,
  MIGRATION_007,
  ROWS,
  before,
  insertRow,
  prepareMeasurement,
  seedWorld,
  through,
  revertFile,
  type World,
} from './helpers/v2-check-tables';

/**
 * Migration 007 of the v2 build: the private `evidence` and `reports` buckets, the `crawl_worker`
 * role, its grants, and the two policies it writes through: page_results rows and evidence part
 * uploads, each for the one running check its token names.
 *
 * What PGlite covers: the role, every grant and policy, and the policy decisions, against the Storage
 * stand-ins declared in helpers/pglite-migrations.ts. What it cannot: Supabase's real Storage schema
 * and the Storage API's upload path. Those are the Supabase-branch dry run's, listed in
 * docs/specs/v2/06-check-tables.md.
 */

const ROLLBACK = revertFile(MIGRATION_007);

let db: PGlite;
let world: World;
let running: { checkId: string; siteId: string };
let finished: { checkId: string };

const now = () => Math.floor(Date.now() / 1000);
const token = (checkId: string, over: Record<string, unknown> = {}) => ({
  role: 'crawl_worker',
  check_id: checkId,
  lineage_id: LINEAGE,
  iat: now() - 10,
  exp: now() + 600,
  ...over,
});

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  await prepareMeasurement(db);
  world = await seedWorld(db, 'worker');
  const checkId = randomUUID();
  await insertRow(db, 'checks', {
    ...ROWS.checks(checkId, world.site1),
    status: 'running',
    finished_at: null,
    coverage: null,
    technical_seo: null,
    ai_readability: null,
    progress: { steps: [] },
    lineage_id: null,
  });
  running = { checkId, siteId: world.site1 };
  const { rows } = await db.query<{ id: string }>(
    `select id from public.checks where site_id = $1 and status = 'finished' limit 1`,
    [world.site1],
  );
  finished = { checkId: rows[0]!.id };
}, 120_000);

const pageRow = (checkId: string) =>
  ROWS.page_results(checkId, `https://w.example/${randomUUID()}`);

describe('the crawl_worker role', () => {
  it('cannot log in, does not inherit, does not bypass RLS, and only authenticator may switch to it', async () => {
    const { rows } = await db.query(
      `select rolcanlogin, rolinherit, rolbypassrls, rolsuper, rolcreaterole, rolcreatedb,
              array(select m.rolname from pg_auth_members a join pg_roles m on m.oid = a.member
                     where a.roleid = r.oid order by 1) as members,
              array(select g.rolname from pg_auth_members a join pg_roles g on g.oid = a.roleid
                     where a.member = r.oid order by 1) as member_of
         from pg_roles r where rolname = 'crawl_worker'`,
    );
    expect(rows).toEqual([
      {
        rolcanlogin: false,
        rolinherit: false,
        rolbypassrls: false,
        rolsuper: false,
        rolcreaterole: false,
        rolcreatedb: false,
        members: ['authenticator'],
        member_of: [],
      },
    ]);
  });

  it('holds no table privilege in public except INSERT on page_results', async () => {
    const { rows } = await db.query<{ t: string; p: string }>(
      `select c.relname as t, p.p from pg_class c join pg_namespace n on n.oid = c.relnamespace
         cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(p)
        where n.nspname = 'public' and c.relkind in ('r','v','m','p')
          and has_table_privilege('crawl_worker', c.oid, p.p)
        order by 1, 2`,
    );
    expect(rows).toEqual([{ t: 'page_results', p: 'INSERT' }]);
  });

  it('holds no column privilege anywhere in public', async () => {
    const { rows } = await db.query(
      `select c.relname, a.attname from pg_attribute a join pg_class c on c.oid = a.attrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and a.attacl::text like '%crawl_worker=%'`,
    );
    expect(rows).toEqual([]);
  });

  it('can execute only its four token helpers and page_results’ CHECK helpers in public, and no client can', async () => {
    const { rows } = await db.query<{
      name: string;
      worker: boolean;
      anon: boolean;
      authed: boolean;
    }>(
      `select p.proname as name, has_function_privilege('crawl_worker', p.oid, 'EXECUTE') as worker,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('crawl_worker', p.oid, 'EXECUTE')
          -- pgcrypto is installed into public in the sandbox (extensions, on Supabase)
          and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
        order by 1`,
    );
    // The CHECK helpers are v2_* (003): a CHECK's function needs EXECUTE for the role that inserts.
    expect(rows.filter((r) => !r.name.startsWith('v2_'))).toEqual([
      { name: 'crawl_worker_check_id', worker: true, anon: false, authed: false },
      { name: 'crawl_worker_check_month', worker: true, anon: false, authed: false },
      { name: 'crawl_worker_lineage_id', worker: true, anon: false, authed: false },
      { name: 'crawl_worker_part_path_ok', worker: true, anon: false, authed: false },
    ]);
    const helpers = rows.filter((r) => r.name.startsWith('v2_'));
    expect(helpers.map((r) => r.name)).toEqual([
      'v2_canonical_shape_ok',
      'v2_crawled_text_ok',
      'v2_headers_shape_ok',
      'v2_hreflang_shape_ok',
      'v2_http_url_ok',
      'v2_nullable_url_ok',
      'v2_redirect_shape_ok',
      'v2_redirect_statuses_ok',
      'v2_search_robots_shape_ok',
      'v2_search_robots_ua_unique',
      'v2_search_robots_verdicts_ok',
    ]);
    expect(helpers.filter((r) => r.anon || r.authed)).toEqual([]);
  });

  it('on storage.objects holds INSERT only', async () => {
    const { rows } = await db.query<{ p: string }>(
      `select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p(p)
        where has_table_privilege('crawl_worker', 'storage.objects', p) order by 1`,
    );
    expect(rows.map((r) => r.p)).toEqual(['INSERT']);
  });
});

describe('page_results: the worker inserts rows for the running check its token names, and nothing else', () => {
  it('accepts a valid token for a running check', async () => {
    await asWorker(db, token(running.checkId), (tx) =>
      insertRow(tx, 'page_results', pageRow(running.checkId)),
    );
  });

  const refusals: [string, () => Promise<unknown>][] = [
    [
      'a row for a check the token does not name',
      () =>
        asWorker(db, token(running.checkId), (tx) =>
          insertRow(tx, 'page_results', pageRow(finished.checkId)),
        ),
    ],
    [
      'a check that is not running',
      () =>
        asWorker(db, token(finished.checkId), (tx) =>
          insertRow(tx, 'page_results', pageRow(finished.checkId)),
        ),
    ],
    [
      'an expired token',
      () =>
        asWorker(db, token(running.checkId, { iat: now() - 120, exp: now() - 1 }), (tx) =>
          insertRow(tx, 'page_results', pageRow(running.checkId)),
        ),
    ],
    [
      'a token that lives longer than 15 minutes',
      () =>
        asWorker(db, token(running.checkId, { iat: now() - 10, exp: now() + 901 }), (tx) =>
          insertRow(tx, 'page_results', pageRow(running.checkId)),
        ),
    ],
    [
      'a token issued in the future',
      () =>
        asWorker(db, token(running.checkId, { iat: now() + 300, exp: now() + 600 }), (tx) =>
          insertRow(tx, 'page_results', pageRow(running.checkId)),
        ),
    ],
    [
      'a token whose role claim is not crawl_worker',
      () =>
        asWorker(db, token(running.checkId, { role: 'service_role' }), (tx) =>
          insertRow(tx, 'page_results', pageRow(running.checkId)),
        ),
    ],
    [
      'a token without exp',
      () =>
        asWorker(db, token(running.checkId, { exp: undefined }), (tx) =>
          insertRow(tx, 'page_results', pageRow(running.checkId)),
        ),
    ],
    [
      'a token without iat',
      () =>
        asWorker(db, token(running.checkId, { iat: undefined }), (tx) =>
          insertRow(tx, 'page_results', pageRow(running.checkId)),
        ),
    ],
    [
      'a token with exp as a string',
      () =>
        asWorker(db, token(running.checkId, { exp: String(now() + 600) }), (tx) =>
          insertRow(tx, 'page_results', pageRow(running.checkId)),
        ),
    ],
    [
      'a token without check_id',
      () =>
        asWorker(db, token(running.checkId, { check_id: undefined }), (tx) =>
          insertRow(tx, 'page_results', pageRow(running.checkId)),
        ),
    ],
    [
      'a malformed check_id',
      () =>
        asWorker(db, token(running.checkId, { check_id: `${running.checkId}'--` }), (tx) =>
          insertRow(tx, 'page_results', pageRow(running.checkId)),
        ),
    ],
    [
      'no claims at all',
      () =>
        db.transaction(async (tx) => {
          await tx.exec('set local role crawl_worker');
          await insertRow(tx, 'page_results', pageRow(running.checkId));
        }),
    ],
  ];
  it.each(refusals)('refuses %s', async (_label, attempt) => {
    await expect(attempt()).rejects.toThrow(/row-level security/);
  });

  it('a row that leaves out check_month and lineage_id takes both from the token', async () => {
    const url = `https://w.example/${randomUUID()}`;
    const row = ROWS.page_results(running.checkId, url);
    delete row.check_month;
    delete row.lineage_id;
    await asWorker(db, token(running.checkId), (tx) => insertRow(tx, 'page_results', row));
    const { rows } = await db.query<{ month: string; lineage: string }>(
      `select check_month::text as month, lineage_id::text as lineage from public.page_results
        where check_id = $1 and url = $2`,
      [running.checkId, url],
    );
    expect(rows).toEqual([{ month: '2026-10-01', lineage: LINEAGE }]);
  });

  it.each([
    ['a lineage the token does not name', { lineage_id: randomUUID() }, {}],
    ['a token with no lineage_id claim', {}, { lineage_id: undefined }],
    ['a token whose lineage_id is not a uuid', {}, { lineage_id: `${LINEAGE}'--` }],
  ])('refuses %s', async (_label, rowChange, claimChange) => {
    await expect(
      asWorker(db, token(running.checkId, claimChange), (tx) =>
        insertRow(tx, 'page_results', { ...pageRow(running.checkId), ...rowChange }),
      ),
    ).rejects.toThrow(/row-level security|foreign key/);
  });

  it('refuses a check_month other than its check’s: the row names no check', async () => {
    await expect(
      asWorker(db, token(running.checkId), (tx) =>
        insertRow(tx, 'page_results', { ...pageRow(running.checkId), check_month: '2026-11-01' }),
      ),
    ).rejects.toThrow(/page_results_check_fkey/);
  });

  it('a service_role row that leaves out check_month is refused: the default is the worker’s alone', async () => {
    const row = pageRow(running.checkId);
    delete row.check_month;
    await expect(
      asRole(db, 'service_role', null, (tx) => insertRow(tx, 'page_results', row)),
    ).rejects.toThrow(/permission denied for function crawl_worker_check_month/);
  });

  // Owner ruling 1: the contract's PageResult bounds hold for the worker's own check too.
  it.each([
    ['a javascript: URL', { url: 'javascript:alert(1)' }, 'page_results_url'],
    ['a status code of 0', { status_code: 0 }, 'page_results_status_code'],
    ['a share above 1', { pagerank_share: 2 }, 'page_results_pagerank_share'],
    [
      'an unknown without_js state',
      {
        without_js: { raw_words: 1, rendered_words: 1, text_share: 1, state: 'hidden' },
      },
      'page_results_without_js',
    ],
  ] as const)('refuses %s for its own running check', async (_label, change, constraint) => {
    await expect(
      asWorker(db, token(running.checkId), (tx) =>
        insertRow(tx, 'page_results', { ...pageRow(running.checkId), ...change }),
      ),
    ).rejects.toThrow(new RegExp(`violates check constraint "${constraint}"`));
  });

  it.each([
    ['select', `select url from public.page_results`],
    ['update', `update public.page_results set depth = 9`],
    ['delete', `delete from public.page_results`],
    [
      'insert … returning',
      `insert into public.page_results (check_id, url, template_key, kind, status_code, links_in, links_out, is_orphan, js_only, found_via, sampled)
      values ('${'00000000-0000-4000-8000-000000000000'}', 'https://w.example/r', '/', 'content', 200, 0, 0, false, false, 'link', false) returning url`,
    ],
    ['select from checks', `select id from public.checks`],
    ['select from site_fixes', `select packet from public.site_fixes`],
  ])('refuses %s outright', async (_label, sql) => {
    await expect(asWorker(db, token(running.checkId), (tx) => tx.query(sql))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('evidence part uploads: one running check’s parts, under its own path, in the evidence bucket', () => {
  const prefix = () => `${world.accountId}/${running.siteId}/${running.checkId}`;
  const upload = (claims: Record<string, unknown>, bucket: string, name: string) =>
    asWorker(db, claims, (tx) =>
      tx.query(`insert into storage.objects (bucket_id, name) values ($1, $2)`, [bucket, name]),
    );

  it('the buckets exist and are private', async () => {
    const { rows } = await db.query(
      `select id, public from storage.buckets where id in ('evidence', 'reports') order by id`,
    );
    expect(rows).toEqual([
      { id: 'evidence', public: false },
      { id: 'reports', public: false },
    ]);
  });

  it('accepts a part under the check’s own path', async () => {
    await upload(token(running.checkId), 'evidence', `${prefix()}.part1.json.gz`);
    await upload(token(running.checkId), 'evidence', `${prefix()}.part123456.json.gz`);
  });

  it.each([
    ['the reports bucket', 'reports', () => `${prefix()}.part2.json.gz`],
    ['a final blob, not a part', 'evidence', () => `${prefix()}.v1.json.gz`],
    [
      'another check’s path',
      'evidence',
      () => `${world.accountId}/${running.siteId}/${finished.checkId}.part1.json.gz`,
    ],
    [
      'another site’s path',
      'evidence',
      () => `${world.accountId}/${world.site2}/${running.checkId}.part1.json.gz`,
    ],
    [
      'the anon prefix for a kept site',
      'evidence',
      () => `anon/${running.siteId}/${running.checkId}.part1.json.gz`,
    ],
    ['a path with a traversal', 'evidence', () => `${prefix()}.part1.json.gz/../../x`],
    ['a suffix after the part', 'evidence', () => `${prefix()}.part1.json.gz.exe`],
    ['a part number of seven digits', 'evidence', () => `${prefix()}.part1234567.json.gz`],
    ['a leading slash', 'evidence', () => `/${prefix()}.part1.json.gz`],
  ])('refuses %s', async (_label, bucket, name) => {
    await expect(upload(token(running.checkId), bucket, name())).rejects.toThrow(
      /row-level security/,
    );
  });

  it('refuses an expired token and a finished check', async () => {
    await expect(
      upload(
        token(running.checkId, { iat: now() - 120, exp: now() - 1 }),
        'evidence',
        `${prefix()}.part9.json.gz`,
      ),
    ).rejects.toThrow(/row-level security/);
    const fprefix = `${world.accountId}/${world.site1}/${finished.checkId}`;
    await expect(
      upload(token(finished.checkId), 'evidence', `${fprefix}.part1.json.gz`),
    ).rejects.toThrow(/row-level security/);
  });

  it('an anonymous site’s parts go under anon/', async () => {
    const site = randomUUID();
    const check = randomUUID();
    await insertRow(db, 'sites', ROWS.sites(site, null, `anon-${site.slice(0, 8)}.example`));
    await insertRow(db, 'checks', {
      ...ROWS.checks(check, site),
      status: 'running',
      finished_at: null,
      coverage: null,
      technical_seo: null,
      ai_readability: null,
      progress: { steps: [] },
      lineage_id: null,
    });
    await upload(token(check), 'evidence', `anon/${site}/${check}.part1.json.gz`);
  });

  it('the worker cannot read, overwrite or delete an object', async () => {
    for (const sql of [
      `select name from storage.objects`,
      `update storage.objects set name = 'x'`,
      `delete from storage.objects`,
    ]) {
      await expect(asWorker(db, token(running.checkId), (tx) => tx.query(sql))).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it('no client role can write to either bucket', async () => {
    for (const bucket of ['evidence', 'reports']) {
      await expect(
        asRole(db, 'authenticated', world.ownerId, (tx) =>
          tx.query(`insert into storage.objects (bucket_id, name) values ($1, $2)`, [
            bucket,
            `${prefix()}.part7.json.gz`,
          ]),
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(
        asRole(db, 'anon', null, (tx) =>
          tx.query(`insert into storage.objects (bucket_id, name) values ($1, 'x.part1.json.gz')`, [
            bucket,
          ]),
        ),
      ).rejects.toThrow(/row-level security/);
    }
  });
});

describe('migration 007 applies, re-applies and reverts', () => {
  it('re-applying it changes nothing, and makes a bucket created public private again', async () => {
    const db2 = await freshDb();
    await applyAllMigrations(db2, undefined, through(MIGRATION_007));
    const once = await catalogSnapshot(db2);
    await db2.exec(readMigration(MIGRATION_007));
    expect(await catalogSnapshot(db2)).toEqual(once);
    await db2.exec(`update storage.buckets set public = true where id = 'evidence'`);
    await db2.exec(readMigration(MIGRATION_007));
    expect(await catalogSnapshot(db2)).toEqual(once);
  }, 120_000);

  it('the revert returns the catalog to the state before 007, roles and buckets included', async () => {
    const db2 = await freshDb();
    await applyAllMigrations(db2, undefined, before(MIGRATION_007));
    const pre = await catalogSnapshot(db2);
    await db2.exec(readMigration(MIGRATION_007));
    expect(await catalogSnapshot(db2)).not.toEqual(pre);
    await db2.exec(readRollback(ROLLBACK));
    await db2.exec(readRollback(ROLLBACK));
    const post = await catalogSnapshot(db2);
    for (const section of Object.keys(pre)) expect(post[section], section).toEqual(pre[section]);
  }, 120_000);

  it('the revert refuses to drop a bucket that still holds objects', async () => {
    const db2 = await freshDb();
    await applyAllMigrations(db2, undefined, through(MIGRATION_007));
    await db2.exec(
      `insert into storage.objects (bucket_id, name) values ('evidence', 'kept.json.gz')`,
    );
    await expect(db2.exec(readRollback(ROLLBACK))).rejects.toThrow(
      /foreign key|still holds objects/,
    );
  }, 120_000);
});
