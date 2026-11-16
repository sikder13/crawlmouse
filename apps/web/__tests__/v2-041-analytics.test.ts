/**
 * Migration 20261120000001 (CC-41 D2, D4, D5): first-touch attribution, the ledger writer function,
 * the `analytics` read path and its reader role, and the catalog check that keeps the path free of
 * personal columns (infra/supabase/checks/10-analytics-no-pii.sql).
 */
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite, Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  applyAllMigrations,
  asRole,
  freshDb,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';
import { ALLOWED_LEDGER_VIEW, deidentificationViolations } from './helpers/data-foundations';
import {
  insertRow,
  LINEAGE,
  personalAccount,
  MONTH0,
  prepareMeasurement,
  ROWS,
  seedWorld,
  signUp,
  type World,
} from './helpers/v2-check-tables';

const MIGRATION = '20261120000001_v2_041_analytics.sql';
const REVERT = '20261120000001_v2_041_analytics.revert.sql';
const CHECK_10 = readFileSync(
  join(__dirname, '../../../infra/supabase/checks/10-analytics-no-pii.sql'),
  'utf8',
);
const VIEWS = [
  'account_attribution',
  'accounts',
  'checks',
  'fix_events',
  'fixes',
  'ledger_monthly',
  'seats',
  'subscriptions',
  'usage_events',
];

let db: PGlite;
let world: World;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  await prepareMeasurement(db);
  world = await seedWorld(db, 'analytics');
}, 120_000);

async function asReader<T>(d: PGlite, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return d.transaction(async (tx) => {
    await tx.exec(`set local role analytics_reader`);
    return fn(tx);
  });
}

/** `sql` applied in a rolled-back transaction, and what `read` then returns. */
async function after<T>(sql: string, read: (tx: Transaction) => Promise<T>): Promise<T> {
  return db
    .transaction(async (tx) => {
      await tx.exec(sql);
      throw { value: await read(tx) };
    })
    .catch((x: { value: T }) => {
      if (x && typeof x === 'object' && 'value' in x) return x.value;
      throw x;
    });
}

const check10 = async (tx: Transaction | PGlite) =>
  (await tx.query<{ object: string; problem: string }>(CHECK_10)).rows.map(
    (r) => `${r.object}: ${r.problem}`,
  );

describe('account_attribution', () => {
  const valid = (accountId: string) => ({
    account_id: accountId,
    utm_source: 'linkedin',
    utm_medium: 'social',
    utm_campaign: 'launch-week',
    utm_content: null,
    utm_term: null,
    referrer_host: 'www.linkedin.com',
    landing_path: '/blog/ai-crawler-access-test-2026',
    ref: 'ph_launch',
    first_seen_at: '2026-11-17T09:00:00Z',
  });

  /** An account with no attribution row yet: seedWorld gives the world's account one. */
  const freshAccount = async (tag: string) =>
    (await personalAccount(db, await signUp(db, `${tag}-${randomUUID().slice(0, 8)}@example.com`)))
      .accountId;

  it('holds one row per account and refuses a second', async () => {
    const accountId = await freshAccount('ft-once');
    const t = await db.transaction(async (tx) => {
      await insertRow(tx, 'account_attribution', valid(accountId));
      return tx
        .query(
          `insert into public.account_attribution (account_id, first_seen_at) values ($1, now())`,
          [accountId],
        )
        .then(
          () => 'inserted',
          (e: { code?: string }) => e.code,
        )
        .finally(() => tx.rollback());
    });
    expect(t).toBe('23505');
  });

  it.each([
    ['referrer_host', 'https://evil.example/path?q=1'],
    ['referrer_host', 'Evil.Example'],
    ['referrer_host', `${'a'.repeat(63)}.`.repeat(5)],
    ['landing_path', '/blog?utm_source=x'],
    ['landing_path', '/blog#frag'],
    ['landing_path', 'blog'],
    ['landing_path', `/${'a'.repeat(200)}`],
    ['utm_source', '<script>'],
    ['utm_source', 'x'.repeat(101)],
    ['utm_source', ''],
    ['utm_campaign', 'line\nbreak'],
    ['ref', 'has space'],
    ['ref', 'r'.repeat(65)],
  ])('refuses %s = %j', async (column, value) => {
    const code = await db
      .transaction(async (tx) => {
        await insertRow(tx, 'account_attribution', { ...valid(world.accountId), [column]: value });
        return 'inserted';
      })
      .catch((e: { code?: string }) => e.code);
    expect(code).toBe('23514');
  });

  it('no client role holds anything on it; service_role inserts and reads only', async () => {
    const { rows } = await db.query<{ role: string; p: string }>(
      `select r.role, p.p from unnest(array['anon','authenticated','service_role']) r(role)
         cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p(p)
        where has_table_privilege(r.role, 'public.account_attribution', p.p) order by 1, 2`,
    );
    expect(rows).toEqual([
      { role: 'service_role', p: 'INSERT' },
      { role: 'service_role', p: 'SELECT' },
    ]);
  });

  it('goes with its account', async () => {
    const accountId = await freshAccount('ft-gone');
    const left = await after(
      `insert into public.account_attribution (account_id, first_seen_at) values ('${accountId}', now());
       delete from public.accounts where id = '${accountId}';`,
      async (tx) =>
        (
          await tx.query<{ n: number }>(
            `select count(*)::int as n from public.account_attribution where account_id = '${accountId}'`,
          )
        ).rows[0]!.n,
    );
    expect(left).toBe(0);
  });
});

