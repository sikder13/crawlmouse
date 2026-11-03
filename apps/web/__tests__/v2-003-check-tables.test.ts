import { createHash, randomUUID } from 'node:crypto';
import type { PGlite, Transaction } from '@electric-sql/pglite';
import { RULES } from '@crawlmouse/types/v2';
import { beforeAll, describe, expect, it } from 'vitest';
import { catalogSnapshot } from './helpers/catalog-snapshot';
import {
  applyAllMigrations,
  asRole,
  freshDb,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';
import {
  ALL_NEW_TABLES,
  MIGRATION_003,
  NEW_TABLES,
  ROWS,
  constraints,
  enumSetOf,
  insertRow,
  personalAccount,
  prepareMeasurement,
  revertFile,
  seedWorld,
  signUp,
  insertLedgerRow,
  ledgerRun,
  through,
  before,
  type NewTable,
  type World,
} from './helpers/v2-check-tables';
import { RULE_CHECKS } from './helpers/v2-contract-storage';

/**
 * Migration 003 of the v2 build: the check-data tables. Everything runs the real migration files
 * on PGlite and reads the result from the catalog or by acting as a client role.
 *
 * Cross-account reads and writes are in v2-003-cross-account.test.ts, the entitlement site effects
 * in v2-003-site-effects.test.ts, and contract fidelity in v2-contract-guard.test.ts.
 */

const ROLLBACK = revertFile(MIGRATION_003);
type Db = PGlite | Transaction;

// ─── Apply, re-apply, revert ──────────────────────────────────────────────────────────────────────

describe('migration 003 applies, re-applies and reverts', () => {
  it('re-applying it changes nothing in the catalog', async () => {
    const db = await freshDb();
    await applyAllMigrations(db, undefined, through(MIGRATION_003));
    const once = await catalogSnapshot(db);
    await db.exec(readMigration(MIGRATION_003));
    expect(await catalogSnapshot(db)).toEqual(once);
  }, 120_000);

  it('the revert returns the catalog to the state before 003, apply_entitlement_transition body included', async () => {
    const db = await freshDb();
    await applyAllMigrations(db, undefined, before(MIGRATION_003));
    const pre = await catalogSnapshot(db);
    await db.exec(readMigration(MIGRATION_003));
    expect(await catalogSnapshot(db)).not.toEqual(pre); // anti-vacuity
    await db.exec(readRollback(ROLLBACK));
    const post = await catalogSnapshot(db);
    for (const section of Object.keys(pre)) expect(post[section], section).toEqual(pre[section]);
  }, 120_000);

  it('the revert runs twice without error, and 003 re-applies after it to the same catalog', async () => {
    const db = await freshDb();
    await applyAllMigrations(db, undefined, through(MIGRATION_003));
    const applied = await catalogSnapshot(db);
    await db.exec(readRollback(ROLLBACK));
    await db.exec(readRollback(ROLLBACK));
    await db.exec(readMigration(MIGRATION_003));
    expect(await catalogSnapshot(db)).toEqual(applied);
  }, 120_000);

  it('the revert succeeds with rows in every table it drops', async () => {
    const db = await freshDb();
    await applyAllMigrations(db, undefined, through(MIGRATION_003));
    await seedWorld(db, 'revert');
    await db.exec(readRollback(ROLLBACK));
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace
        where s.nspname = 'public' and c.relname = any($1)`,
      [NEW_TABLES],
    );
    expect(rows[0]!.n).toBe(0);
  }, 120_000);
});

// ─── Rows ─────────────────────────────────────────────────────────────────────────────────────────

let db: PGlite;
let world: World;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  await prepareMeasurement(db);
  world = await seedWorld(db, 'main');
}, 120_000);

let lineageSerial = 0x2000;

/** A fresh valid row for `table`, inserting what it depends on first. */
async function freshRow(table: NewTable): Promise<Record<string, unknown>> {
  const site = randomUUID();
  const check = randomUUID();
  const needSite = async () =>
    insertRow(db, 'sites', ROWS.sites(site, world.accountId, `s-${site.slice(0, 8)}.example`));
  const needCheck = async () => {
    await needSite();
    await insertRow(db, 'checks', ROWS.checks(check, site));
  };
  const hex = createHash('sha256').update(randomUUID()).digest('hex');
  switch (table) {
    case 'measurement_lineages':
      return ROWS.measurement_lineages(randomUUID(), ++lineageSerial);
    case 'sites':
      return ROWS.sites(site, world.accountId, `s-${site.slice(0, 8)}.example`);
    case 'checks':
      await needSite();
      return ROWS.checks(check, site);
    case 'page_results':
      await needCheck();
      return ROWS.page_results(check, `https://x.example/${site}`);
    case 'link_edges':
      await needCheck();
      return ROWS.link_edges(check, 'https://x.example/', `https://x.example/${site}`);
    case 'access_tests':
      await needCheck();
      return ROWS.access_tests(randomUUID(), check);
    case 'site_fixes':
      await needCheck();
      return ROWS.site_fixes(randomUUID(), site, check, 7);
    case 'fix_events': {
      await needCheck();
      const fix = randomUUID();
      await insertRow(db, 'site_fixes', ROWS.site_fixes(fix, site, check, 7));
      return ROWS.fix_events(randomUUID(), fix, check);
    }
    case 'changes':
      await needCheck();
      return ROWS.changes(randomUUID(), site, check);
    case 'evidence_blobs':
      await needCheck();
      return ROWS.evidence_blobs(randomUUID(), check);
    case 'alert_rules':
      await needSite();
      return ROWS.alert_rules(randomUUID(), world.accountId, site);
    case 'alert_events': {
      await needCheck();
      const rule = randomUUID();
      await insertRow(db, 'alert_rules', ROWS.alert_rules(rule, world.accountId, site));
      return ROWS.alert_events(randomUUID(), rule, site, check);
    }
    case 'reports':
      await needCheck();
      return ROWS.reports(randomUUID(), world.accountId, site, check);
    case 'report_schedules':
      await needSite();
      return ROWS.report_schedules(site, world.accountId);
    case 'share_links': {
      await needCheck();
      const rep = randomUUID();
      await insertRow(db, 'reports', ROWS.reports(rep, world.accountId, site, check));
      return ROWS.share_links(hex, rep);
    }
    case 'api_keys':
      return ROWS.api_keys(randomUUID(), world.accountId, hex);
    case 'deploy_hooks':
      await needSite();
      return ROWS.deploy_hooks(randomUUID(), site, hex);
    case 'seat_sites':
      await needSite();
      return ROWS.seat_sites(world.scopedSeatId, site, world.accountId);
    case 'check_ledger_links': {
      await needCheck();
      const run = randomUUID();
      await insertLedgerRow(db, 'check_runs', ledgerRun(run, hex));
      return ROWS.check_ledger_links(check, run);
    }
    case 'usage_events':
      await needCheck();
      return ROWS.usage_events(randomUUID(), world.accountId, check);
  }
}

const SENTINEL = new Error('rollback');

/**
 * The row is refused by `constraint` and by nothing else: the insert fails naming it, and inserting
 * the same row with only that constraint dropped succeeds (inside a transaction that is rolled back).
 */
async function expectOnlyViolates(table: string, row: Record<string, unknown>, constraint: string) {
  await expect(insertRow(db, table, row), `${constraint} should refuse the row`).rejects.toThrow(
    new RegExp(`"${constraint}"`),
  );
  await expect(
    db.transaction(async (tx) => {
      await tx.exec(`alter table public.${table} drop constraint ${constraint}`);
      await insertRow(tx, table, row);
      throw SENTINEL;
    }),
    `with ${constraint} dropped the row should insert`,
  ).rejects.toBe(SENTINEL);
}

/**
 * `constraint` alone refuses the row: with every other CHECK on the table dropped, the insert fails
 * naming it, and with it dropped too, the row inserts. For enum CHECKs, where a value outside the set
 * also falls outside every rule that lists values (a rule on `status` cannot hold for an unknown one).
 */
async function expectRefusesAlone(table: string, row: Record<string, unknown>, constraint: string) {
  const others = (await constraints(db, table)).map((c) => c.name).filter((n) => n !== constraint);
  await expect(
    db.transaction(async (tx) => {
      for (const n of others) await tx.exec(`alter table public.${table} drop constraint ${n}`);
      await tx.exec('savepoint refused');
      let refused: unknown = null;
      try {
        await insertRow(tx, table, row);
      } catch (err) {
        refused = err;
      }
      await tx.exec('rollback to savepoint refused');
      expect(String(refused), `${constraint} should refuse the row`).toMatch(
        new RegExp(`"${constraint}"`),
      );
      await tx.exec(`alter table public.${table} drop constraint ${constraint}`);
      await insertRow(tx, table, row);
      throw SENTINEL;
    }),
  ).rejects.toBe(SENTINEL);
}

describe('the row builders', () => {
  for (const table of ALL_NEW_TABLES) {
    it(`a fresh ${table} row inserts (the CHECK cases below start from it)`, async () => {
      await insertRow(db, table, await freshRow(table));
    });
  }
});

// ─── Posture ──────────────────────────────────────────────────────────────────────────────────────

/** Columns `authenticated` may not select; `null` = no client privilege of any kind. */
const HIDDEN: Record<NewTable, string[] | null> = {
  measurement_lineages: [],
  sites: [],
  checks: [],
  page_results: [],
  link_edges: [],
  access_tests: [],
  site_fixes: null,
  fix_events: null,
  changes: ['fix_id', 'subject'],
  evidence_blobs: [],
  alert_rules: [],
  alert_events: [],
  reports: ['storage_path'],
  report_schedules: [],
  share_links: null,
  api_keys: ['key_hash'],
  deploy_hooks: ['token_hash'],
  seat_sites: [],
  check_ledger_links: null,
  usage_events: ['check_id', 'report_id', 'api_key_id', 'compute_seconds', 'request_count', 'idempotency_key'],
};
const ALERT_INSERT = ['account_id', 'site_id', 'kind', 'enabled', 'threshold_points', 'channels'];
const ALERT_UPDATE = ['enabled', 'threshold_points', 'channels'];

function policiesFor(table: NewTable): string[] {
  if (HIDDEN[table] === null) return [];
  // Any signed-in user reads a lineage: it names Crawlmouse's own builds, not an account's data.
  if (table === 'measurement_lineages') return ['measurement_lineages_read'];
  const own = [`${table}_member_read`];
  if (table === 'alert_rules')
    own.push('alert_rules_member_delete', 'alert_rules_member_insert', 'alert_rules_member_update');
  if (table === 'page_results') own.push('page_results_crawl_worker_insert');
  return own.sort();
}

interface AclItem {
  grantee: string;
  privileges: string;
}

function aclItems(acl: string | null): AclItem[] {
  return (acl ?? '')
    .replace(/^\{|\}$/g, '')
    .split(',')
    .filter(Boolean)
    .map((item) => {
      const [grantee = '', rest = ''] = item.split('=');
      return { grantee: grantee || 'PUBLIC', privileges: rest.split('/')[0] ?? '' };
    });
}

const sorted = (s: string) => [...s].sort().join('');

/**
 * Every privilege the client roles and crawl_worker hold on `table`, compared with the plan as a
 * whole: table-level and per column, TRUNCATE included. Returns the differences.
 */
async function postureViolations(d: Db, table: NewTable): Promise<string[]> {
  const bad: string[] = [];
  const { rows: rel } = await d.query<{ rls: boolean; acl: string | null }>(
    `select c.relrowsecurity as rls, c.relacl::text as acl from pg_class c
       join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = $1`,
    [table],
  );
  if (!rel[0]) return [`${table}: not found`];
  if (!rel[0].rls) bad.push(`${table}: RLS is disabled`);
  const tableAcl = aclItems(rel[0].acl);
  const expectedTable: Record<string, string> = {
    postgres: 'arwdDxtm',
    service_role: 'arwdDxtm',
  };
  if (table === 'alert_rules') expectedTable.authenticated = 'd';
  if (table === 'page_results') expectedTable.crawl_worker = 'a';
  const actualTable = Object.fromEntries(tableAcl.map((a) => [a.grantee, sorted(a.privileges)]));
  for (const g of new Set([...Object.keys(expectedTable), ...Object.keys(actualTable)])) {
    if ((actualTable[g] ?? '') !== sorted(expectedTable[g] ?? ''))
      bad.push(
        `${table}: table grant to ${g} is "${actualTable[g] ?? ''}", planned "${expectedTable[g] ?? ''}"`,
      );
  }

  const { rows: cols } = await d.query<{ col: string; acl: string | null }>(
    `select a.attname as col, a.attacl::text as acl from pg_attribute a
       join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = $1 and a.attnum > 0 and not a.attisdropped`,
    [table],
  );
  const hidden = HIDDEN[table];
  for (const { col, acl } of cols) {
    let planned = '';
    if (hidden !== null && !hidden.includes(col)) planned += 'r';
    if (table === 'alert_rules' && ALERT_INSERT.includes(col)) planned += 'a';
    if (table === 'alert_rules' && ALERT_UPDATE.includes(col)) planned += 'w';
    const items = aclItems(acl);
    const actual = Object.fromEntries(items.map((a) => [a.grantee, sorted(a.privileges)]));
    for (const g of new Set(['authenticated', ...Object.keys(actual)])) {
      const want = g === 'authenticated' ? sorted(planned) : '';
      if ((actual[g] ?? '') !== want)
        bad.push(
          `${table}.${col}: column grant to ${g} is "${actual[g] ?? ''}", planned "${want}"`,
        );
    }
  }

  const { rows: pols } = await d.query<{ name: string }>(
    `select policyname as name from pg_policies where schemaname = 'public' and tablename = $1 order by 1`,
    [table],
  );
  const names = pols.map((p) => p.name);
  if (JSON.stringify(names) !== JSON.stringify(policiesFor(table)))
    bad.push(`${table}: policies are [${names}], planned [${policiesFor(table)}]`);
  return bad;
}

describe('migration 003 catalog posture', () => {
  it('creates exactly the planned tables', async () => {
    const pre = await freshDb();
    await applyAllMigrations(pre, undefined, before(MIGRATION_003));
    const post = await freshDb();
    await applyAllMigrations(post, undefined, through(MIGRATION_003));
    const tables = async (d: PGlite) =>
      (
        await d.query<{ name: string }>(
          `select relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`,
        )
      ).rows.map((r) => r.name);
    const preTables = new Set(await tables(pre));
    expect((await tables(post)).filter((t) => !preTables.has(t))).toEqual(NEW_TABLES);
  }, 120_000);

  // 006b's public tables too: the same posture rule covers them.
  for (const table of ALL_NEW_TABLES) {
    it(`${table}: RLS on, the planned policies, and no privilege beyond the plan (TRUNCATE included)`, async () => {
      expect(await postureViolations(db, table)).toEqual([]);
    });
  }

  it('seats.client_scope_all is readable by authenticated, like the other seat columns', async () => {
    const { rows } = await db.query<{ acl: string | null }>(
      `select attacl::text as acl from pg_attribute where attrelid = 'public.seats'::regclass
          and attname = 'client_scope_all'`,
    );
    expect(aclItems(rows[0]!.acl)).toEqual([{ grantee: 'authenticated', privileges: 'r' }]);
  });

  it('every function 003 creates pins search_path, and only the membership helpers are client-callable', async () => {
    // The names, read from the migration file, so a function added there is checked here.
    const created = [
      ...readMigration(MIGRATION_003).matchAll(
        /create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(/gi,
      ),
    ]
      .map((m) => m[1]!)
      .sort();
    expect(created.length, 'anti-vacuity').toBeGreaterThan(10);
    const { rows } = await db.query<{
      name: string;
      config: string[] | null;
      anon: boolean;
      authed: boolean;
    }>(
      `select p.proname as name, p.proconfig as config,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any($1::text[])
        order by 1`,
      [created],
    );
    expect(rows.map((r) => r.name)).toEqual(created);
    for (const r of rows) {
      // The CHECK helpers (v2_*) read no table, so they resolve nothing through public.
      expect(r.config, r.name).toEqual([
        r.name.startsWith('v2_') ? 'search_path=pg_catalog' : 'search_path=public, pg_catalog',
      ]);
      expect(r.anon, r.name).toBe(false);
      expect(r.authed, r.name).toBe(r.name === 'is_member_for_site');
    }
  });
});

describe('the posture rule catches a hostile change', () => {
  const hostile = async (sql: string, table: NewTable) => {
    const d = await freshDb();
    await applyAllMigrations(d);
    await d.exec(sql);
    return (await postureViolations(d, table)).join('\n');
  };
  it('catches: anon given TRUNCATE', async () => {
    expect(await hostile('grant truncate on public.checks to anon', 'checks')).toMatch(
      /table grant to anon/,
    );
  }, 120_000);
  it('catches: authenticated given SELECT on site_fixes.packet', async () => {
    expect(
      await hostile('grant select (packet) on public.site_fixes to authenticated', 'site_fixes'),
    ).toMatch(/site_fixes\.packet: column grant to authenticated/);
  }, 120_000);
  it('catches: changes.fix_id granted back', async () => {
    expect(
      await hostile('grant select (fix_id) on public.changes to authenticated', 'changes'),
    ).toMatch(/changes\.fix_id/);
  }, 120_000);
  it('catches: a second permissive policy', async () => {
    expect(
      await hostile(
        'create policy leak on public.sites for select to authenticated using (true)',
        'sites',
      ),
    ).toMatch(/policies are/);
  }, 120_000);
  it('catches: RLS off', async () => {
    expect(
      await hostile('alter table public.api_keys disable row level security', 'api_keys'),
    ).toMatch(/RLS is disabled/);
  }, 120_000);
  it('does not fire on an unrelated table', async () => {
    expect(await hostile('grant select on public.waitlist to anon', 'sites')).toBe('');
  }, 120_000);
});

// ─── CHECK constraints, each broken on its own ────────────────────────────────────────────────────

const NOT_A_VALUE = '__not_a_value__';

/** Row-rule and shape CHECKs: how to break each one alone. Enum CHECKs are generated below. */
const RULE_CASES: Record<
  string,
  { table: NewTable | 'seats'; row: () => Promise<Record<string, unknown>> }
> = {
  sites_schedule_complete: {
    table: 'sites',
    row: async () => ({ ...(await freshRow('sites')), schedule_cadence: null }),
  },
  sites_schedule_timed: {
    table: 'sites',
    row: async () => ({ ...(await freshRow('sites')), schedule_cadence: 'on_deploy' }),
  },
  sites_schedule_pair: {
    table: 'sites',
    row: async () => ({ ...(await freshRow('sites')), schedule_hour_local: null }),
  },
  sites_schedule_weekday: {
    table: 'sites',
    row: async () => ({ ...(await freshRow('sites')), schedule_iso_weekday: 0 }),
  },
  sites_schedule_hour: {
    table: 'sites',
    row: async () => ({ ...(await freshRow('sites')), schedule_hour_local: 24 }),
  },
  sites_unkept_audit: {
    table: 'sites',
    row: async () => ({ ...(await freshRow('sites')), account_id: null }),
  },
  sites_staging_kept: {
    table: 'sites',
    row: async () => ({
      ...(await freshRow('sites')),
      account_id: null,
      schedule_cadence: null,
      schedule_iso_weekday: null,
      schedule_hour_local: null,
      staging_of_site_id: world.site1,
    }),
  },
  sites_staging_pause: {
    table: 'sites',
    row: async () => ({ ...(await freshRow('sites')), paused_reason: 'staging_not_in_plan' }),
  },
  page_results_url: {
    table: 'page_results',
    row: async () => ({ ...(await freshRow('page_results')), url: 'javascript:alert(1)' }),
  },
  page_results_template_key: {
    table: 'page_results',
    row: async () => ({ ...(await freshRow('page_results')), template_key: 'products/{slug}' }),
  },
  page_results_status_code: {
    table: 'page_results',
    row: async () => ({ ...(await freshRow('page_results')), status_code: 99 }),
  },
  page_results_depth: {
    table: 'page_results',
    row: async () => ({ ...(await freshRow('page_results')), depth: -1 }),
  },
  page_results_links_in: {
    table: 'page_results',
    row: async () => ({ ...(await freshRow('page_results')), links_in: -1 }),
  },
  page_results_links_out: {
    table: 'page_results',
    row: async () => ({ ...(await freshRow('page_results')), links_out: -1 }),
  },
  page_results_pagerank_share: {
    table: 'page_results',
    row: async () => ({ ...(await freshRow('page_results')), pagerank_share: 1.5 }),
  },
  page_results_sitemap_lastmod: {
    table: 'page_results',
    row: async () => ({ ...(await freshRow('page_results')), sitemap_lastmod: '10000-01-01' }),
  },
  page_results_suggested_parent_url: {
    table: 'page_results',
    row: async () => ({
      ...(await freshRow('page_results')),
      suggested_parent_url: 'ftp://shop.example/',
    }),
  },
  page_results_without_js: {
    table: 'page_results',
    row: async () => ({
      ...(await freshRow('page_results')),
      without_js: {
        raw_words: 10,
        rendered_words: 12,
        text_share: 0.8,
        state: 'readable',
        extra: 1,
      },
    }),
  },
  page_results_crawlers_reached: {
    table: 'page_results',
    row: async () => ({ ...(await freshRow('page_results')), crawlers_reached: -1 }),
  },
  page_results_crawlers_reading_text: {
    table: 'page_results',
    row: async () => ({ ...(await freshRow('page_results')), crawlers_reading_text: -1 }),
  },
  page_results_final_url: {
    table: 'page_results',
    row: async () => ({ ...(await freshRow('page_results')), final_url: 'ftp://shop.example/' }),
  },
  page_results_redirect: {
    table: 'page_results',
    row: async () => ({ ...(await freshRow('page_results')), redirect: { hops: [], loop: 'no' } }),
  },
  page_results_canonical_declared: {
    table: 'page_results',
    row: async () => ({
      ...(await freshRow('page_results')),
      canonical_declared: { href: '', url: null },
    }),
  },
  page_results_hreflang: {
    table: 'page_results',
    row: async () => ({
      ...(await freshRow('page_results')),
      hreflang: { links: [], complete: 'yes' },
    }),
  },
  page_results_content_simhash: {
    table: 'page_results',
    row: async () => ({ ...(await freshRow('page_results')), content_simhash: 'ABC' }),
  },
  page_results_robots_search: {
    table: 'page_results',
    row: async () => ({
      ...(await freshRow('page_results')),
      robots_search: [{ ua: '', verdict: 'allowed' }],
    }),
  },
  page_results_links_read_html: {
    table: 'page_results',
    row: async () => ({ ...(await freshRow('page_results')), is_html: false, links_read: true }),
  },
  page_results_redirect_status: {
    table: 'page_results',
    row: async () => ({
      ...(await freshRow('page_results')),
      redirect: {
        hops: [{ from: 'https://shop.example/a', status: 200, location: 'https://shop.example/b' }],
        loop: false,
      },
    }),
  },
  page_results_redirect_loop: {
    table: 'page_results',
    row: async () => ({ ...(await freshRow('page_results')), redirect: { hops: [], loop: true } }),
  },
  page_results_canonical_href: {
    table: 'page_results',
    row: async () => ({
      ...(await freshRow('page_results')),
      canonical_declared: { href: null, url: 'https://shop.example/' },
    }),
  },
  page_results_robots_verdict: {
    table: 'page_results',
    row: async () => ({
      ...(await freshRow('page_results')),
      robots_search: [{ ua: 'Googlebot', verdict: 'allowed_thin' }],
    }),
  },
  page_results_robots_ua_unique: {
    table: 'page_results',
    row: async () => ({
      ...(await freshRow('page_results')),
      robots_search: [
        { ua: 'Googlebot', verdict: 'allowed' },
        { ua: 'Googlebot', verdict: 'allowed' },
      ],
    }),
  },
  access_tests_request_line: {
    table: 'access_tests',
    row: async () => ({ ...(await freshRow('access_tests')), method: 'GET', http_version: null }),
  },
  changes_severity: {
    table: 'changes',
    row: async () => ({ ...(await freshRow('changes')), severity: null }),
  },
  changes_resolved_info: {
    table: 'changes',
    row: async () => ({ ...(await freshRow('changes')), kind: 'resolved', severity: 'bad' }),
  },
  site_fixes_gone: {
    table: 'site_fixes',
    row: async () => ({ ...(await freshRow('site_fixes')), gone: { status_code: 404 } }),
  },
  page_results_content_failures: {
    table: 'page_results',
    row: async () => ({
      ...(await freshRow('page_results')),
      content_failures: [['direct_answer_150']],
    }),
  },
  checks_grade_version: {
    table: 'checks',
    row: async () => ({ ...(await freshRow('checks')), grade_version: '2.0' }),
  },
  checks_progress: {
    table: 'checks',
    row: async () => ({
      ...(await freshRow('checks')),
      status: 'running',
      lineage_id: null,
      finished_at: null,
      coverage: null,
      technical_seo: null,
      ai_readability: null,
    }),
  },
  checks_not_started: {
    table: 'checks',
    row: async () => ({
      ...(await freshRow('checks')),
      status: 'queued',
      lineage_id: null,
      finished_at: null,
      coverage: null,
      technical_seo: null,
      ai_readability: null,
    }),
  },
  checks_started: {
    table: 'checks',
    row: async () => ({
      ...(await freshRow('checks')),
      status: 'failed',
      lineage_id: null,
      started_at: null,
      failure_reason: 'timeout',
      coverage: null,
      technical_seo: null,
      ai_readability: null,
    }),
  },
  checks_finished_at: {
    table: 'checks',
    row: async () => ({ ...(await freshRow('checks')), finished_at: null }),
  },
  checks_deferred_until: {
    table: 'checks',
    row: async () => ({
      ...(await freshRow('checks')),
      status: 'deferred',
      lineage_id: null,
      started_at: null,
      finished_at: null,
      coverage: null,
      technical_seo: null,
      ai_readability: null,
    }),
  },
  checks_failure_reason: {
    table: 'checks',
    row: async () => ({
      ...(await freshRow('checks')),
      status: 'failed',
      lineage_id: null,
      coverage: null,
      technical_seo: null,
      ai_readability: null,
    }),
  },
  checks_coverage: {
    table: 'checks',
    row: async () => ({ ...(await freshRow('checks')), coverage: null }),
  },
  checks_both_grades: {
    table: 'checks',
    row: async () => ({ ...(await freshRow('checks')), ai_readability: null }),
  },
  checks_lineage: {
    table: 'checks',
    row: async () => ({ ...(await freshRow('checks')), lineage_id: null }),
  },
  measurement_lineages_engine_sha: {
    table: 'measurement_lineages',
    row: async () => ({ ...(await freshRow('measurement_lineages')), engine_sha: '5d165fa' }),
  },
  measurement_lineages_detector_ruleset_version: {
    table: 'measurement_lineages',
    row: async () => ({ ...(await freshRow('measurement_lineages')), detector_ruleset_version: 'v1' }),
  },
  measurement_lineages_crawler_registry_version: {
    table: 'measurement_lineages',
    row: async () => ({
      ...(await freshRow('measurement_lineages')),
      crawler_registry_version: '2026-10-27',
    }),
  },
  measurement_lineages_worker_release: {
    table: 'measurement_lineages',
    row: async () => ({ ...(await freshRow('measurement_lineages')), worker_release: 'has space' }),
  },
  measurement_lineages_population_version: {
    table: 'measurement_lineages',
    row: async () => ({ ...(await freshRow('measurement_lineages')), population_version: '1.0' }),
  },
  page_results_identity_sent: {
    table: 'page_results',
    row: async () => ({ ...(await freshRow('page_results')), identity_sent: '' }),
  },
  page_results_request_headers: {
    table: 'page_results',
    row: async () => ({
      ...(await freshRow('page_results')),
      request_headers: [{ name: 'User-Agent' }],
    }),
  },
  page_results_headers: {
    table: 'page_results',
    row: async () => ({
      ...(await freshRow('page_results')),
      headers: [{ name: 'server', value: 'x'.repeat(1025) }],
    }),
  },
  checks_grades_when_ended: {
    table: 'checks',
    row: async () => ({
      ...(await freshRow('checks')),
      status: 'failed',
      lineage_id: null,
      failure_reason: 'timeout',
      coverage: null,
      ai_readability: null,
    }),
  },
  access_tests_observed_owner_logs: {
    table: 'access_tests',
    row: async () => ({ ...(await freshRow('access_tests')), evidence_class: 'observed' }),
  },
  site_fixes_last_state: {
    table: 'site_fixes',
    row: async () => ({ ...(await freshRow('site_fixes')), last_state: 'not_detected' }),
  },
  site_fixes_rank: {
    table: 'site_fixes',
    row: async () => ({ ...(await freshRow('site_fixes')), rank: null }),
  },
  site_fixes_packet_framework: {
    table: 'site_fixes',
    row: async () => ({
      ...(await freshRow('site_fixes')),
      packet: { framework: 'nextjs', frameworks: ['generic'] },
    }),
  },
  site_fixes_effect_pending: {
    table: 'site_fixes',
    row: async () => ({
      ...(await freshRow('site_fixes')),
      effect: {
        technical_seo: 2,
        ai_readability: null,
        ai_readability_pending_on: [],
        estimate: true,
      },
    }),
  },
  fix_events_kind_fields: {
    table: 'fix_events',
    row: async () => ({ ...(await freshRow('fix_events')), check_id: null }),
  },
  evidence_blobs_version: {
    table: 'evidence_blobs',
    row: async () => ({ ...(await freshRow('evidence_blobs')), version: 0 }),
  },
  evidence_blobs_sha256: {
    table: 'evidence_blobs',
    row: async () => ({ ...(await freshRow('evidence_blobs')), sha256: 'ABC' }),
  },
  alert_rules_threshold: {
    table: 'alert_rules',
    row: async () => ({ ...(await freshRow('alert_rules')), threshold_points: 5 }),
  },
  alert_rules_fired_pair: {
    table: 'alert_rules',
    row: async () => ({
      ...(await freshRow('alert_rules')),
      last_fired_at: '2026-10-20T06:00:00Z',
    }),
  },
  reports_sent: {
    table: 'reports',
    row: async () => ({ ...(await freshRow('reports')), status: 'sent' }),
  },
  reports_send_time: {
    table: 'reports',
    row: async () => ({ ...(await freshRow('reports')), status: 'held' }),
  },
  reports_slug: {
    table: 'reports',
    row: async () => ({ ...(await freshRow('reports')), kind: 'public_link' }),
  },
  reports_open_tracking: {
    table: 'reports',
    row: async () => ({ ...(await freshRow('reports')), opened_at: '2026-10-21T06:00:00Z' }),
  },
  reports_covers_checks: {
    table: 'reports',
    row: async () => ({ ...(await freshRow('reports')), covers_check_ids: [] }),
  },
  report_schedules_client_report_cadence: {
    table: 'report_schedules',
    row: async () => ({ ...(await freshRow('report_schedules')), cadence: 'on_deploy' }),
  },
  report_schedules_weekday: {
    table: 'report_schedules',
    row: async () => ({ ...(await freshRow('report_schedules')), iso_weekday: 8 }),
  },
  report_schedules_time_local: {
    table: 'report_schedules',
    row: async () => ({ ...(await freshRow('report_schedules')), time_local: '24:00' }),
  },
  report_schedules_page_slug: {
    table: 'report_schedules',
    row: async () => ({ ...(await freshRow('report_schedules')), page_slug: 'Client A' }),
  },
  share_links_token_hash: {
    table: 'share_links',
    row: async () => ({ ...(await freshRow('share_links')), token_hash: 'plain-token' }),
  },
  api_keys_key_hash: {
    table: 'api_keys',
    row: async () => ({ ...(await freshRow('api_keys')), key_hash: 'cm_ro_secret' }),
  },
  api_keys_scopes_nonempty: {
    table: 'api_keys',
    row: async () => ({ ...(await freshRow('api_keys')), scopes: [] }),
  },
  deploy_hooks_token_hash: {
    table: 'deploy_hooks',
    row: async () => ({ ...(await freshRow('deploy_hooks')), token_hash: 'plain-token' }),
  },
  seats_owner_unscoped: {
    table: 'seats',
    row: async () => ({
      account_id: (await personalAccount(db, await signUp(db, `o-${randomUUID()}@example.com`)))
        .accountId,
      invited_email: `x-${randomUUID()}@example.com`,
      role: 'owner',
      status: 'invited',
      client_scope_all: false,
    }),
  },
};

describe('every CHECK on the new tables refuses a row on its own', () => {
  it('every CHECK is covered: an enum CHECK by the generated case, every other by a named case', async () => {
    const uncovered: string[] = [];
    const named = new Set(Object.keys(RULE_CASES));
    for (const table of [...NEW_TABLES, 'seats']) {
      for (const c of await constraints(db, table)) {
        if (table === 'seats' && c.name !== 'seats_owner_unscoped') continue; // 001's own
        if (enumSetOf(c.def) === null && !named.delete(c.name))
          uncovered.push(`${table}.${c.name}`);
      }
    }
    expect(uncovered, 'CHECKs without a case').toEqual([]);
    expect([...named], 'cases naming a CHECK that does not exist').toEqual([]);
  });

  for (const [name, c] of Object.entries(RULE_CASES)) {
    it(`${name}`, async () => {
      await expectOnlyViolates(c.table, await c.row(), name);
    });
  }

  it('the enum CHECKs on generated columns are exactly the measurement statuses', async () => {
    // No writer can put a value there, so no row can break them; their values are the contract's
    // MeasurementStatus (v2-contract-guard), and the expressions behind them are compared with the
    // contract's functions in v2-006b-data-foundations.test.ts.
    const found: string[] = [];
    for (const table of NEW_TABLES)
      for (const c of await constraints(db, table))
        if (enumSetOf(c.def) !== null && (await isGenerated(table, c.columns[0]!)))
          found.push(`${table}.${c.columns[0]}`);
    expect(found.sort()).toEqual([
      'access_tests.measurement_status',
      'checks.ai_readability_status',
      'checks.technical_seo_status',
    ]);
  });

  for (const table of NEW_TABLES) {
    it(`${table}: each enum CHECK refuses a value outside its set on its own`, async () => {
      const enums = (await constraints(db, table)).filter((c) => enumSetOf(c.def) !== null);
      for (const c of enums) {
        if (await isGenerated(table, c.columns[0]!)) continue; // the test above
        const col = c.columns[0]!;
        const base = await freshRow(table);
        const bad = Array.isArray(base[col]) || /<@/.test(c.def) ? [NOT_A_VALUE] : NOT_A_VALUE;
        await expectRefusesAlone(table, { ...base, [col]: bad }, c.name);
      }
    });
  }
});

async function isGenerated(table: string, column: string): Promise<boolean> {
  const { rows } = await db.query<{ g: string }>(
    `select attgenerated as g from pg_attribute where attrelid = ('public.' || $1)::regclass and attname = $2`,
    [table, column],
  );
  return rows[0]?.g === 's';
}

/** A check of world.site1, for rows that must cite one. */
async function aCheck(): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select id from public.checks where site_id = $1 limit 1`,
    [world.site1],
  );
  return rows[0]!.id;
}

/**
 * The other direction of every two-way rule CHECK ("X exactly when Y": the cases above break it with
 * X and not Y, these with Y and not X), and fix_events_kind_fields' other two shapes.
 */
const OTHER_WAY: {
  constraint: string;
  table: NewTable;
  label: string;
  row: () => Promise<Record<string, unknown>>;
}[] = [
  {
    constraint: 'access_tests_request_line',
    table: 'access_tests',
    label: 'an HTTP version without a method',
    row: async () => ({ ...(await freshRow('access_tests')), method: null, http_version: '1.1' }),
  },
  {
    constraint: 'changes_severity',
    table: 'changes',
    label: 'a severity on a changed row',
    row: async () => ({ ...(await freshRow('changes')), kind: 'changed', severity: 'info' }),
  },
  {
    constraint: 'sites_schedule_timed',
    table: 'sites',
    label: 'a timed cadence without a weekday',
    row: async () => ({
      ...(await freshRow('sites')),
      schedule_iso_weekday: null,
      schedule_hour_local: null,
    }),
  },
  {
    constraint: 'sites_schedule_pair',
    table: 'sites',
    label: 'an hour without a weekday',
    row: async () => ({
      ...(await freshRow('sites')),
      schedule_cadence: 'on_deploy',
      schedule_iso_weekday: null,
    }),
  },
  {
    constraint: 'checks_progress',
    table: 'checks',
    label: 'progress on a finished check',
    row: async () => ({ ...(await freshRow('checks')), progress: { steps: [] } }),
  },
  {
    constraint: 'checks_finished_at',
    table: 'checks',
    label: 'finished_at on a running check',
    row: async () => ({
      ...(await freshRow('checks')),
      status: 'running',
      lineage_id: null,
      progress: { steps: [] },
      coverage: null,
      technical_seo: null,
      ai_readability: null,
    }),
  },
  {
    constraint: 'checks_deferred_until',
    table: 'checks',
    label: 'deferred_until on a queued check',
    row: async () => ({
      ...(await freshRow('checks')),
      status: 'queued',
      lineage_id: null,
      started_at: null,
      finished_at: null,
      deferred_until: '2026-10-21T06:00:00Z',
      coverage: null,
      technical_seo: null,
      ai_readability: null,
    }),
  },
  {
    constraint: 'checks_failure_reason',
    table: 'checks',
    label: 'a failure reason on a finished check',
    row: async () => ({ ...(await freshRow('checks')), failure_reason: 'timeout' }),
  },
  {
    constraint: 'checks_lineage',
    table: 'checks',
    label: 'a lineage on a queued check',
    row: async () => ({
      ...(await freshRow('checks')),
      status: 'queued',
      started_at: null,
      finished_at: null,
      tested_at: null,
      coverage: null,
      technical_seo: null,
      ai_readability: null,
    }),
  },
  {
    constraint: 'checks_coverage',
    table: 'checks',
    label: 'coverage on a failed check',
    row: async () => ({
      ...(await freshRow('checks')),
      status: 'failed',
      lineage_id: null,
      failure_reason: 'timeout',
      technical_seo: null,
      ai_readability: null,
    }),
  },
  {
    constraint: 'access_tests_observed_owner_logs',
    table: 'access_tests',
    label: 'owner logs that are not observed evidence',
    row: async () => ({ ...(await freshRow('access_tests')), source_ip_class: 'owner_logs' }),
  },
  {
    constraint: 'site_fixes_rank',
    table: 'site_fixes',
    label: 'a rank on a resolved fix',
    row: async () => ({
      ...(await freshRow('site_fixes')),
      status: 'verified_resolved',
      last_state: 'not_detected',
    }),
  },
  {
    constraint: 'site_fixes_effect_pending',
    table: 'site_fixes',
    label: 'an AI effect while still pending',
    row: async () => ({
      ...(await freshRow('site_fixes')),
      effect: {
        technical_seo: 2,
        ai_readability: 1,
        ai_readability_pending_on: ['0123456789abcdef'],
        estimate: true,
      },
    }),
  },
  {
    constraint: 'alert_rules_threshold',
    table: 'alert_rules',
    label: 'a text-drop rule without a threshold',
    row: async () => ({
      ...(await freshRow('alert_rules')),
      kind: 'text_drop',
      threshold_points: null,
    }),
  },
  {
    constraint: 'alert_rules_fired_pair',
    table: 'alert_rules',
    label: 'a fired check without a time',
    row: async () => ({
      ...ROWS.alert_rules(randomUUID(), world.accountId, null, 'new_orphans'),
      last_fired_check_id: await aCheck(),
    }),
  },
  {
    constraint: 'reports_sent',
    table: 'reports',
    label: 'sent_at on a report that is not sent',
    row: async () => ({ ...(await freshRow('reports')), sent_at: '2026-10-21T06:00:00Z' }),
  },
  {
    constraint: 'reports_slug',
    table: 'reports',
    label: 'a public slug on a report that is not a public link',
    row: async () => ({ ...(await freshRow('reports')), public_slug: `r-${randomUUID()}` }),
  },
  {
    constraint: 'fix_events_kind_fields',
    table: 'fix_events',
    label: 'marked_done citing a check',
    row: async () => ({ ...(await freshRow('fix_events')), kind: 'marked_done' }),
  },
  {
    constraint: 'fix_events_kind_fields',
    table: 'fix_events',
    label: 'verified naming a seat',
    row: async () => ({ ...(await freshRow('fix_events')), by_seat_id: world.ownerSeatId }),
  },
];

describe('every two-way rule CHECK refuses both directions, each on its own', () => {
  it('every rule CHECK the contract marks two-way has a case for its other direction', () => {
    const twoWay = Object.entries(RULE_CHECKS)
      .filter(([rule]) => RULES[rule as keyof typeof RULES].twoWay)
      .map(([, c]) => c.constraint);
    const covered = new Set(OTHER_WAY.map((c) => c.constraint));
    expect(twoWay.filter((c) => !covered.has(c))).toEqual([]);
    expect(twoWay.length, 'anti-vacuity').toBeGreaterThan(10);
  });
  for (const c of OTHER_WAY) {
    it(`${c.constraint}: ${c.label}`, async () => {
      await expectOnlyViolates(c.table, await c.row(), c.constraint);
    });
  }
});

// ─── Tenant integrity ─────────────────────────────────────────────────────────────────────────────

describe('a row cannot point across accounts or sites', () => {
  let other: World;
  beforeAll(async () => {
    other = await seedWorld(db, 'other');
  }, 120_000);

  const otherCheck = async () =>
    (
      await db.query<{ id: string }>(`select id from public.checks where site_id = $1`, [
        other.site1,
      ])
    ).rows[0]!.id;

  it('a report cannot name a site of another account', async () => {
    const row = { ...(await freshRow('reports')), site_id: other.site1 };
    await expect(insertRow(db, 'reports', row)).rejects.toThrow(/reports_site_account_fkey/);
  });
  it('an alert rule cannot name a site of another account', async () => {
    const row = { ...(await freshRow('alert_rules')), site_id: other.site1 };
    await expect(insertRow(db, 'alert_rules', row)).rejects.toThrow(
      /alert_rules_site_account_fkey/,
    );
  });
  it('a report schedule cannot name a site of another account', async () => {
    const site = randomUUID();
    await insertRow(
      db,
      'sites',
      ROWS.sites(site, other.accountId, `o-${site.slice(0, 8)}.example`),
    );
    await expect(
      insertRow(db, 'report_schedules', ROWS.report_schedules(site, world.accountId)),
    ).rejects.toThrow(/report_schedules_site_account_fkey/);
  });
  it('seat_sites cannot pair a seat with a site of another account', async () => {
    await expect(
      insertRow(
        db,
        'seat_sites',
        ROWS.seat_sites(world.scopedSeatId, other.site1, world.accountId),
      ),
    ).rejects.toThrow(/seat_sites_site_account_fkey/);
    await expect(
      insertRow(
        db,
        'seat_sites',
        ROWS.seat_sites(other.scopedSeatId, world.site2, world.accountId),
      ),
    ).rejects.toThrow(/seat_sites_seat_account_fkey/);
  });
  it('a site owner seat must be a seat of the same account', async () => {
    const row = { ...(await freshRow('sites')), owner_seat_id: other.ownerSeatId };
    await expect(insertRow(db, 'sites', row)).rejects.toThrow(/sites_owner_seat_account_fkey/);
  });
  it('a fix, a change and an alert event cannot point at a check of another site', async () => {
    const check = await otherCheck();
    const fix = { ...(await freshRow('site_fixes')), last_measured_check_id: check };
    await expect(insertRow(db, 'site_fixes', fix)).rejects.toThrow(
      /site_fixes_last_measured_check_fkey/,
    );
    const change = { ...(await freshRow('changes')), check_id: check, where: `/${randomUUID()}` };
    await expect(insertRow(db, 'changes', change)).rejects.toThrow(/changes_check_site_fkey/);
    const prev = { ...(await freshRow('changes')), previous_check_id: check };
    await expect(insertRow(db, 'changes', prev)).rejects.toThrow(
      /changes_previous_check_site_fkey/,
    );
    const event = { ...(await freshRow('alert_events')), check_id: check };
    await expect(insertRow(db, 'alert_events', event)).rejects.toThrow(
      /alert_events_check_site_fkey/,
    );
  });
  it('a check cannot follow a check of another site', async () => {
    const row = { ...(await freshRow('checks')), previous_check_id: await otherCheck() };
    await expect(insertRow(db, 'checks', row)).rejects.toThrow(/checks_previous_check_site_fkey/);
  });
  it('a staging site belongs to a site of the same account', async () => {
    const row = { ...(await freshRow('sites')), staging_of_site_id: other.site1 };
    await expect(insertRow(db, 'sites', row)).rejects.toThrow(/sites_staging_of_account_fkey/);
  });
  it('a fix was first seen on a check of its own site', async () => {
    const row = { ...(await freshRow('site_fixes')), first_seen_check_id: await otherCheck() };
    await expect(insertRow(db, 'site_fixes', row)).rejects.toThrow(
      /site_fixes_first_seen_check_fkey/,
    );
  });
  it('a change names a fix of its own site', async () => {
    const { rows } = await db.query<{ id: string }>(
      `select id from public.site_fixes where site_id = $1 limit 1`,
      [other.site1],
    );
    const row = { ...(await freshRow('changes')), fix_id: rows[0]!.id };
    await expect(insertRow(db, 'changes', row)).rejects.toThrow(/changes_fix_site_fkey/);
  });
  it('a fix event cites a check of the fix’s site, and a seat of its account', async () => {
    const check = { ...(await freshRow('fix_events')), check_id: await otherCheck() };
    await expect(insertRow(db, 'fix_events', check)).rejects.toThrow(/check of the fix's site/);
    const seat = {
      ...(await freshRow('fix_events')),
      kind: 'marked_done',
      check_id: null,
      by_seat_id: other.ownerSeatId,
    };
    await expect(insertRow(db, 'fix_events', seat)).rejects.toThrow(/seat of the fix's account/);
  });
  it('an alert rule last fired on a check of its own sites', async () => {
    const at = '2026-10-21T06:00:00Z';
    const foreign = {
      ...ROWS.alert_rules(randomUUID(), world.accountId, null, 'grade_letter_moved'),
      last_fired_at: at,
      last_fired_check_id: await otherCheck(),
    };
    await expect(insertRow(db, 'alert_rules', foreign)).rejects.toThrow(
      /check of the rule's sites/,
    );
    const otherSite = {
      ...ROWS.alert_rules(randomUUID(), world.accountId, world.site2, 'grade_letter_moved'),
      last_fired_at: at,
      last_fired_check_id: await aCheck(), // a check of site1
    };
    await expect(insertRow(db, 'alert_rules', otherSite)).rejects.toThrow(
      /check of the rule's sites/,
    );
  });
  it('an alert event on one site cannot cite another site’s rule of the same account', async () => {
    const { rows } = await db.query<{ id: string }>(
      `select id from public.alert_rules where site_id = $1 limit 1`,
      [world.site1],
    );
    const { rows: c } = await db.query<{ id: string }>(
      `select id from public.checks where site_id = $1 limit 1`,
      [world.site2],
    );
    const row = ROWS.alert_events(randomUUID(), rows[0]!.id, world.site2, c[0]!.id);
    await expect(insertRow(db, 'alert_events', row)).rejects.toThrow(/one of the site's account's/);
  });
  it('a client report needs a kept site (the client_report half of the contract’s unkept_audit)', async () => {
    const site = randomUUID();
    await insertRow(db, 'sites', ROWS.sites(site, null, `unkept-${site.slice(0, 8)}.example`));
    await expect(
      insertRow(db, 'report_schedules', ROWS.report_schedules(site, world.accountId)),
    ).rejects.toThrow(/report_schedules_site_account_fkey/);
  });
  it('an alert event’s rule is one of its site’s account', async () => {
    const { rows } = await db.query<{ id: string }>(
      `select id from public.alert_rules where account_id = $1 limit 1`,
      [other.accountId],
    );
    const row = { ...(await freshRow('alert_events')), rule_id: rows[0]!.id };
    await expect(insertRow(db, 'alert_events', row)).rejects.toThrow(/one of the site's account's/);
  });
});

// ─── Deletes ──────────────────────────────────────────────────────────────────────────────────────

describe('deleting an account, a site or an anonymous site takes its rows with it', () => {
  const count = async (table: string, col: string, id: string) =>
    (
      await db.query<{ n: number }>(
        `select count(*)::int as n from public.${table} where ${col} = $1`,
        [id],
      )
    ).rows[0]!.n;

  it('an account with a full world, a fired account-wide rule and measured fix events', async () => {
    const w = await seedWorld(db, 'del');
    const { rows } = await db.query<{ id: string }>(
      `select id from public.checks where site_id = $1`,
      [w.site2],
    );
    await db.query(
      `update public.alert_rules set last_fired_at = now(), last_fired_check_id = $2
        where account_id = $1 and site_id is null`,
      [w.accountId, rows[0]!.id],
    );
    await db.query(`delete from public.accounts where id = $1`, [w.accountId]);
    for (const site of [w.site1, w.site2]) expect(await count('checks', 'site_id', site)).toBe(0);
  });

  it('a kept site whose fix carries a verified event and whose own rule fired on its check', async () => {
    const w = await seedWorld(db, 'delsite');
    const { rows } = await db.query<{ id: string }>(
      `select id from public.checks where site_id = $1`,
      [w.site1],
    );
    await db.query(
      `update public.alert_rules set last_fired_at = now(), last_fired_check_id = $2 where site_id = $1`,
      [w.site1, rows[0]!.id],
    );
    await db.query(`delete from public.sites where id = $1`, [w.site1]);
    expect(await count('site_fixes', 'site_id', w.site1)).toBe(0);
  });

  it('one kept site cannot be hard-deleted while an account-wide rule last fired on its check', async () => {
    // Removing a site is a soft delete (removed_at); account deletion is unaffected (above).
    const w = await seedWorld(db, 'delrule');
    const { rows } = await db.query<{ id: string }>(
      `select id from public.checks where site_id = $1`,
      [w.site2],
    );
    await db.query(
      `update public.alert_rules set last_fired_at = now(), last_fired_check_id = $2
        where account_id = $1 and site_id is null`,
      [w.accountId, rows[0]!.id],
    );
    await expect(db.query(`delete from public.sites where id = $1`, [w.site2])).rejects.toThrow(
      /alert_rules_last_fired_check_id_fkey/,
    );
  });

  it('an anonymous site, with its checks, fixes and events (the TTL cleanup)', async () => {
    const site = randomUUID();
    const check = randomUUID();
    const fix = randomUUID();
    await insertRow(db, 'sites', ROWS.sites(site, null, `anon-${site.slice(0, 8)}.example`));
    await insertRow(db, 'checks', ROWS.checks(check, site));
    await insertRow(db, 'site_fixes', ROWS.site_fixes(fix, site, check, 1));
    await insertRow(db, 'fix_events', ROWS.fix_events(randomUUID(), fix, check));
    await db.query(`delete from public.sites where id = $1`, [site]);
    expect(await count('checks', 'site_id', site)).toBe(0);
  });

  it('a check an event still cites cannot be deleted on its own: refused at commit', async () => {
    const row = await freshRow('fix_events');
    // A second check of the fix's site, cited by the event only (not by the fix itself).
    const { rows } = await db.query<{ site_id: string }>(
      `select site_id from public.checks where id = $1`,
      [row.check_id],
    );
    const cited = randomUUID();
    await insertRow(db, 'checks', ROWS.checks(cited, rows[0]!.site_id));
    await insertRow(db, 'fix_events', { ...row, check_id: cited });
    let deletedBeforeCommit = false;
    await expect(
      db.transaction(async (tx) => {
        await tx.query(`delete from public.checks where id = $1`, [cited]);
        deletedBeforeCommit = true; // deferred: the statement itself succeeds
      }),
    ).rejects.toThrow(/fix_events_check_id_fkey/);
    expect(deletedBeforeCommit).toBe(true);
  });
});

// ─── Unique keys ──────────────────────────────────────────────────────────────────────────────────

describe('the unique keys', () => {
  it('a retried diff cannot write the same change twice, ua null included', async () => {
    const row = { ...(await freshRow('changes')), ua: null };
    await insertRow(db, 'changes', row);
    await expect(insertRow(db, 'changes', { ...row, id: randomUUID() })).rejects.toThrow(
      /changes_idempotency_uq/,
    );
    await insertRow(db, 'changes', { ...row, id: randomUUID(), where: '/collections/*' });
  });
  it('two fixes opened in one check may share subject, place and crawler', async () => {
    const row = await freshRow('changes');
    const fixes: string[] = [];
    for (const n of [41, 42]) {
      const id = randomUUID();
      await insertRow(
        db,
        'site_fixes',
        ROWS.site_fixes(id, row.site_id as string, row.check_id as string, n),
      );
      fixes.push(id);
    }
    await insertRow(db, 'changes', { ...row, fix_id: fixes[0] });
    await insertRow(db, 'changes', { ...row, id: randomUUID(), fix_id: fixes[1] });
  });
  it('a re-run finalize cannot write a second blob of the same version', async () => {
    const row = await freshRow('evidence_blobs');
    await insertRow(db, 'evidence_blobs', row);
    await expect(insertRow(db, 'evidence_blobs', { ...row, id: randomUUID() })).rejects.toThrow(
      /evidence_blobs_check_version_uq/,
    );
  });
  it('one fix per fingerprint per site', async () => {
    const row = await freshRow('site_fixes');
    await insertRow(db, 'site_fixes', row);
    await expect(insertRow(db, 'site_fixes', { ...row, id: randomUUID() })).rejects.toThrow(
      /site_fixes_site_fingerprint_uq/,
    );
  });
  it('one alert rule per kind per scope, the account-wide scope included', async () => {
    const row = ROWS.alert_rules(randomUUID(), world.accountId, null, 'text_drop');
    await insertRow(db, 'alert_rules', row);
    await expect(insertRow(db, 'alert_rules', { ...row, id: randomUUID() })).rejects.toThrow(
      /alert_rules_scope_kind_uq/,
    );
  });
  it('a kept host is unique per account; a removed site frees its host', async () => {
    const row = await freshRow('sites');
    await insertRow(db, 'sites', row);
    await expect(insertRow(db, 'sites', { ...row, id: randomUUID() })).rejects.toThrow(
      /sites_account_host_uq/,
    );
    await db.query(`update public.sites set removed_at = now() where id = $1`, [row.id]);
    await insertRow(db, 'sites', { ...row, id: randomUUID() });
  });
});

// ─── URL hashes ───────────────────────────────────────────────────────────────────────────────────

describe('URL hashes are the sha256 of the UTF-8 URL, as frontier.url_hash', () => {
  const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
  it('page_results.url_hash, for a URL with non-ASCII and a backslash', async () => {
    const row = await freshRow('page_results');
    const url = 'https://x.example/zelt-größe\\a';
    await insertRow(db, 'page_results', { ...row, url });
    const { rows } = await db.query<{ h: string }>(
      `select url_hash as h from public.page_results where check_id = $1 and url = $2`,
      [row.check_id, url],
    );
    expect(rows[0]!.h).toBe(sha(url));
  });
  it('link_edges.from_hash and to_hash, recomputed when the URL changes', async () => {
    const row = await freshRow('link_edges');
    await insertRow(db, 'link_edges', row);
    await db.query(
      `update public.link_edges set to_url = 'https://x.example/ü' where check_id = $1`,
      [row.check_id],
    );
    const { rows } = await db.query<{ f: string; t: string }>(
      `select from_hash as f, to_hash as t from public.link_edges where check_id = $1`,
      [row.check_id],
    );
    expect(rows[0]).toEqual({ f: sha(row.from_url as string), t: sha('https://x.example/ü') });
  });
  it('a caller-supplied hash is overwritten', async () => {
    const row = await freshRow('page_results');
    await insertRow(db, 'page_results', { ...row, url_hash: 'forged' });
    const { rows } = await db.query<{ h: string }>(
      `select url_hash as h from public.page_results where check_id = $1`,
      [row.check_id],
    );
    expect(rows[0]!.h).toBe(sha(row.url as string));
  });
});

// ─── fix_events: append-only ──────────────────────────────────────────────────────────────────────

describe('fix_events is append-only, for every writer', () => {
  async function anEvent() {
    const row = await freshRow('fix_events');
    await insertRow(db, 'fix_events', row);
    return row as { id: string; fix_id: string };
  }
  it('refuses an update, even as service_role', async () => {
    const e = await anEvent();
    await expect(
      asRole(db, 'service_role', null, (tx) =>
        tx.query(`update public.fix_events set at = now() where id = $1`, [e.id]),
      ),
    ).rejects.toThrow(/append-only/);
  });
  it('refuses a delete while its fix exists, even as service_role', async () => {
    const e = await anEvent();
    await expect(
      asRole(db, 'service_role', null, (tx) =>
        tx.query(`delete from public.fix_events where id = $1`, [e.id]),
      ),
    ).rejects.toThrow(/append-only/);
  });
  it('refuses TRUNCATE', async () => {
    await expect(
      asRole(db, 'service_role', null, (tx) => tx.exec(`truncate public.fix_events`)),
    ).rejects.toThrow(/append-only/);
  });
  it('goes with its fix when the fix is deleted', async () => {
    const e = await anEvent();
    await db.query(`delete from public.site_fixes where id = $1`, [e.fix_id]);
    const { rows } = await db.query(`select 1 from public.fix_events where id = $1`, [e.id]);
    expect(rows).toEqual([]);
  });
  it('lets a deleted seat clear by_seat_id, and nothing else', async () => {
    const user = await signUp(db, `gone-${randomUUID()}@example.com`);
    const seat = randomUUID();
    await db.query(
      `insert into public.seats (id, account_id, user_id, invited_email, role, status, accepted_at)
       values ($1, $2, $3, 'gone@example.com', 'developer', 'active', now())`,
      [seat, world.accountId, user],
    );
    const row: Record<string, unknown> = {
      ...(await freshRow('fix_events')),
      kind: 'marked_done',
      check_id: null,
      by_seat_id: seat,
    };
    await insertRow(db, 'fix_events', row);
    await db.query(`delete from public.users where id = $1`, [user]); // cascades to the seat
    const { rows } = await db.query<{ by_seat_id: string | null; kind: string }>(
      `select by_seat_id, kind from public.fix_events where id = $1`,
      [row.id],
    );
    expect(rows).toEqual([{ by_seat_id: null, kind: 'marked_done' }]);
  });
  it('refuses clearing by_seat_id while the seat still exists', async () => {
    const row: Record<string, unknown> = {
      ...(await freshRow('fix_events')),
      kind: 'marked_done',
      check_id: null,
      by_seat_id: world.ownerSeatId,
    };
    await insertRow(db, 'fix_events', row);
    await expect(
      db.query(`update public.fix_events set by_seat_id = null where id = $1`, [row.id]),
    ).rejects.toThrow(/append-only/);
  });
});

// ─── alert_rules: the entitlement trigger and the client write path ───────────────────────────────

/** Put an account into a state directly, keeping 001's CHECKs satisfied. */
async function setState(
  accountId: string,
  s: {
    state: string;
    tier: string;
    trial_variant?: string | null;
    trial_ends_at?: string | null;
    past_due_tier?: string | null;
    past_due_since?: string | null;
    subscription?: string | null;
  },
) {
  await db.query(
    `update public.accounts
        set state = $2, tier = $3, trial_variant = $4, trial_ends_at = $5::timestamptz,
            trial_used_at = case when $2 in ('pro_trial', 'agency_trial') then now() else trial_used_at end,
            past_due_tier = $6, past_due_since = $7::timestamptz, current_subscription_id = $8,
            state_history = state_history || jsonb_build_array(jsonb_build_object('state', $2::text,
              'since', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))
      where id = $1`,
    [
      accountId,
      s.state,
      s.tier,
      s.trial_variant ?? null,
      s.trial_ends_at ?? null,
      s.past_due_tier ?? null,
      s.past_due_since ?? null,
      s.subscription ?? null,
    ],
  );
}

async function newAccount(): Promise<{ accountId: string; ownerId: string; siteId: string }> {
  const ownerId = await signUp(db, `acct-${randomUUID()}@example.com`);
  const { accountId } = await personalAccount(db, ownerId);
  const siteId = randomUUID();
  await insertRow(db, 'sites', ROWS.sites(siteId, accountId, `a-${siteId.slice(0, 8)}.example`));
  return { accountId, ownerId, siteId };
}

/** A rule as a client inserts it: the columns `authenticated` may write, no id. */
const clientRule = (accountId: string, siteId: string | null, kind = 'crawler_blocked') => {
  const {
    id: _id,
    last_fired_at: _a,
    last_fired_check_id: _c,
    ...rest
  } = ROWS.alert_rules('', accountId, siteId, kind);
  return rest;
};

const slackRule = (accountId: string, siteId: string | null) => ({
  ...ROWS.alert_rules(randomUUID(), accountId, siteId),
  channels: ['email', 'slack'],
});
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

describe('alert_rules_entitlement_check: Slack only on a tier that has it, whoever writes', () => {
  it('refuses Slack on Free, as service_role', async () => {
    const a = await newAccount();
    await expect(
      asRole(db, 'service_role', null, (tx) =>
        insertRow(tx, 'alert_rules', slackRule(a.accountId, a.siteId)),
      ),
    ).rejects.toThrow(/Slack alerts need a paid plan/);
  });
  it('refuses turning Slack on later, by update', async () => {
    const a = await newAccount();
    const rule = ROWS.alert_rules(randomUUID(), a.accountId, a.siteId);
    await insertRow(db, 'alert_rules', rule);
    await expect(
      db.query(`update public.alert_rules set channels = '{email,slack}' where id = $1`, [rule.id]),
    ).rejects.toThrow(/Slack alerts need a paid plan/);
  });
  it('allows Slack on Pro', async () => {
    const a = await newAccount();
    await setState(a.accountId, { state: 'pro', tier: 'pro', subscription: 'sub_pro' });
    await insertRow(db, 'alert_rules', slackRule(a.accountId, a.siteId));
  });
  it('a no-card trial past trial_ends_at is Free, before its expiry event arrives', async () => {
    const live = await newAccount();
    await setState(live.accountId, {
      state: 'pro_trial',
      tier: 'pro',
      trial_variant: 'no_card',
      trial_ends_at: days(1),
    });
    await insertRow(db, 'alert_rules', slackRule(live.accountId, live.siteId));
    const lapsed = await newAccount();
    await setState(lapsed.accountId, {
      state: 'pro_trial',
      tier: 'pro',
      trial_variant: 'no_card',
      trial_ends_at: days(-1),
    });
    await expect(
      insertRow(db, 'alert_rules', slackRule(lapsed.accountId, lapsed.siteId)),
    ).rejects.toThrow(/Slack alerts need a paid plan/);
  });
  it('past_due keeps its tier for 168 hours from past_due_since, then is Free', async () => {
    const grace = await newAccount();
    await setState(grace.accountId, {
      state: 'past_due',
      tier: 'pro',
      past_due_tier: 'pro',
      past_due_since: hours(-167.9),
      subscription: 'sub_pd',
    });
    await insertRow(db, 'alert_rules', slackRule(grace.accountId, grace.siteId));
    const over = await newAccount();
    await setState(over.accountId, {
      state: 'past_due',
      tier: 'pro',
      past_due_tier: 'pro',
      past_due_since: hours(-168.1),
      subscription: 'sub_pd',
    });
    await expect(
      insertRow(db, 'alert_rules', slackRule(over.accountId, over.siteId)),
    ).rejects.toThrow(/Slack alerts need a paid plan/);
  });
  it('after a downgrade a Slack rule can still be switched off and stamped; adding Slack stays refused', async () => {
    const a = await newAccount();
    await setState(a.accountId, { state: 'pro', tier: 'pro', subscription: 'sub_pro' });
    const rule: Record<string, unknown> = slackRule(a.accountId, a.siteId);
    await insertRow(db, 'alert_rules', rule);
    await setState(a.accountId, { state: 'free', tier: 'free' });
    await asRole(db, 'authenticated', a.ownerId, (tx) =>
      tx.query(`update public.alert_rules set enabled = false where id = $1`, [rule.id]),
    );
    const check = randomUUID();
    await insertRow(db, 'checks', ROWS.checks(check, a.siteId));
    await asRole(db, 'service_role', null, (tx) =>
      tx.query(
        `update public.alert_rules set last_fired_at = now(), last_fired_check_id = $2 where id = $1`,
        [rule.id, check],
      ),
    );
    const other = ROWS.alert_rules(randomUUID(), a.accountId, a.siteId, 'new_orphans');
    await insertRow(db, 'alert_rules', other);
    await expect(
      db.query(`update public.alert_rules set channels = '{email,slack}' where id = $1`, [
        other.id,
      ]),
    ).rejects.toThrow(/Slack alerts need a paid plan/);
  });
  it('a non-member learns nothing about an account’s plan from it: RLS refuses first', async () => {
    const free = await newAccount();
    const paid = await newAccount();
    await setState(paid.accountId, { state: 'pro', tier: 'pro', subscription: 'sub_pro' });
    const stranger = await newAccount();
    for (const target of [free, paid]) {
      await expect(
        asRole(db, 'authenticated', stranger.ownerId, (tx) =>
          insertRow(tx, 'alert_rules', {
            ...clientRule(target.accountId, null, 'any_change'),
            channels: ['slack'],
          }),
        ),
      ).rejects.toThrow(/row-level security/);
    }
  });
  it('moving a Slack rule to a Free account is adding Slack there, and is refused', async () => {
    const paid = await newAccount();
    await setState(paid.accountId, { state: 'pro', tier: 'pro', subscription: 'sub_pro' });
    const free = await newAccount();
    const rule: Record<string, unknown> = slackRule(paid.accountId, null);
    await insertRow(db, 'alert_rules', rule);
    await expect(
      asRole(db, 'service_role', null, (tx) =>
        tx.query(`update public.alert_rules set account_id = $2 where id = $1`, [
          rule.id,
          free.accountId,
        ]),
      ),
    ).rejects.toThrow(/Slack alerts need a paid plan/);
  });
  it('a client cannot switch the trigger off', async () => {
    const a = await newAccount();
    await expect(
      asRole(db, 'authenticated', a.ownerId, (tx) =>
        tx.exec(`alter table public.alert_rules disable trigger alert_rules_entitlement_check`),
      ),
    ).rejects.toThrow(/must be owner/);
  });
});

describe('alert_rules: the client write path', () => {
  it('the owner writes a rule for a site, and the trigger still refuses Slack on Free', async () => {
    const a = await newAccount();
    await asRole(db, 'authenticated', a.ownerId, (tx) =>
      insertRow(tx, 'alert_rules', clientRule(a.accountId, a.siteId, 'text_drop')),
    );
    const res = await asRole(db, 'authenticated', a.ownerId, (tx) =>
      tx.query(
        `update public.alert_rules set threshold_points = 20 where site_id = $1 and kind = 'text_drop'`,
        [a.siteId],
      ),
    );
    expect(res.affectedRows).toBe(1);
    await expect(
      asRole(db, 'authenticated', a.ownerId, (tx) =>
        insertRow(tx, 'alert_rules', {
          ...clientRule(a.accountId, a.siteId, 'any_change'),
          channels: ['slack'],
        }),
      ),
    ).rejects.toThrow(/Slack alerts need a paid plan/);
  });
  it('a client cannot choose an id, set last_fired_at or last_fired_check_id, or change the kind', async () => {
    const a = await newAccount();
    const rule = ROWS.alert_rules(randomUUID(), a.accountId, a.siteId);
    await insertRow(db, 'alert_rules', rule);
    for (const sql of [
      `update public.alert_rules set last_fired_at = now() where id = $1`,
      `update public.alert_rules set kind = 'any_change' where id = $1`,
    ]) {
      await expect(
        asRole(db, 'authenticated', a.ownerId, (tx) => tx.query(sql, [rule.id])),
      ).rejects.toThrow(/permission denied/);
    }
    await expect(
      asRole(db, 'authenticated', a.ownerId, (tx) =>
        insertRow(tx, 'alert_rules', {
          ...clientRule(a.accountId, a.siteId, 'new_orphans'),
          id: randomUUID(),
        }),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it('a scoped seat writes rules for its site only, and no account-wide rule', async () => {
    await asRole(db, 'authenticated', world.scopedUserId, (tx) =>
      insertRow(tx, 'alert_rules', clientRule(world.accountId, world.site1, 'new_orphans')),
    );
    await expect(
      asRole(db, 'authenticated', world.scopedUserId, (tx) =>
        insertRow(tx, 'alert_rules', clientRule(world.accountId, world.site2, 'new_orphans')),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asRole(db, 'authenticated', world.scopedUserId, (tx) =>
        insertRow(tx, 'alert_rules', clientRule(world.accountId, null, 'fix_regressed')),
      ),
    ).rejects.toThrow(/row-level security/);
  });
  it('an unscoped non-owner writes site rules but not account-wide ones', async () => {
    const user = await signUp(db, `mgr-${randomUUID()}@example.com`);
    await db.query(
      `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
       values ($1, $2, 'mgr@example.com', 'account_manager', 'active', now())`,
      [world.accountId, user],
    );
    await asRole(db, 'authenticated', user, (tx) =>
      insertRow(tx, 'alert_rules', clientRule(world.accountId, world.site2, 'new_orphans')),
    );
    await expect(
      asRole(db, 'authenticated', user, (tx) =>
        insertRow(tx, 'alert_rules', clientRule(world.accountId, null, 'any_change')),
      ),
    ).rejects.toThrow(/row-level security/);
  });
  it('a member deletes its rule; nobody can move a rule to another site', async () => {
    const rule = ROWS.alert_rules(randomUUID(), world.accountId, world.site1, 'grade_letter_moved');
    await insertRow(db, 'alert_rules', rule);
    await expect(
      asRole(db, 'authenticated', world.ownerId, (tx) =>
        tx.query(`update public.alert_rules set site_id = $2 where id = $1`, [
          rule.id,
          world.site2,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
    const res = await asRole(db, 'authenticated', world.ownerId, (tx) =>
      tx.query(`delete from public.alert_rules where id = $1`, [rule.id]),
    );
    expect(res.affectedRows).toBe(1);
  });
});

// ─── Query plans of the membership helpers ────────────────────────────────────────────────────────

describe('the membership helpers probe indexes, not whole tables, at seeded volumes', () => {
  let big: PGlite;
  let probe: { userId: string; accountId: string; siteId: string };
  beforeAll(async () => {
    big = await freshDb();
    await applyAllMigrations(big);
    // 1,500 sign-ups (each: user, personal account, owner seat), one site each, 600 extra scoped
    // developer seats on the first 600 accounts, each scoped to its account's site.
    await big.exec(`
      insert into auth.users (id, email)
      select gen_random_uuid(), 'bulk-' || g || '@example.com' from generate_series(1, 1500) g;
      insert into public.sites (account_id, host, created_at)
      select a.id, 'bulk-' || row_number() over () || '.example', now() from public.accounts a;
      with dev as (
        insert into auth.users (id, email)
        select gen_random_uuid(), 'dev-bulk-' || g || '@example.com' from generate_series(1, 600) g
        returning id
      ), paired as (
        select d.id as user_id, a.id as account_id
          from (select id, row_number() over () as n from dev) d
          join (select id, row_number() over (order by id) as n from public.accounts) a on a.n = d.n
      ), seated as (
        insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at, client_scope_all)
        select account_id, user_id, 'dev@example.com', 'developer', 'active', now(), false from paired
        returning id, account_id
      )
      insert into public.seat_sites (seat_id, site_id, account_id)
      select s.id, st.id, s.account_id from seated s join public.sites st on st.account_id = s.account_id;
      analyze;
    `);
    const { rows } = await big.query<{ user_id: string; account_id: string; site_id: string }>(
      `select s.user_id, s.account_id, st.id as site_id from public.seats s
         join public.sites st on st.account_id = s.account_id
        where s.role = 'developer' limit 1`,
    );
    probe = { userId: rows[0]!.user_id, accountId: rows[0]!.account_id, siteId: rows[0]!.site_id };
  }, 240_000);

  /** EXPLAIN of the function's own body, read from pg_proc, for `arg` and the probe user. */
  async function planOf(fn: string, param: string, arg: string): Promise<string> {
    const { rows } = await big.query<{ src: string }>(
      `select prosrc as src from pg_proc where proname = $1`,
      [fn],
    );
    const body = rows[0]!.src
      .replace(new RegExp(`\\b${param}\\b`, 'g'), '$1')
      .trim()
      .replace(/;$/, '');
    return big.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [probe.userId]);
      await tx.exec(`prepare plan_probe(uuid) as ${body}`);
      const res = await tx.query<{ 'QUERY PLAN': string }>(`explain execute plan_probe('${arg}')`);
      await tx.exec(`deallocate plan_probe`);
      const text = res.rows.map((r) => r['QUERY PLAN']).join('\n');
      if (process.env.PRINT_PLANS) process.stdout.write(`\n-- ${fn}\n${text}\n`);
      return text;
    });
  }

  it('is_member: no sequential scan on seats or accounts', async () => {
    const plan = await planOf('is_member', 'p_account', probe.accountId);
    expect(plan).not.toMatch(/Seq Scan on (seats|accounts)\b/);
    expect(plan).toMatch(/Index (Only )?Scan using \w+ on seats\b|Bitmap Index Scan on seats_\w+/);
  });

  it('is_member_for_site: no sequential scan on seats, seat_sites, sites or accounts', async () => {
    const plan = await planOf('is_member_for_site', 'p_site', probe.siteId);
    expect(plan).not.toMatch(/Seq Scan on (seats|seat_sites|sites|accounts)\b/);
    expect(plan).toMatch(/Index (Only )?Scan using \w+ on seats\b|Bitmap Index Scan on seats_\w+/);
  });
});

describe('a jsonb null document is read as null, as the contract reads it', () => {
  // jsonb_populate_record (PostgREST) turns JSON null into SQL NULL; a raw-SQL writer can store the
  // jsonb value null, which every reader parses as null.
  const pageRow = async () => {
    const row = await freshRow('page_results');
    await insertRow(db, 'page_results', row);
    return row as { check_id: string; url: string };
  };
  for (const col of ['redirect', 'canonical_declared', 'hreflang', 'without_js'] as const) {
    it(`page_results.${col} accepts it`, async () => {
      const r = await pageRow();
      await db.query(
        `update public.page_results set ${col} = 'null'::jsonb where check_id = $1 and url = $2`,
        [r.check_id, r.url],
      );
    });
  }
  it('page_results.robots_search, which the contract requires, refuses it', async () => {
    const r = await pageRow();
    await expect(
      db.query(
        `update public.page_results set robots_search = 'null'::jsonb where check_id = $1 and url = $2`,
        [r.check_id, r.url],
      ),
    ).rejects.toThrow(/page_results_robots_search/);
  });
  it('site_fixes.gone accepts it whatever the last state', async () => {
    const row: Record<string, unknown> = {
      ...(await freshRow('site_fixes')),
      last_state: 'detected',
    };
    await insertRow(db, 'site_fixes', row);
    await db.query(`update public.site_fixes set gone = 'null'::jsonb where id = $1`, [row.id]);
  });
});