const DRAFT = {
  cms: 'wordpress',
  frontend_framework: 'wordpress',
  edge_vendor: 'cloudflare',
  without_js_state: 'readable',
  share_2xx: 0.9,
  share_3xx: 0.1,
  share_4xx: 0,
  share_5xx: 0,
  share_unanswered: 0,
  signals_detected: ['schema_org'],
  signals_indeterminate: [],
  observations: [
    { crawler: 'GPTBot', verdict: 'allowed', cause: null, robots_rule: 'named_allow_all' },
  ],
};

async function siteAndCheck(tag: string): Promise<string> {
  const site = randomUUID();
  const check = randomUUID();
  await insertRow(
    db,
    'sites',
    ROWS.sites(site, world.accountId, `${tag}-${site.slice(0, 8)}.example`),
  );
  await insertRow(db, 'checks', ROWS.checks(check, site));
  return check;
}

async function draftCode(check: string, draft: unknown): Promise<string> {
  return asRole(db, 'service_role', null, (tx) =>
    tx.query(`insert into public.check_ledger_drafts (check_id, draft) values ($1, $2::jsonb)`, [
      check,
      JSON.stringify(draft),
    ]),
  ).then(
    () => 'inserted',
    (e: { code?: string }) => e.code ?? 'error',
  );
}

describe('check_ledger_drafts', () => {
  it('holds a draft whose keys are exactly the ledger fields', async () => {
    expect(await draftCode(await siteAndCheck('dr'), DRAFT)).toBe('inserted');
  });

  it.each([
    ['an extra key (a host)', { ...DRAFT, host: 'client.example' }],
    ['an extra key (the account)', { ...DRAFT, account_id: randomUUID() }],
    ['a missing key', Object.fromEntries(Object.entries(DRAFT).filter(([k]) => k !== 'cms'))],
    ['observations that are not an array', { ...DRAFT, observations: {} }],
    ['an array instead of an object', [DRAFT]],
  ])('refuses %s', async (_label, draft) => {
    expect(await draftCode(await siteAndCheck('drx'), draft)).toBe('23514');
  });

  it('goes with its check, as the anonymous expiry deletes one', async () => {
    const check = await siteAndCheck('drc');
    expect(await draftCode(check, DRAFT)).toBe('inserted');
    await db.query(`delete from public.checks where id = $1`, [check]);
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.check_ledger_drafts where check_id = $1`,
      [check],
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('no client role holds anything on it', async () => {
    const { rows } = await db.query<{ role: string; p: string }>(
      `select r.role, p.p from unnest(array['anon','authenticated','crawl_worker','analytics_reader']) r(role)
         cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p(p)
        where has_table_privilege(r.role, 'public.check_ledger_drafts', p.p)`,
    );
    expect(rows).toEqual([]);
  });
});

describe('record_check_ledger', () => {
  const run = (siteKey: string) => ({
    observed_month: MONTH0,
    site_key: siteKey,
    site_key_version: 1,
    lineage_id: LINEAGE,
    cms: 'wordpress',
    frontend_framework: 'wordpress',
    edge_vendor: 'cloudflare',
    without_js_state: 'readable',
    share_2xx: 0.9,
    share_3xx: 0.1,
    share_4xx: 0,
    share_5xx: 0,
    share_unanswered: 0,
    signals_detected: ['schema_org', 'llms_txt'],
    signals_indeterminate: [],
  });
  const observations = [
    { crawler: 'GPTBot', verdict: 'allowed', cause: null, robots_rule: 'named_allow_all' },
    {
      crawler: 'ClaudeBot',
      verdict: 'disallowed_by_robots',
      cause: null,
      robots_rule: 'named_disallow_all',
    },
  ];

  async function newCheck(): Promise<string> {
    const site = randomUUID();
    const check = randomUUID();
    await insertRow(
      db,
      'sites',
      ROWS.sites(site, world.accountId, `rcl-${site.slice(0, 8)}.example`),
    );
    await insertRow(db, 'checks', ROWS.checks(check, site));
    return check;
  }

  it('writes the run, one observation per crawler and the link; a second call writes nothing', async () => {
    const check = await newCheck();
    const key = createHash('sha256').update(check).digest('hex');
    const call = () =>
      asRole(
        db,
        'service_role',
        null,
        async (tx) =>
          (
            await tx.query<{ id: string }>(
              `select public.record_check_ledger($1, $2::jsonb, $3::jsonb) as id`,
              [check, JSON.stringify(run(key)), JSON.stringify(observations)],
            )
          ).rows[0]!.id,
      );
    expect(await draftCode(check, DRAFT)).toBe('inserted');
    const first = await call();
    const drafts = await db.query<{ n: number }>(
      `select count(*)::int as n from public.check_ledger_drafts where check_id = $1`,
      [check],
    );
    expect(drafts.rows[0]!.n).toBe(0);
    const second = await call();
    expect(second).toBe(first);
    const { rows } = await db.query<{ runs: number; obs: number; links: number }>(
      `select (select count(*)::int from research.check_runs where site_key = $1) as runs,
              (select count(*)::int from research.crawler_observations where run_id = $2) as obs,
              (select count(*)::int from public.check_ledger_links where check_id = $3) as links`,
      [key, first, check],
    );
    expect(rows[0]).toEqual({ runs: 1, obs: 2, links: 1 });
  });

  it('writes nothing when one observation is refused: one transaction', async () => {
    const check = await newCheck();
    const key = createHash('sha256').update(`bad-${check}`).digest('hex');
    const bad = [
      ...observations,
      { crawler: 'Bad Crawler!', verdict: 'allowed', cause: null, robots_rule: 'no_group' },
    ];
    const code = await asRole(db, 'service_role', null, (tx) =>
      tx.query(`select public.record_check_ledger($1, $2::jsonb, $3::jsonb)`, [
        check,
        JSON.stringify(run(key)),
        JSON.stringify(bad),
      ]),
    ).then(
      () => 'written',
      (e: { code?: string }) => e.code,
    );
    expect(code).toBe('23514');
    const { rows } = await db.query<{ runs: number }>(
      `select count(*)::int as runs from research.check_runs where site_key = $1`,
      [key],
    );
    expect(rows[0]!.runs).toBe(0);
  });

  it('only service_role may call it', async () => {
    const { rows } = await db.query<{ role: string }>(
      `select r.role from unnest(array['anon','authenticated','crawl_worker','analytics_reader','service_role']) r(role)
        where has_function_privilege(r.role, 'public.record_check_ledger(uuid, jsonb, jsonb)', 'EXECUTE')`,
    );
    expect(rows.map((r) => r.role)).toEqual(['service_role']);
  });
});

describe('the analytics read path', () => {
  it('has exactly the planned views', async () => {
    const { rows } = await db.query<{ v: string }>(
      `select c.relname as v from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'analytics' order by 1`,
    );
    expect(rows.map((r) => r.v)).toEqual(VIEWS);
  });

  it('analytics_reader reads every view', async () => {
    for (const v of VIEWS) {
      await expect(
        asReader(db, (tx) => tx.query(`select * from analytics.${v} limit 1`)),
        v,
      ).resolves.toBeDefined();
    }
  });

  it.each([
    'public.accounts',
    'public.users',
    'public.sites',
    'public.checks',
    'public.account_attribution',
    'research.check_runs',
    'research.crawler_observations',
    'auth.users',
  ])('analytics_reader is refused %s', async (rel) => {
    const code = await asReader(db, (tx) => tx.query(`select 1 from ${rel} limit 1`)).then(
      () => 'read',
      (e: { code?: string }) => e.code,
    );
    expect(code).toBe('42501');
  });

  it('anon and authenticated cannot use the schema', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      const code = await asRole(db, role, null, (tx) =>
        tx.query(`select 1 from analytics.accounts limit 1`),
      ).then(
        () => 'read',
        (e: { code?: string }) => e.code,
      );
      expect(code, role).toBe('42501');
    }
  });

  it('the reader logs in with no password, three connections and a 30-second statement timeout', async () => {
    const { rows } = await db.query<{ login: boolean; lim: number; cfg: string[]; pw: boolean }>(
      `select r.rolcanlogin as login, r.rolconnlimit as lim, r.rolconfig as cfg,
              a.rolpassword is not null as pw
         from pg_roles r join pg_authid a on a.oid = r.oid where r.rolname = 'analytics_reader'`,
    );
    expect(rows[0]).toEqual({ login: true, lim: 3, cfg: ['statement_timeout=30s'], pw: false });
  });

  it('a failure reason that is not a code reads as other', async () => {
    const site = randomUUID();
    const coded = randomUUID();
    const free = randomUUID();
    await insertRow(
      db,
      'sites',
      ROWS.sites(site, world.accountId, `fr-${site.slice(0, 8)}.example`),
    );
    for (const [id, reason] of [
      [coded, 'timed_out'],
      [free, 'fetch https://client.example/secret failed'],
    ] as const) {
      await insertRow(db, 'checks', {
        ...ROWS.checks(id, site),
        status: 'failed',
        failure_reason: reason,
        lineage_id: null,
        coverage: null,
        technical_seo: null,
        ai_readability: null,
      });
    }
    const { rows } = await asReader(db, (tx) =>
      tx.query<{ id: string; failure_reason: string }>(
        `select id, failure_reason from analytics.checks where id in ($1, $2)`,
        [coded, free],
      ),
    );
    expect(Object.fromEntries(rows.map((r) => [r.id, r.failure_reason]))).toEqual({
      [coded]: 'timed_out',
      [free]: 'other',
    });
  });
});

describe('no view exposes a check id that is a capability', () => {
  it('checks.id is null for a check nobody keeps, and the id for a kept one', async () => {
    const anonSite = randomUUID();
    const keptSite = randomUUID();
    const anon = randomUUID();
    const kept = randomUUID();
    await insertRow(db, 'sites', ROWS.sites(anonSite, null, `cap-${anonSite.slice(0, 8)}.example`));
    await insertRow(
      db,
      'sites',
      ROWS.sites(keptSite, world.accountId, `cap-${keptSite.slice(0, 8)}.example`),
    );
    await insertRow(db, 'checks', ROWS.checks(anon, anonSite));
    await insertRow(db, 'checks', ROWS.checks(kept, keptSite));
    const { rows } = await asReader(db, (tx) =>
      tx.query<{ id: string | null; account_id: string | null }>(
        `select id, account_id from analytics.checks where id = $1 or (id is null and account_id is null)`,
        [kept],
      ),
    );
    expect(rows.some((r) => r.id === kept)).toBe(true);
    expect(rows.filter((r) => r.account_id === null).every((r) => r.id === null)).toBe(true);
    const anyAnon = await asReader(db, (tx) =>
      tx.query(`select 1 from analytics.checks where id = $1`, [anon]),
    );
    expect(anyAnon.rows).toEqual([]);
  });

  it('the fix views hold no fix of a site nobody keeps', async () => {
    const site = randomUUID();
    const check = randomUUID();
    const fix = randomUUID();
    await insertRow(db, 'sites', ROWS.sites(site, null, `fx-${site.slice(0, 8)}.example`));
    await insertRow(db, 'checks', ROWS.checks(check, site));
    await insertRow(db, 'site_fixes', ROWS.site_fixes(fix, site, check, 1));
    await insertRow(db, 'fix_events', ROWS.fix_events(randomUUID(), fix, check));
    const { rows } = await asReader(db, (tx) =>
      tx.query<{ n: number }>(
        `select (select count(*)::int from analytics.fixes where account_id is null) +
                (select count(*)::int from analytics.fix_events where account_id is null) as n`,
      ),
    );
    expect(rows[0]!.n).toBe(0);
    const { rows: unkept } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.site_fixes f join public.sites s on s.id = f.site_id
        where s.account_id is null`,
    );
    // Anti-vacuity: the database holds fixes of unkept sites for the views to leave out.
    expect(unkept[0]!.n).toBeGreaterThan(0);
  });
});

describe('the revert as Supabase runs it', () => {
  it('drops no role with DROP OWNED, and a non-superuser that created the role can drop it', async () => {
    const statements = readRollback(REVERT)
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    expect(statements).not.toMatch(/drop\s+owned/i);
    expect(statements).toMatch(/drop role if exists analytics_reader/);
    const d = await freshDb();
    await d.exec(`create role creator login createrole noinherit`);
    await d.exec(`set role creator; create role made_by_creator login; reset role`);
    const owned = await d.exec(`set role creator; drop owned by made_by_creator; reset role`).then(
      () => 'dropped',
      (e: { code?: string }) => e.code,
    );
    await d.exec(`reset role`);
    // Since PG16 a CREATEROLE role holds only ADMIN on a role it made: DROP OWNED is refused…
    expect(owned).toBe('42501');
    // …and DROP ROLE is not.
    await d.exec(`set role creator; drop role made_by_creator; reset role`);
    const { rows } = await d.query(`select 1 from pg_roles where rolname = 'made_by_creator'`);
    expect(rows).toEqual([]);
    // A fresh PGlite takes about a second alone and past 5s under a full suite's load.
  }, 120_000);
});

/**
 * Supabase-shaped stand-ins for what a project carries outside the migrations: pg_stat_statements'
 * two views in `extensions`, with PUBLIC SELECT (`=r/postgres` on production, 2026-11-16) and
 * dashboard_user's own grant beside it. `extensions.other` is a view PUBLIC holds SELECT on that the
 * migration does not name, so a revoke that reached past the two views would show.
 */
const SUPABASE_EXTRAS = `
  create role dashboard_user;
  create schema extensions;
  grant usage on schema extensions to anon, authenticated, service_role, dashboard_user;
  create view extensions.pg_stat_statements as select 1::bigint as calls;
  create view extensions.pg_stat_statements_info as select 1::bigint as dealloc;
  create view extensions.other as select 1::bigint as n;
  grant select on extensions.pg_stat_statements, extensions.pg_stat_statements_info,
                  extensions.other to public;
  grant select on extensions.pg_stat_statements, extensions.pg_stat_statements_info to dashboard_user;
  grant select, insert on extensions.pg_stat_statements_info to service_role with grant option;
`;

/**
 * One line per grantee and privilege on the schema `extensions` and the relations in it, computed
 * here from the catalog and not with the migration's own query.
 */
const extrasAcl = async (d: PGlite) =>
  (
    await d.query<{ line: string }>(
      `select format('%s %s %s%s', o, g, p, case when gr then '*' else '' end) as line from (
         select format('%I.%I', n.nspname, c.relname) as o, a.grantee, a.privilege_type as p,
                a.is_grantable as gr
           from pg_class c join pg_namespace n on n.oid = c.relnamespace,
                aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
          where n.nspname = 'extensions'
         union all
         select n.nspname::text, a.grantee, a.privilege_type, a.is_grantable
           from pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
          where n.nspname = 'extensions') x
         cross join lateral (select case x.grantee when 0 then 'PUBLIC'
                                     else pg_get_userbyid(x.grantee) end as g) r
        order by 1`,
    )
  ).rows.map((r) => r.line);

const TARGETS = /^extensions\.pg_stat_statements(_info)? PUBLIC /;

/** Every migration but 041, the stand-ins (and `extra`), then 041: the order production sees. */
async function withExtras(extra = ''): Promise<PGlite> {
  const d = await freshDb();
  await applyAllMigrations(d, undefined, (f) => f !== MIGRATION);
  await d.exec(SUPABASE_EXTRAS + extra);
  return d;
}

/** The migration's section 5, alone. */
const section5 = () => {
  const sql = readMigration(MIGRATION);
  const at = sql.indexOf('-- ─── 5.');
  expect(at).toBeGreaterThan(0);
  return sql.slice(at);
};

describe('what analytics_reader would hold through PUBLIC', () => {
  it('the migration takes PUBLIC’s SELECT on pg_stat_statements’ two views, and only that', async () => {
    const d = await withExtras();
    const before = await extrasAcl(d);
    expect(before).toEqual(
      expect.arrayContaining([
        'extensions.pg_stat_statements PUBLIC SELECT',
        'extensions.pg_stat_statements_info PUBLIC SELECT',
        'extensions.pg_stat_statements dashboard_user SELECT',
        'extensions.other PUBLIC SELECT',
      ]),
    );
    await d.exec(readMigration(MIGRATION));
    const after = await extrasAcl(d);
    expect(after).toEqual(before.filter((l) => !TARGETS.test(l)));
    expect(after).toContain('extensions.pg_stat_statements dashboard_user SELECT');
    expect(after).toContain('extensions.pg_stat_statements_info dashboard_user SELECT');
    expect(after).toContain('extensions.pg_stat_statements_info service_role INSERT*');
    expect(after).toContain('extensions.other PUBLIC SELECT');
    // As on production, PUBLIC holds no USAGE on `extensions`, so the reader can reach none of it
    // and check 10 has nothing to report, `extensions.other`'s PUBLIC SELECT included.
    expect(await check10(d)).toEqual([]);
  }, 180_000);

  it('the revert gives PUBLIC back exactly what it held, also after the migration ran twice', async () => {
    const d = await withExtras();
    const before = await extrasAcl(d);
    await d.exec(readMigration(MIGRATION));
    await d.exec(readMigration(MIGRATION));
    await d.exec(readRollback(REVERT));
    expect(await extrasAcl(d)).toEqual(before);
    // Applied again after the revert, it takes them again.
    await d.exec(readMigration(MIGRATION));
    expect(await extrasAcl(d)).toEqual(before.filter((l) => !TARGETS.test(l)));
    await d.exec(readRollback(REVERT));
    expect(await extrasAcl(d)).toEqual(before);
  }, 180_000);

  it('the revert grants nothing PUBLIC did not hold', async () => {
    const d = await withExtras(`revoke select on extensions.pg_stat_statements_info from public;`);
    const before = await extrasAcl(d);
    expect(before).not.toContain('extensions.pg_stat_statements_info PUBLIC SELECT');
    await d.exec(readMigration(MIGRATION));
    await d.exec(readRollback(REVERT));
    const reverted = await extrasAcl(d);
    expect(reverted).toEqual(before);
    expect(reverted.filter((l) => TARGETS.test(l))).toEqual([
      'extensions.pg_stat_statements PUBLIC SELECT',
    ]);
  }, 180_000);

  it('with pg_stat_statements absent it revokes nothing and records nothing', async () => {
    const { rows } = await db.query<{ c: string | null }>(
      `select obj_description('analytics'::regnamespace, 'pg_namespace') as c`,
    );
    expect(rows[0]!.c).toBe('[]');
  });

  it('fails, naming the view, when the role running it cannot revoke PUBLIC’s grant', async () => {
    const d = await freshDb();
    await d.exec(`
      create role ext_owner;
      create role runner;
      create schema extensions authorization ext_owner;
      set role ext_owner;
      grant usage on schema extensions to public;
      create view extensions.pg_stat_statements as select 1::bigint as calls;
      grant select on extensions.pg_stat_statements to public;
      reset role;
      create schema analytics authorization runner;`);
    // runner holds PUBLIC's SELECT and no grant option, so Postgres only warns and revokes
    // nothing; the migration must turn that into an error.
    const message = await d.exec(`set role runner;\n${section5()}`).then(
      () => 'applied',
      (e: Error) => e.message,
    );
    await d.exec(`reset role`);
    expect(message).toMatch(/PUBLIC still holds/);
    expect(message).toContain('extensions.pg_stat_statements');
  }, 120_000);
});

describe('10-analytics-no-pii', () => {
  it('passes on the migrated database', async () => {
    expect(await check10(db)).toEqual([]);
  });

  it.each([
    [
      'a view with an email column',
      `create view analytics.leak as select u.email from public.users u;
       grant select on analytics.leak to analytics_reader`,
      'analytics.leak.email: personal-looking column',
    ],
    [
      'an aliased host column',
      `create view analytics.sites_leak as select s.id, s.host as site_host from public.sites s`,
      'analytics.sites_leak.site_host: personal-looking column',
    ],
    [
      'an inet column',
      `create view analytics.addr as select '127.0.0.1'::inet as client`,
      'analytics.addr.client: personal-looking column (inet)',
    ],
    [
      'a third attribution column outside the allowlist',
      `create or replace view analytics.account_attribution as
         select t.account_id, t.utm_source, t.utm_medium, t.utm_campaign, t.utm_content, t.utm_term,
                t.referrer_host, t.landing_path, t.ref, t.first_seen_at, t.captured_at,
                t.referrer_host as referrer_url
           from public.account_attribution t`,
      'analytics.account_attribution.referrer_url: personal-looking column',
    ],
    [
      'an allowlisted name on another view',
      `create view analytics.other as select 'x'::text as referrer_host`,
      'analytics.other.referrer_host: personal-looking column',
    ],
    [
      'a grant on a public table',
      `grant select on public.users to analytics_reader`,
      'public.users: analytics_reader holds SELECT',
    ],
    [
      'a grant on the research schema',
      `grant usage on schema research to analytics_reader`,
      'research: analytics_reader holds USAGE on the schema',
    ],
    [
      'PUBLIC SELECT on pg_stat_statements, in a schema the reader can use',
      `create schema extensions;
       grant usage on schema extensions to public;
       create view extensions.pg_stat_statements as select 1::bigint as calls;
       grant select on extensions.pg_stat_statements to public`,
      'extensions.pg_stat_statements: analytics_reader holds SELECT',
    ],
    [
      "PUBLIC INSERT on pg_net's request queue, in a schema the reader can use",
      `create schema net;
       grant usage on schema net to public;
       create table net.http_request_queue (id bigint);
       grant insert on net.http_request_queue to public`,
      'net.http_request_queue: analytics_reader holds INSERT',
    ],
    [
      'PUBLIC USAGE on schema net',
      `create schema net; grant usage on schema net to public`,
      'net: analytics_reader holds USAGE on the schema',
    ],
    [
      'a client grant on a view',
      `grant select on analytics.accounts to authenticated`,
      'analytics.accounts: authenticated holds SELECT',
    ],
    [
      'a security definer function anyone may call',
      `create function public.peek_emails() returns setof text language sql security definer
         set search_path = pg_catalog as $f$ select email from public.users $f$`,
      'public.peek_emails(): analytics_reader may execute this security definer function',
    ],
  ])('finds %s', async (_label, sql, expected) => {
    expect((await after(sql, check10)).join('\n')).toContain(expected);
  });
});

/**
 * Check 10 reports what analytics_reader can reach. Postgres needs USAGE on a schema before any
 * privilege on an object in it can be used, so a relation or function privilege outside `analytics`
 * counts only with the schema's USAGE; USAGE on a schema is reported on its own. The `cron` shape
 * from production (2026-11-16): PUBLIC SELECT on `cron.job`, SELECT and DELETE on
 * `cron.job_run_details` (`=rd/supabase_admin`), and no USAGE on `cron` for PUBLIC. Each case runs
 * under two schema names and two table names, so no result rests on one name.
 */
describe('check 10 counts a privilege only where the reader can use the schema', () => {
  const SHAPES = [
    ['sched_a', 'job'],
    ['jobs_b', 'run_details'],
  ] as const;
  const cronShape = (schema: string, table: string) =>
    `create schema ${schema};
     create table ${schema}.${table} (id bigint);
     grant select, delete on ${schema}.${table} to public;`;

  it.each(SHAPES)(
    'a PUBLIC grant on %s.%s, a schema the reader cannot use, is not reported',
    async (schema, table) => {
      const found = await after(cronShape(schema, table), check10);
      expect(found.filter((f) => f.startsWith(`${schema}`))).toEqual([]);
      expect(found).toEqual([]);
    },
  );

  it.each(SHAPES)(
    'the same grant on %s.%s is reported once the reader can use the schema',
    async (schema, table) => {
      const found = await after(
        `${cronShape(schema, table)} grant usage on schema ${schema} to public;`,
        check10,
      );
      expect(found).toEqual([
        `${schema}: analytics_reader holds USAGE on the schema`,
        `${schema}.${table}: analytics_reader holds DELETE`,
        `${schema}.${table}: analytics_reader holds SELECT`,
      ]);
    },
  );

  it.each(['sched_a', 'jobs_b'])('USAGE on schema %s alone is reported', async (schema) => {
    const found = await after(
      `create schema ${schema}; grant usage on schema ${schema} to public;`,
      check10,
    );
    expect(found).toEqual([`${schema}: analytics_reader holds USAGE on the schema`]);
  });

  it.each(SHAPES)(
    'a security definer function in %s the reader may execute counts only with the schema’s USAGE (%s)',
    async (schema, name) => {
      const fn = `create schema ${schema};
        create function ${schema}.${name}() returns int language sql security definer
          set search_path = pg_catalog as $f$ select 1 $f$;`;
      expect(await after(fn, check10)).toEqual([]);
      expect(await after(`${fn} grant usage on schema ${schema} to public;`, check10)).toEqual([
        `${schema}: analytics_reader holds USAGE on the schema`,
        `${schema}.${name}(): analytics_reader may execute this security definer function`,
      ]);
    },
  );
});

describe('the ledger guard allows exactly analytics.ledger_monthly', () => {
  it('reports nothing on the migrated database', async () => {
    expect(await deidentificationViolations(db)).toEqual([]);
  });

  it('a second view over the ledger in analytics still fails', async () => {
    const bad = await after(
      `create view analytics.ledger_sites as select site_key, observed_month from research.check_runs`,
      deidentificationViolations,
    );
    expect(bad.join('\n')).toMatch(/view analytics\.ledger_sites depends on the ledger/);
  });

  it('ledger_monthly changed to show more fails', async () => {
    const bad = await after(
      `create or replace view analytics.ledger_monthly as
         select o.observed_month, o.crawler, o.verdict, o.measurement_status,
                count(*)::bigint as observations, max(o.cause) as cause
           from research.crawler_observations o
          group by o.observed_month, o.crawler, o.verdict, o.measurement_status`,
      deidentificationViolations,
    );
    expect(bad).toContain(`${ALLOWED_LEDGER_VIEW.name}: its definition is not the allowed one`);
    expect(bad.join('\n')).toMatch(
      /rule _RETURN on view analytics\.ledger_monthly depends on the ledger/,
    );
  });
});

describe('migration 041 re-applies and reverts', () => {
  const catalog = async (d: PGlite) =>
    (
      await d.query<{ o: string }>(
        `select format('%s.%s:%s', n.nspname, c.relname, c.relkind) as o from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname in ('public', 'analytics') order by 1`,
      )
    ).rows.map((r) => r.o);

  it('re-applying it changes nothing; the revert removes it and it applies again', async () => {
    const d = await freshDb();
    await applyAllMigrations(d);
    const once = await catalog(d);
    await d.exec(readMigration(MIGRATION));
    expect(await catalog(d)).toEqual(once);
    await d.exec(readRollback(REVERT));
    const reverted = await catalog(d);
    expect(
      reverted.filter((o) => o.startsWith('analytics.') || o.includes('account_attribution')),
    ).toEqual([]);
    const { rows } = await d.query(`select 1 from pg_roles where rolname = 'analytics_reader'`);
    expect(rows).toEqual([]);
    await d.exec(readRollback(REVERT));
    await d.exec(readMigration(MIGRATION));
    expect(await catalog(d)).toEqual(once);
  }, 180_000);
});
