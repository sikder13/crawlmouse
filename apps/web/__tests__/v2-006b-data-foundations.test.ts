import { createHash, randomUUID } from 'node:crypto';
import type { PGlite, Transaction } from '@electric-sql/pglite';
import {
  AccessCauseSchema,
  aiReadabilityStatus,
  CheckStatusSchema,
  CmsNameSchema,
  JsTextStateSchema,
  MeasurementStatusSchema,
  PacketFrameworkSchema,
  SignalKindSchema,
  SourceIpClassSchema,
  technicalSeoStatus,
  VerdictSchema,
  verdictStatus,
} from '@crawlmouse/types/v2';
import { beforeAll, describe, expect, it } from 'vitest';
import { catalogSnapshot } from './helpers/catalog-snapshot';
import {
  deidentificationViolations,
  lineageViolations,
  MEASUREMENT_TABLES,
} from './helpers/data-foundations';
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
  MIGRATION_006B,
  MONTH0,
  ROWS,
  before,
  insertLedgerRow,
  insertRow,
  ledgerObservation,
  ledgerRun,
  prepareMeasurement,
  revertFile,
  seedWorld,
  enumSetOf,
  through,
  type World,
} from './helpers/v2-check-tables';

/**
 * CC-06b, the data foundations (docs/specs/v2/06b-data-foundations.md): lineage on every measurement,
 * measurement status as generated columns, monthly partitions, the de-identified research ledger and
 * usage metering. Everything runs the real migration files on PGlite and reads the result from the
 * catalog or by acting as each role.
 */

type Db = PGlite | Transaction;
const ROLLBACK = revertFile(MIGRATION_006B);
const SITE_KEY = (s: string) => createHash('sha256').update(s).digest('hex');
const CLIENT_ROLES = ['anon', 'authenticated', 'crawl_worker'] as const;

let db: PGlite;
let world: World;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  await prepareMeasurement(db);
  world = await seedWorld(db, 'foundations');
}, 120_000);

/** Run `fn` as `role` with no JWT: research_retention, or the table owner (`postgres`). */
async function asPlainRole<T>(d: PGlite, role: string, fn: (tx: Transaction) => Promise<T>) {
  return d.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    return fn(tx);
  });
}

/** A check of world.site1 and its queued month. */
async function aCheck(): Promise<{ id: string; month: string }> {
  const { rows } = await db.query<{ id: string; month: string }>(
    `select id::text, check_month::text as month from public.checks where site_id = $1 limit 1`,
    [world.site1],
  );
  return rows[0]!;
}

// ─── 1. Lineage ───────────────────────────────────────────────────────────────────────────────────

describe('lineage: every measurement row names what produced it', () => {
  it('every measurement table has a required lineage_id; every table with a check_id is classified', async () => {
    expect(await lineageViolations(db)).toEqual([]);
  });

  it('catches a new table with a check_id that nobody classified', async () => {
    const found = await db
      .transaction(async (tx) => {
        await tx.exec(`create table public.render_results (check_id uuid, words integer)`);
        throw await lineageViolations(tx);
      })
      .catch((x: string[]) => x);
    expect(found).toEqual([
      'render_results: has check_id but is neither a measurement nor a derived table',
    ]);
  });

  it.each(MEASUREMENT_TABLES)('catches %s losing its lineage foreign key', async (table) => {
    const found = await db
      .transaction(async (tx) => {
        const { rows } = await tx.query<{ name: string }>(
          `select conname as name from pg_constraint where conrelid = ('public.' || $1)::regclass
              and confrelid = 'public.measurement_lineages'::regclass`,
          [table],
        );
        await tx.exec(`alter table public.${table} drop constraint ${rows[0]!.name}`);
        throw await lineageViolations(tx);
      })
      .catch((x: string[]) => x);
    expect(found).toEqual([`${table}: no lineage_id foreign key to measurement_lineages`]);
  });

  it('crawler_observations reach their lineage through their run, which they cannot outlive', async () => {
    const { rows } = await db.query<{ ref: string; cols: string }>(
      `select confrelid::regclass::text as ref, array_to_string(
                array(select attname from pg_attribute where attrelid = conrelid and attnum = any(conkey)
                       order by attnum), ',') as cols
         from pg_constraint where conrelid = 'research.crawler_observations'::regclass and contype = 'f'
          and conparentid = 0`,
    );
    expect(rows).toEqual([{ ref: 'research.check_runs', cols: 'run_id,observed_month' }]);
  });

  it('a lineage row is shared: the same five values cannot be recorded twice, nulls included', async () => {
    const row = ROWS.measurement_lineages(randomUUID(), 0x3001);
    await insertRow(db, 'measurement_lineages', { ...row, worker_release: null });
    await expect(
      insertRow(db, 'measurement_lineages', { ...row, id: randomUUID(), worker_release: null }),
    ).rejects.toThrow(/measurement_lineages_uq/);
  });

  it('a measurement row cannot name a lineage that does not exist', async () => {
    const check = await aCheck();
    await expect(
      insertRow(db, 'access_tests', {
        ...ROWS.access_tests(randomUUID(), check.id),
        lineage_id: randomUUID(),
      }),
    ).rejects.toThrow(/access_tests_lineage_id_fkey/);
  });

  it('page_results.source_ip_class holds exactly the contract’s SourceIpClass', async () => {
    const { rows } = await db.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid = 'public.page_results'::regclass and conname = 'page_results_source_ip_class_check'`,
    );
    expect(enumSetOf(rows[0]!.def)).toEqual([...SourceIpClassSchema.options].sort());
  });

  it('every signed-in user reads lineages; anon reads none', async () => {
    const outsider = await (async () => {
      const id = randomUUID();
      await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id}@x.example`]);
      return id;
    })();
    const seen = await asRole(db, 'authenticated', outsider, (tx) =>
      tx.query<{ id: string }>(`select id from public.measurement_lineages where id = $1`, [
        LINEAGE,
      ]),
    );
    expect(seen.rows).toEqual([{ id: LINEAGE }]);
    await expect(
      asRole(db, 'anon', null, (tx) => tx.query(`select 1 from public.measurement_lineages`)),
    ).rejects.toThrow(/permission denied/);
  });
});

// ─── 2. Measurement status ────────────────────────────────────────────────────────────────────────

describe('measurement status: the generated columns agree with the contract’s functions', () => {
  it('access_tests.measurement_status and research’s, for every verdict', async () => {
    const check = await aCheck();
    const run = randomUUID();
    await insertLedgerRow(db, 'check_runs', ledgerRun(run, SITE_KEY(`verdicts-${run}`)));
    for (const verdict of VerdictSchema.options) {
      const id = randomUUID();
      await insertRow(db, 'access_tests', { ...ROWS.access_tests(id, check.id), verdict });
      await insertLedgerRow(db, 'crawler_observations', {
        ...ledgerObservation(run, `Bot${VerdictSchema.options.indexOf(verdict)}`),
        verdict,
        cause: null,
      });
      const { rows } = await db.query<{ s: string }>(
        `select measurement_status as s from public.access_tests where id = $1`,
        [id],
      );
      expect(rows[0]!.s, verdict).toBe(verdictStatus(verdict));
    }
    const { rows } = await db.query<{ verdict: string; s: string }>(
      `select verdict, measurement_status as s from research.crawler_observations where run_id = $1`,
      [run],
    );
    expect(rows).toHaveLength(VerdictSchema.options.length);
    for (const r of rows) expect(r.s, r.verdict).toBe(verdictStatus(r.verdict as never));
  });

  /** Every check status, each with the grades its own CHECKs allow it to hold. */
  const cases = CheckStatusSchema.options.flatMap((status) => {
    const graded = status === 'finished' || status === 'partial';
    const seo = graded
      ? [{ refused: false }, { refused: true }, ...(status === 'partial' ? [null] : [])]
      : [null];
    const ai = graded
      ? [{ withheld: false }, { withheld: true }, ...(status === 'partial' ? [null] : [])]
      : [null];
    return seo.flatMap((s) => ai.map((a) => ({ status, seo: s, ai: a })));
  });

  it('there are cases for every status, and both grades in all their states', () => {
    expect(new Set(cases.map((c) => c.status))).toEqual(new Set(CheckStatusSchema.options));
    expect(cases.length).toBe(4 + 4 + 9);
  });

  it.each(cases)(
    'checks.technical_seo_status and ai_readability_status: $status, $seo, $ai',
    async ({ status, seo, ai }) => {
      const site = randomUUID();
      const id = randomUUID();
      await insertRow(
        db,
        'sites',
        ROWS.sites(site, world.accountId, `st-${site.slice(0, 8)}.example`),
      );
      const ended = status === 'finished' || status === 'partial' || status === 'failed';
      const graded = status === 'finished' || status === 'partial';
      await insertRow(db, 'checks', {
        ...ROWS.checks(id, site),
        status,
        started_at: status === 'queued' || status === 'deferred' ? null : '2026-10-20T06:05:00Z',
        finished_at: ended ? '2026-10-20T06:20:00Z' : null,
        deferred_until: status === 'deferred' ? '2026-10-21T06:00:00Z' : null,
        failure_reason: status === 'failed' ? 'timeout' : null,
        progress: status === 'running' ? { steps: [] } : null,
        coverage: graded ? { pages_discovered: 1, pages_crawled: 1 } : null,
        technical_seo: seo === null ? null : { score: seo.refused ? null : 80, refusal: seo },
        ai_readability: ai,
        lineage_id: graded ? LINEAGE : null,
      });
      const { rows } = await db.query<{ t: string | null; a: string | null }>(
        `select technical_seo_status as t, ai_readability_status as a from public.checks where id = $1`,
        [id],
      );
      expect(rows[0]).toEqual({
        t: technicalSeoStatus({
          status,
          technical_seo: seo === null ? null : { refusal: seo },
        }),
        a: aiReadabilityStatus({ status, ai_readability: ai }),
      });
    },
  );

  it.each([
    ['a refusal flag that is a string', { score: 80, refusal: { refused: 'true' } }, null],
    ['a grade with no refusal', {}, null],
    ['a scalar grade', 'graded', null],
    ['an array grade', [], null],
    ['a withheld flag that is a number', null, { withheld: 1 }],
    ['an AI grade with no withheld flag', null, {}],
  ])(
    'refuses %s: the value a status reads is a boolean, so SQL and the contract read it alike',
    async (_label, seo, ai) => {
      const site = randomUUID();
      await insertRow(
        db,
        'sites',
        ROWS.sites(site, world.accountId, `g-${site.slice(0, 8)}.example`),
      );
      const row = ROWS.checks(randomUUID(), site);
      await expect(
        insertRow(db, 'checks', {
          ...row,
          ...(seo === null ? {} : { technical_seo: seo }),
          ...(ai === null ? {} : { ai_readability: ai }),
        }),
      ).rejects.toThrow(
        seo === null ? /checks_ai_readability_withheld/ : /checks_technical_seo_refused/,
      );
    },
  );

  it('no writer can set a status: the columns are generated', async () => {
    const check = await aCheck();
    await expect(
      insertRow(db, 'access_tests', {
        ...ROWS.access_tests(randomUUID(), check.id),
        measurement_status: 'measured',
      }),
    ).rejects.toThrow(/cannot insert a non-DEFAULT value into column "measurement_status"/);
  });
});

// ─── 3. Monthly partitions ────────────────────────────────────────────────────────────────────────

const PARENTS = [
  'public.access_tests',
  'public.link_edges',
  'public.page_results',
  'research.check_runs',
  'research.crawler_observations',
];

/** Every partition of the month-partitioned tables, with its schema, RLS flag and ACL. */
async function partitions(d: Db) {
  return (
    await d.query<{
      parent: string;
      schema: string;
      name: string;
      rls: boolean;
      acl: string | null;
    }>(
      `select i.inhparent::regclass::text as parent, n.nspname as schema, c.relname as name,
              c.relrowsecurity as rls, c.relacl::text as acl
         from pg_inherits i join pg_class c on c.oid = i.inhrelid
         join pg_namespace n on n.oid = c.relnamespace
        where c.relkind = 'r' and i.inhparent = any($1::regclass[]) order by 1, 3`,
      [PARENTS],
    )
  ).rows;
}

describe('monthly partitions', () => {
  it('exactly these five tables are range-partitioned, each on its month column', async () => {
    const { rows } = await db.query<{ t: string; key: string }>(
      `select pt.partrelid::regclass::text as t, pg_get_partkeydef(pt.partrelid) as key
         from pg_partitioned_table pt order by 1`,
    );
    expect(rows).toEqual([
      { t: 'access_tests', key: 'RANGE (check_month)' },
      { t: 'link_edges', key: 'RANGE (check_month)' },
      { t: 'page_results', key: 'RANGE (check_month)' },
      { t: 'research.check_runs', key: 'RANGE (observed_month)' },
      { t: 'research.crawler_observations', key: 'RANGE (observed_month)' },
    ]);
  });

  it('every partition is in `partitions`, with RLS on and no privilege for anyone but its owner', async () => {
    const all = await partitions(db);
    expect(all.length, 'anti-vacuity: five tables, several months each').toBeGreaterThanOrEqual(25);
    for (const p of all) {
      expect(p.schema, p.name).toBe('partitions');
      expect(p.rls, p.name).toBe(true);
      expect(p.acl, p.name).toBe('{postgres=arwdDxtm/postgres}');
    }
  });

  it('a new partition carries no privilege even where default privileges grant every role everything', async () => {
    // pg_default_acl on production may hold an entry for every schema; this models the worst case.
    const d = await freshDb();
    await applyAllMigrations(d);
    await d.exec(
      `alter default privileges grant all on tables to anon, authenticated, service_role, crawl_worker, research_retention`,
    );
    await d.exec(`create table partitions.probe (x int)`);
    const { rows: probe } = await d.query<{ ok: boolean }>(
      `select has_table_privilege('anon', 'partitions.probe', 'SELECT') as ok`,
    );
    expect(probe[0]!.ok, 'anti-vacuity: the default privileges apply to a new table').toBe(true);
    await d.query(`select public.v2_premake_month_partitions('2031-06-01', '2031-06-01')`);
    const made = (await partitions(d)).filter((p) => p.name.endsWith('2031_06'));
    expect(made).toHaveLength(PARENTS.length);
    for (const p of made) expect(p.acl, p.name).toBe('{postgres=arwdDxtm/postgres}');
  }, 120_000);

  it.each(['anon', 'authenticated', 'service_role', 'crawl_worker', 'research_retention'])(
    'no USAGE on the schema `partitions` for %s',
    async (role) => {
      const { rows } = await db.query<{ ok: boolean }>(
        `select has_schema_privilege($1, 'partitions', 'USAGE') as ok`,
        [role],
      );
      expect(rows[0]!.ok).toBe(false);
    },
  );

  it.each(['anon', 'authenticated', 'service_role'] as const)(
    '%s reading a partition directly is refused; a member reads its rows through the parent',
    async (role) => {
      const name = (await partitions(db)).find((p) => p.parent === 'page_results')!.name;
      await expect(
        asRole(db, role, role === 'anon' ? null : world.ownerId, (tx) =>
          tx.query(`select 1 from partitions.${name}`),
        ),
      ).rejects.toThrow(/permission denied/);
    },
  );

  it('a member reads its page_results through the parent; partition pruning by month works', async () => {
    const seen = await asRole(db, 'authenticated', world.ownerId, (tx) =>
      tx.query<{ n: number }>(
        `select count(*)::int as n from public.page_results where check_month = $1`,
        [MONTH0],
      ),
    );
    expect(seen.rows[0]!.n).toBeGreaterThan(0);
  });

  it('a row for a month with no partition is refused, not misfiled: there is no default partition', async () => {
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_partitioned_table where partdefid <> 0`,
    );
    expect(rows[0]!.n).toBe(0);
    const site = randomUUID();
    const check = randomUUID();
    await insertRow(
      db,
      'sites',
      ROWS.sites(site, world.accountId, `far-${site.slice(0, 8)}.example`),
    );
    await insertRow(db, 'checks', {
      ...ROWS.checks(check, site),
      queued_at: '2031-01-05T00:00:00Z',
    });
    await expect(
      insertRow(db, 'page_results', {
        ...ROWS.page_results(check, 'https://far.example/'),
        check_month: '2031-01-01',
      }),
    ).rejects.toThrow(/no partition of relation "page_results" found/);
  });

  it('a row whose check_month is not its check’s month is refused: no such check', async () => {
    const check = await aCheck();
    await expect(
      insertRow(db, 'link_edges', {
        ...ROWS.link_edges(check.id, 'https://a.example/', `https://a.example/${randomUUID()}`),
        check_month: '2026-11-01',
      }),
    ).rejects.toThrow(/link_edges_check_fkey/);
  });

  it('premake creates each missing month once, for every partitioned table, and is re-runnable', async () => {
    const d = await freshDb();
    await applyAllMigrations(d);
    const make = async (from: string, through: string) =>
      (
        await d.query<{ n: number }>(`select public.v2_premake_month_partitions($1, $2) as n`, [
          from,
          through,
        ])
      ).rows[0]!.n;
    expect(await make('2030-01-01', '2030-03-15')).toBe(3 * PARENTS.length);
    expect(await make('2030-01-01', '2030-03-15')).toBe(0);
    const names = (await partitions(d)).map((p) => p.name).filter((n) => n.includes('2030'));
    expect(names.sort()).toEqual(
      PARENTS.flatMap((p) =>
        ['01', '02', '03'].map((m) => `${p.replace('.', '_')}_2030_${m}`),
      ).sort(),
    );
  }, 120_000);

  it('premake finds a table partitioned later from the catalog, and leaves one keyed on another column', async () => {
    const d = await freshDb();
    await applyAllMigrations(d);
    await d.exec(`
      create table public.render_results (check_month date not null, w int) partition by range (check_month);
      create table public.by_day (day date not null) partition by range (day);`);
    await d.query(`select public.v2_premake_month_partitions('2030-05-01', '2030-05-01')`);
    const { rows } = await d.query<{ n: string }>(
      `select c.relname as n from pg_inherits i join pg_class c on c.oid = i.inhrelid
        where i.inhparent in ('public.render_results'::regclass, 'public.by_day'::regclass)`,
    );
    expect(rows).toEqual([{ n: 'public_render_results_2030_05' }]);
  }, 120_000);

  it.each([
    ['a null bound', null, '2030-01-01', /required/],
    ['a range that runs backwards', '2030-02-01', '2030-01-01', /at most 37 months/],
    ['a range over 37 months', '2030-01-01', '2033-02-01', /at most 37 months/],
    ['38 months from a mid-month start', '2030-01-31', '2033-02-01', /at most 37 months/],
  ])('premake refuses %s', async (_label, from, through, error) => {
    await expect(
      db.query(`select public.v2_premake_month_partitions($1, $2)`, [from, through]),
    ).rejects.toThrow(error);
  });

  it('premake is the service role’s: no client role may call it', async () => {
    const { rows } = await db.query<{ r: string; ok: boolean }>(
      `select r, has_function_privilege(r, 'public.v2_premake_month_partitions(date, date)', 'EXECUTE') as ok
         from unnest(array['anon', 'authenticated', 'crawl_worker', 'research_retention', 'service_role']) r`,
    );
    expect(rows).toEqual([
      { r: 'anon', ok: false },
      { r: 'authenticated', ok: false },
      { r: 'crawl_worker', ok: false },
      { r: 'research_retention', ok: false },
      { r: 'service_role', ok: true },
    ]);
  });

  it('retention is a partition drop: a month’s rows go, other months’ and the checks stay', async () => {
    const d = await freshDb();
    await applyAllMigrations(d);
    await prepareMeasurement(d);
    const w = await seedWorld(d, 'drop');
    const site = randomUUID();
    const nov = randomUUID();
    await insertRow(d, 'sites', ROWS.sites(site, w.accountId, 'nov.example'));
    await insertRow(d, 'checks', { ...ROWS.checks(nov, site), queued_at: '2026-11-03T06:00:00Z' });
    await insertRow(d, 'page_results', {
      ...ROWS.page_results(nov, 'https://nov.example/'),
      check_month: '2026-11-01',
    });
    const count = async (month: string) =>
      (
        await d.query<{ n: number }>(
          `select count(*)::int as n from public.page_results where check_month = $1`,
          [month],
        )
      ).rows[0]!.n;
    expect(await count(MONTH0)).toBeGreaterThan(0);
    for (const t of ['page_results', 'link_edges', 'access_tests'])
      await d.exec(`drop table partitions.public_${t}_2026_10`);
    expect(await count(MONTH0)).toBe(0);
    expect(await count('2026-11-01')).toBe(1);
    const { rows } = await d.query<{ n: number }>(
      `select count(*)::int as n from public.checks where check_month = $1`,
      [MONTH0],
    );
    expect(rows[0]!.n).toBeGreaterThan(0);
  }, 120_000);
});

// ─── 4. The research ledger ───────────────────────────────────────────────────────────────────────

/** `sql` applied inside a rolled-back transaction, and what the guard then reports. */
async function guardAfter(sql: string, d: PGlite = db): Promise<string[]> {
  return d
    .transaction(async (tx) => {
      await tx.exec(sql);
      throw await deidentificationViolations(tx);
    })
    .catch((x: string[]) => x);
}

describe('the research ledger is de-identified', () => {
  it('holds exactly the allowed columns, and references nothing outside itself but a lineage', async () => {
    expect(await deidentificationViolations(db)).toEqual([]);
  });

  it('reports nothing on a ledger with three years of partitions', async () => {
    const d = await freshDb();
    await applyAllMigrations(d);
    await d.query(`select public.v2_premake_month_partitions('2025-01-01', '2027-12-01')`);
    expect(await deidentificationViolations(d)).toEqual([]);
  }, 120_000);

  it.each([
    [
      'an account_id',
      `alter table research.check_runs add column account_id uuid`,
      'research.check_runs.account_id: not an allowed ledger column',
    ],
    [
      'a harmlessly named column that points at a site',
      `alter table research.check_runs add column ref uuid references public.sites (id)`,
      'research.check_runs.ref: not an allowed ledger column',
    ],
    [
      'a path, as text',
      `alter table research.crawler_observations add column note text`,
      'research.crawler_observations.note: not an allowed ledger column',
    ],
    [
      'a share kept to more decimals, which narrows it back towards a count',
      `alter table research.check_runs alter column share_2xx type numeric`,
      'research.check_runs.share_2xx: is numeric, allowed numeric(3,2)',
    ],
    [
      'a new table in the schema',
      `create table research.emails (email text)`,
      'research.emails.email: not an allowed ledger column',
    ],
  ])('catches %s', async (_label, sql, expected) => {
    expect(await guardAfter(sql)).toContain(expected);
  });

  it.each([
    [
      'a foreign key declared on a ledger partition',
      `do $d$ declare p text; begin
         select c.relname into p from pg_inherits i join pg_class c on c.oid = i.inhrelid
          where i.inhparent = 'research.check_runs'::regclass limit 1;
         execute format('alter table partitions.%I add constraint sneaky foreign key (lineage_id) references public.accounts (id)', p);
       end $d$`,
      'research.check_runs → public.accounts: the ledger may not reference a customer table',
    ],
    [
      'a function in the schema that joins the link table',
      `create function research.who(p text) returns setof uuid language sql as $f$ select check_id from public.check_ledger_links $f$`,
      'research.who(text): not an allowed ledger function',
    ],
    [
      'a trigger that copies rows out of the ledger',
      `create function public.copy_out() returns trigger language plpgsql as $f$ begin return new; end $f$;
       create trigger copy_out after insert on research.check_runs for each row execute function public.copy_out()`,
      'research.check_runs: trigger copy_out (copy_out) is not an allowed ledger trigger',
    ],
    [
      'a rule that copies rows out of the ledger',
      `create table public.shadow (k text);
       create rule leak_rule as on insert to research.check_runs do also insert into public.shadow values (new.site_key)`,
      'research.check_runs: rule leak_rule is not allowed on the ledger',
    ],
    [
      'a CHECK that calls a function outside the ledger',
      `create function public.leak(k text) returns boolean language sql as $f$ select true $f$;
       alter table research.check_runs add constraint leak_chk check (public.leak(site_key))`,
      'research.check_runs: calls leak(text), which is not an allowed ledger function',
    ],
    [
      'a policy that calls a function outside the ledger',
      `create function public.leak(k text) returns boolean language sql as $f$ select true $f$;
       create policy leak_pol on research.crawler_observations for select using (public.leak(crawler))`,
      'research.crawler_observations: calls leak(text), which is not an allowed ledger function',
    ],
    [
      'a side table in the partitions schema',
      `create table partitions.research_sites (site_key text, account_id uuid)`,
      'partitions.research_sites: `partitions` holds only partitions and their indexes',
    ],
  ])(
    'catches %s',
    async (_label, sql, expected) => {
      // On an empty ledger, so a new foreign key validates against no rows.
      const empty = await freshDb();
      await applyAllMigrations(empty);
      expect(await guardAfter(sql, empty)).toContain(expected);
    },
    120_000,
  );

  it.each([
    [
      'a view outside the schema over a ledger table',
      `create view public.peek as select site_key, cms, observed_month from research.check_runs`,
      /view peek depends on the ledger/,
    ],
    [
      'an allowed function whose body was replaced',
      `create or replace function research.check_runs_supersedes_same_site() returns trigger
         language plpgsql set search_path = pg_catalog as $f$ begin return new; end $f$`,
      /research\.check_runs_supersedes_same_site\(\): its definition is not the allowed one/,
    ],
    [
      'a function outside the schema that returns ledger rows',
      `create function public.peek_rows() returns setof research.check_runs language sql
         as $f$ select * from research.check_runs $f$`,
      /function peek_rows\(\) depends on the ledger/,
    ],
    [
      'a column outside the schema that holds a ledger row',
      `create table public.copy_of (r research.check_runs)`,
      /column r of table copy_of depends on the ledger/,
    ],
    [
      'a sequence in the schema, as a column default',
      `create sequence research.order_seq;
       alter table research.check_runs alter column site_key_version set default nextval('research.order_seq')`,
      /research\.order_seq: `research` holds only tables and indexes \(relkind S\)/,
    ],
    [
      'an account column on measurement_lineages, the one table the ledger may reference',
      `alter table public.measurement_lineages add column account_id uuid references public.accounts (id)`,
      /public\.measurement_lineages\.account_id: not an allowed lineage column/,
    ],
    [
      'a reference out of measurement_lineages under an allowed column',
      `alter table public.measurement_lineages add constraint sneaky foreign key (id) references public.accounts (id)`,
      /public\.measurement_lineages: sneaky → accounts: a lineage references nothing/,
    ],
    [
      'measurement_lineages renamed, so its pin would look at nothing',
      `alter table public.measurement_lineages rename to lineages`,
      /public\.measurement_lineages: missing \(renamed or dropped\)/,
    ],
    [
      'a partition of a side table in the partitions schema',
      `create table partitions.side (m date) partition by range (m);
       create table partitions.side_a partition of partitions.side for values from ('2026-01-01') to ('2026-02-01')`,
      /partitions\.side_a: `partitions` holds only partitions and their indexes/,
    ],
    [
      'a composite type in the partitions schema',
      `create type partitions.t as (a text)`,
      /partitions\.t: `partitions` holds only partitions and their indexes/,
    ],
    [
      'a CHECK that reaches a function through an operator',
      `create function public.leako(a text, b text) returns boolean language sql as $f$ select true $f$;
       create operator public.=== (leftarg = text, rightarg = text, function = public.leako);
       alter table research.check_runs add constraint leak_op check (site_key operator(public.===) site_key)`,
      /depends on operator (public\.)?===\(text,text\), outside the ledger/,
    ],
  ])(
    'catches %s',
    async (_label, sql, expected) => {
      const empty = await freshDb();
      await applyAllMigrations(empty);
      const found = await guardAfter(sql, empty);
      expect(
        found.some((m) => expected.test(m)),
        found.join('\n'),
      ).toBe(true);
    },
    120_000,
  );

  it('catches a reference to a customer table made through an allowed column', async () => {
    // On an empty ledger, so the new foreign key validates against no rows.
    const empty = await freshDb();
    await applyAllMigrations(empty);
    const found = await guardAfter(
      `alter table research.check_runs add constraint sneaky foreign key (lineage_id) references public.checks (id)`,
      empty,
    );
    expect(found).toContain(
      'research.check_runs → public.checks: the ledger may not reference a customer table',
    );
  }, 120_000);

  it('keeps no time finer than a month: observed_month is the first of its month', async () => {
    await expect(
      insertLedgerRow(db, 'check_runs', {
        ...ledgerRun(randomUUID(), SITE_KEY('mid-month')),
        observed_month: '2026-10-15',
      }),
    ).rejects.toThrow(/check_runs_observed_month/);
  });

  it.each([
    [
      'a crawler token long enough to carry a hash',
      { crawler: `a${'0'.repeat(63)}` },
      'crawler_observations_crawler',
    ],
  ])('refuses %s', async (_label, change, constraint) => {
    const r = randomUUID();
    await insertLedgerRow(db, 'check_runs', ledgerRun(r, SITE_KEY(`long-${r}`)));
    await expect(
      insertLedgerRow(db, 'crawler_observations', { ...ledgerObservation(r), ...change }),
    ).rejects.toThrow(new RegExp(constraint));
  });

  it('shares add up to 0, or to 1 give or take rounding', async () => {
    const run = (shares: number[]) => ({
      ...ledgerRun(randomUUID(), SITE_KEY(`shares-${shares.join('-')}`)),
      share_2xx: shares[0],
      share_3xx: shares[1],
      share_4xx: shares[2],
      share_5xx: shares[3],
      share_unanswered: shares[4],
    });
    for (const ok of [
      [0, 0, 0, 0, 0],
      [0.2, 0.2, 0.2, 0.2, 0.2],
      [0.21, 0.21, 0.21, 0.21, 0.18],
      [0.2, 0.2, 0.2, 0.2, 0.22],
    ])
      await insertLedgerRow(db, 'check_runs', run(ok));
    for (const bad of [
      [0.5, 0, 0, 0, 0],
      [0.21, 0.21, 0.21, 0.21, 0.19],
    ])
      await expect(insertLedgerRow(db, 'check_runs', run(bad)), String(bad)).rejects.toThrow(
        /check_runs_shares/,
      );
  });

  it('knows a site only by a 64-hex keyed hash', async () => {
    await expect(
      insertLedgerRow(db, 'check_runs', ledgerRun(randomUUID(), 'example-outfitter.com')),
    ).rejects.toThrow(/check_runs_site_key/);
  });
});

/** The ledger's CHECKs, by constraint, from the catalog. */
async function ledgerChecks(d: Db): Promise<{ table: string; name: string; def: string }[]> {
  return (
    await d.query<{ table: string; name: string; def: string }>(
      `select c.relname as table, k.conname as name, pg_get_constraintdef(k.oid) as def
         from pg_constraint k join pg_class c on c.oid = k.conrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'research' and k.contype = 'c' order by 1, 2`,
    )
  ).rows;
}

/** Each enum CHECK on the ledger, by column, and the contract enum it restates. */
const LEDGER_ENUMS: Record<string, readonly string[]> = {
  'check_runs.cms': CmsNameSchema.options,
  'check_runs.frontend_framework': PacketFrameworkSchema.options,
  'check_runs.without_js_state': JsTextStateSchema.options,
  'check_runs.signals_detected': SignalKindSchema.options,
  'check_runs.signals_indeterminate': SignalKindSchema.options,
  'crawler_observations.verdict': VerdictSchema.options,
  'crawler_observations.measurement_status': MeasurementStatusSchema.options,
  'crawler_observations.cause': AccessCauseSchema.options,
  // The ledger's own category: no contract field holds a robots rule per token.
  'crawler_observations.robots_rule': [
    'named_allow_all',
    'named_disallow_all',
    'named_partial',
    'wildcard_allow_all',
    'wildcard_disallow_all',
    'wildcard_partial',
    'no_group',
    'not_read',
  ],
};

/** A row that breaks one named CHECK of the ledger and nothing else. */
const LEDGER_CASES: Record<
  string,
  { table: string; row: (run: string) => Record<string, unknown> }
> = {
  check_runs_observed_month: {
    table: 'check_runs',
    row: () => ({ ...ledgerRun(randomUUID(), SITE_KEY('c1')), observed_month: '2026-10-15' }),
  },
  check_runs_site_key: {
    table: 'check_runs',
    row: () => ledgerRun(randomUUID(), 'example-outfitter.com'),
  },
  check_runs_site_key_version: {
    table: 'check_runs',
    row: () => ({ ...ledgerRun(randomUUID(), SITE_KEY('c2')), site_key_version: 0 }),
  },
  check_runs_supersedes_pair: {
    table: 'check_runs',
    row: (run) => ({ ...ledgerRun(randomUUID(), SITE_KEY('c3')), supersedes_id: run }),
  },
  check_runs_edge_vendor: {
    table: 'check_runs',
    row: () => ({
      ...ledgerRun(randomUUID(), SITE_KEY('c4')),
      edge_vendor: randomUUID().replace(/-/g, ''),
    }),
  },
  check_runs_shares: {
    table: 'check_runs',
    row: () => ({ ...ledgerRun(randomUUID(), SITE_KEY('c5')), share_2xx: 0.9, share_3xx: 0.9 }),
  },
  check_runs_signals_ndims: {
    table: 'check_runs',
    row: () => ({ ...ledgerRun(randomUUID(), SITE_KEY('c6')), signals_detected: [['schema_org']] }),
  },
  check_runs_signals_indeterminate_ndims: {
    table: 'check_runs',
    row: () => ({
      ...ledgerRun(randomUUID(), SITE_KEY('c7')),
      signals_indeterminate: [['llms_txt']],
    }),
  },
  check_runs_signals_disjoint: {
    table: 'check_runs',
    row: () => ({
      ...ledgerRun(randomUUID(), SITE_KEY('c8')),
      signals_indeterminate: ['schema_org'],
    }),
  },
  check_runs_signals_detected_distinct: {
    table: 'check_runs',
    row: () => ({
      ...ledgerRun(randomUUID(), SITE_KEY('c9')),
      signals_detected: ['schema_org', 'schema_org'],
    }),
  },
  check_runs_signals_indeterminate_distinct: {
    table: 'check_runs',
    row: () => ({
      ...ledgerRun(randomUUID(), SITE_KEY('c10')),
      signals_indeterminate: ['llms_txt', 'llms_txt'],
    }),
  },
  crawler_observations_crawler: {
    table: 'crawler_observations',
    row: (run) => ({ ...ledgerObservation(run), crawler: 'bad token!' }),
  },
};

describe('every ledger CHECK refuses a row on its own', () => {
  let run: string;
  beforeAll(async () => {
    run = randomUUID();
    await insertLedgerRow(db, 'check_runs', ledgerRun(run, SITE_KEY('ledger-checks')));
  });

  it('every CHECK is covered: an enum CHECK by its contract enum, every other by a named case', async () => {
    const named = new Set(Object.keys(LEDGER_CASES));
    const enums = new Set(Object.keys(LEDGER_ENUMS));
    const uncovered: string[] = [];
    for (const c of await ledgerChecks(db)) {
      const set = enumSetOf(c.def);
      if (set !== null) {
        const col = `${c.table}.${/^CHECK \(\(?"?(\w+)/.exec(c.def)![1]}`;
        if (!enums.delete(col)) uncovered.push(`${c.name} (enum on ${col})`);
      } else if (!named.delete(c.name)) uncovered.push(c.name);
    }
    expect(uncovered, 'CHECKs without a case').toEqual([]);
    expect([...named, ...enums], 'cases naming no CHECK').toEqual([]);
  });

  it('each enum CHECK holds exactly its contract enum’s values', async () => {
    const wrong: string[] = [];
    for (const c of await ledgerChecks(db)) {
      const set = enumSetOf(c.def);
      if (set === null) continue;
      const col = `${c.table}.${/^CHECK \(\(?"?(\w+)/.exec(c.def)![1]}`;
      if (JSON.stringify(set) !== JSON.stringify([...LEDGER_ENUMS[col]!].sort()))
        wrong.push(`${col}: [${set}]`);
    }
    expect(wrong).toEqual([]);
  });

  for (const [name, c] of Object.entries(LEDGER_CASES)) {
    it(`${name}`, async () => {
      const row = c.row(run);
      await expect(insertLedgerRow(db, c.table, row), `${name} should refuse`).rejects.toThrow(
        new RegExp(`"${name}"`),
      );
      const sentinel = new Error('rollback');
      await expect(
        db.transaction(async (tx) => {
          await tx.exec(`alter table research.${c.table} drop constraint ${name}`);
          await insertLedgerRow(tx, c.table, row);
          throw sentinel;
        }),
        `with ${name} dropped the row should insert`,
      ).rejects.toBe(sentinel);
    });
  }
});

describe('the research ledger is reachable by the service role and the retention role only', () => {
  it.each(CLIENT_ROLES)(
    '%s has no USAGE on the schema and no privilege on its tables',
    async (role) => {
      const { rows } = await db.query<{ usage: boolean; privs: string[] }>(
        `select has_schema_privilege($1, 'research', 'USAGE') as usage,
              array(select t || ':' || p from unnest(array['research.check_runs', 'research.crawler_observations']) t
                      cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
                     where has_table_privilege($1, t, p)) as privs`,
        [role],
      );
      expect(rows[0]).toEqual({ usage: false, privs: [] });
    },
  );

  it.each([
    ['service_role', ['INSERT', 'SELECT']],
    ['research_retention', ['DELETE', 'SELECT']],
  ])('%s holds exactly %j on each ledger table', async (role, privs) => {
    for (const t of ['research.check_runs', 'research.crawler_observations']) {
      const { rows } = await db.query<{ p: string }>(
        `select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
          where has_table_privilege($1, $2, p) order by 1`,
        [role, t],
      );
      expect(
        rows.map((r) => r.p),
        t,
      ).toEqual(privs);
    }
  });

  it('anon and authenticated are refused outright, as PostgREST would put them', async () => {
    for (const role of ['anon', 'authenticated'] as const)
      await expect(
        asRole(db, role, role === 'anon' ? null : world.ownerId, (tx) =>
          tx.query(`select 1 from research.check_runs`),
        ),
      ).rejects.toThrow(/permission denied/);
  });

  it('crawl_worker, even with a valid token, is refused', async () => {
    await expect(
      asWorker(db, { role: 'crawl_worker' }, (tx) => tx.query(`select 1 from research.check_runs`)),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('006b’s grants hold even where default privileges grant every role everything', () => {
  it('applied under that worst case, each table carries only its planned privileges', async () => {
    const d = await freshDb();
    await applyAllMigrations(d, undefined, before(MIGRATION_006B));
    await d.exec(
      `alter default privileges grant all on tables to anon, authenticated, service_role, crawl_worker`,
    );
    await d.exec(readMigration(MIGRATION_006B));
    const { rows } = await d.query<{ role: string; t: string; p: string }>(
      `select r as role, t, string_agg(p, ',' order by p) as p
         from unnest(array['anon', 'authenticated', 'crawl_worker', 'service_role', 'research_retention']) r
        cross join unnest(array['research.check_runs', 'research.crawler_observations',
                                'public.check_ledger_links', 'public.usage_events']) t
        cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
        where has_table_privilege(r, t, p) group by r, t order by 1, 2`,
    );
    expect(rows).toEqual([
      { role: 'research_retention', t: 'research.check_runs', p: 'DELETE,SELECT' },
      { role: 'research_retention', t: 'research.crawler_observations', p: 'DELETE,SELECT' },
      {
        role: 'service_role',
        t: 'public.check_ledger_links',
        p: 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE',
      },
      {
        role: 'service_role',
        t: 'public.usage_events',
        p: 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE',
      },
      { role: 'service_role', t: 'research.check_runs', p: 'INSERT,SELECT' },
      { role: 'service_role', t: 'research.crawler_observations', p: 'INSERT,SELECT' },
    ]);
  }, 120_000);
});

describe('the research ledger is append-only: a correction is a new row', () => {
  let run: string;
  beforeAll(async () => {
    run = randomUUID();
    await insertLedgerRow(db, 'check_runs', ledgerRun(run, SITE_KEY('append-only')));
    await insertLedgerRow(db, 'crawler_observations', ledgerObservation(run));
  });

  const UPDATE = `update research.check_runs set cms = 'wordpress'`;
  const DELETE = `delete from research.check_runs`;
  const OBS_UPDATE = `update research.crawler_observations set verdict = 'allowed'`;
  const OBS_DELETE = `delete from research.crawler_observations`;

  it.each(['service_role', 'postgres'])(
    '%s cannot update or delete a run or an observation',
    async (role) => {
      for (const sql of [UPDATE, DELETE, OBS_UPDATE, OBS_DELETE])
        await expect(
          asPlainRole(db, role, (tx) => tx.query(sql)),
          `${role}: ${sql}`,
        ).rejects.toThrow(role === 'postgres' ? /append-only/ : /permission denied|append-only/);
    },
  );

  it.each(['anon', 'authenticated', 'crawl_worker'])('%s cannot update or delete', async (role) => {
    for (const sql of [UPDATE, DELETE, OBS_UPDATE, OBS_DELETE])
      await expect(asPlainRole(db, role, (tx) => tx.query(sql))).rejects.toThrow(
        /permission denied/,
      );
  });

  it('the table owner cannot truncate a ledger partition directly either', async () => {
    const { rows } = await db.query<{ name: string }>(
      `select c.relname as name from pg_inherits i join pg_class c on c.oid = i.inhrelid
        where i.inhparent in ('research.check_runs'::regclass, 'research.crawler_observations'::regclass)`,
    );
    expect(rows.length, 'anti-vacuity').toBeGreaterThanOrEqual(8);
    for (const { name } of rows)
      await expect(db.query(`truncate partitions.${name} cascade`), name).rejects.toThrow(
        /append-only/,
      );
  });

  it('the table owner cannot truncate either table', async () => {
    for (const t of ['check_runs', 'crawler_observations'])
      await expect(db.query(`truncate research.${t} cascade`)).rejects.toThrow(/append-only/);
  });

  it('research_retention cannot update, even with the privilege: the trigger refuses', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.exec(`grant update on research.check_runs to research_retention`);
        await tx.exec(`set local role research_retention`);
        await tx.query(`update research.check_runs set cms = 'wordpress' where id = $1`, [run]);
      }),
    ).rejects.toThrow(/append-only/);
  });

  it('research_retention deletes a site’s rows, observations first, and the link goes with them', async () => {
    const r = randomUUID();
    const check = await aCheck();
    await insertLedgerRow(db, 'check_runs', ledgerRun(r, SITE_KEY('erase-me')));
    await insertLedgerRow(db, 'crawler_observations', ledgerObservation(r));
    await insertRow(db, 'check_ledger_links', ROWS.check_ledger_links(check.id, r));
    await asPlainRole(db, 'research_retention', async (tx) => {
      await tx.query(`delete from research.crawler_observations where run_id = $1`, [r]);
      await tx.query(`delete from research.check_runs where id = $1`, [r]);
    });
    const { rows } = await db.query<{ n: number }>(
      `select (select count(*) from research.check_runs where id = $1)
            + (select count(*) from public.check_ledger_links where run_id = $1) as n`,
      [r],
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it('a correction supersedes a run of the same site, and only of the same site', async () => {
    const fix = randomUUID();
    await insertLedgerRow(db, 'check_runs', {
      ...ledgerRun(fix, SITE_KEY('append-only')),
      supersedes_id: run,
      supersedes_month: MONTH0,
    });
    await expect(
      insertLedgerRow(db, 'check_runs', {
        ...ledgerRun(randomUUID(), SITE_KEY('another-site')),
        supersedes_id: run,
        supersedes_month: MONTH0,
      }),
    ).rejects.toThrow(/a run supersedes a run of the same site/);
    await expect(
      insertLedgerRow(db, 'check_runs', {
        ...ledgerRun(randomUUID(), SITE_KEY('append-only')),
        supersedes_id: randomUUID(),
        supersedes_month: MONTH0,
      }),
    ).rejects.toThrow(/check_runs_supersedes_fkey|same site/);
    await expect(
      insertLedgerRow(db, 'check_runs', {
        ...ledgerRun(randomUUID(), SITE_KEY('append-only')),
        supersedes_id: run,
      }),
    ).rejects.toThrow(/check_runs_supersedes_pair/);
  });
});

describe('check_ledger_links: the only path from a customer’s check to the ledger', () => {
  it('goes when its check is deleted, and the ledger rows stay', async () => {
    const site = randomUUID();
    const check = randomUUID();
    const r = randomUUID();
    await insertRow(
      db,
      'sites',
      ROWS.sites(site, world.accountId, `link-${site.slice(0, 8)}.example`),
    );
    await insertRow(db, 'checks', ROWS.checks(check, site));
    await insertLedgerRow(db, 'check_runs', ledgerRun(r, SITE_KEY(`link-${r}`)));
    await insertLedgerRow(db, 'crawler_observations', ledgerObservation(r));
    await insertRow(db, 'check_ledger_links', ROWS.check_ledger_links(check, r));
    await db.query(`delete from public.sites where id = $1`, [site]);
    const { rows } = await db.query<{ links: number; runs: number; obs: number }>(
      `select (select count(*)::int from public.check_ledger_links where run_id = $1) as links,
              (select count(*)::int from research.check_runs where id = $1) as runs,
              (select count(*)::int from research.crawler_observations where run_id = $1) as obs`,
      [r],
    );
    expect(rows[0]).toEqual({ links: 0, runs: 1, obs: 1 });
  });

  it('no client role holds any privilege on it', async () => {
    for (const role of CLIENT_ROLES) {
      const { rows } = await db.query<{ p: string }>(
        `select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
          where has_table_privilege($1, 'public.check_ledger_links', p)`,
        [role],
      );
      expect(rows, role).toEqual([]);
    }
  });
});

// ─── 5. usage_events ──────────────────────────────────────────────────────────────────────────────

describe('usage_events', () => {
  const event = (over: Record<string, unknown> = {}) => {
    const id = randomUUID();
    return { ...ROWS.usage_events(id, world.accountId, null), ...over };
  };

  it('a refused, withheld or failed result is never billable', async () => {
    for (const result of ['refused', 'withheld', 'failed'])
      await expect(insertRow(db, 'usage_events', event({ result }))).rejects.toThrow(
        /usage_events_billable/,
      );
    await insertRow(db, 'usage_events', event({ result: 'refused', billable: false }));
  });

  it.each([
    ['negative compute', { compute_seconds: -1 }, /usage_events_compute_seconds/],
    ['NaN compute', { compute_seconds: 'NaN' }, /usage_events_compute_seconds/],
    ['infinite compute', { compute_seconds: 'Infinity' }, /usage_events_compute_seconds/],
    ['a negative request count', { request_count: -1 }, /usage_events_request_count/],
    ['an empty idempotency key', { idempotency_key: '' }, /usage_events_idempotency_key/],
  ])('refuses %s', async (_label, over, error) => {
    await expect(insertRow(db, 'usage_events', event(over))).rejects.toThrow(error);
  });

  it('a retried write lands once', async () => {
    const e = event();
    await insertRow(db, 'usage_events', e);
    await expect(insertRow(db, 'usage_events', { ...e, id: randomUUID() })).rejects.toThrow(
      /usage_events_idempotency_key_key/,
    );
  });

  it('cannot name a check, report or key of another account', async () => {
    const other = await seedWorld(db, 'usage-other');
    const { rows } = await db.query<{ check: string; report: string; key: string }>(
      `select (select c.id::text from public.checks c where c.site_id = $1 limit 1) as check,
              (select r.id::text from public.reports r where r.account_id = $2 limit 1) as report,
              (select k.id::text from public.api_keys k where k.account_id = $2 limit 1) as key`,
      [other.site1, other.accountId],
    );
    const x = rows[0]!;
    await expect(insertRow(db, 'usage_events', event({ check_id: x.check }))).rejects.toThrow(
      /check_id must be a check of the event's account/,
    );
    await expect(insertRow(db, 'usage_events', event({ report_id: x.report }))).rejects.toThrow(
      /report_id must be a report of the event's account/,
    );
    await expect(insertRow(db, 'usage_events', event({ api_key_id: x.key }))).rejects.toThrow(
      /api_key_id must be a key of the event's account/,
    );
  });

  it('is append-only for every writer: no update, no delete, no truncate', async () => {
    const e = event();
    await insertRow(db, 'usage_events', e);
    for (const sql of [
      `update public.usage_events set billable = false where id = '${e.id}'`,
      `delete from public.usage_events where id = '${e.id}'`,
    ]) {
      await expect(asRole(db, 'service_role', null, (tx) => tx.query(sql))).rejects.toThrow(
        /append-only/,
      );
      await expect(db.query(sql)).rejects.toThrow(/append-only/);
    }
    await expect(db.query(`truncate public.usage_events`)).rejects.toThrow(/append-only/);
    // An update that changes nothing is refused too: only clearing a reference to a deleted row passes.
    await expect(
      db.query(`update public.usage_events set billable = billable where id = $1`, [e.id]),
    ).rejects.toThrow(/append-only/);
  });

  it('keeps the event when its check goes (check_id set null), and goes with its account', async () => {
    const w = await seedWorld(db, 'usage-life');
    const { rows: c } = await db.query<{ id: string }>(
      `select id::text from public.checks where site_id = $1 limit 1`,
      [w.site1],
    );
    const id = randomUUID();
    await insertRow(db, 'usage_events', {
      ...ROWS.usage_events(id, w.accountId, c[0]!.id),
    });
    await db.query(`delete from public.sites where id = $1`, [w.site1]);
    const after = await db.query<{ check_id: string | null }>(
      `select check_id from public.usage_events where id = $1`,
      [id],
    );
    expect(after.rows).toEqual([{ check_id: null }]);
    await db.query(`delete from public.users where id = $1`, [w.ownerId]);
    await db.query(`delete from public.accounts where id = $1`, [w.accountId]);
    const gone = await db.query(`select 1 from public.usage_events where account_id = $1`, [
      w.accountId,
    ]);
    expect(gone.rows).toEqual([]);
  });

  it('members read counts only: usage_counts(), and no row of usage_events', async () => {
    const w = await seedWorld(db, 'usage-counts');
    await insertRow(db, 'usage_events', {
      ...ROWS.usage_events(randomUUID(), w.accountId, null),
      kind: 'export',
      result: 'refused',
      billable: false,
    });
    const counts = (user: string) =>
      asRole(db, 'authenticated', user, (tx) =>
        tx.query<{ month: Date; kind: string; result: string; billable: boolean; events: number }>(
          `select month, kind, result, billable, events::int as events from public.usage_counts($1)`,
          [w.accountId],
        ),
      );
    // seedWorld writes one delivered check_finished event per site, dated T2 (October 2026).
    const expected = [
      { kind: 'check_finished', result: 'delivered', billable: true, events: 2 },
      { kind: 'export', result: 'refused', billable: false, events: 1 },
    ];
    for (const user of [w.ownerId, w.scopedUserId]) {
      const { rows } = await counts(user);
      expect(rows.map(({ month: _m, ...r }) => r)).toEqual(expected);
      expect(rows.every((r) => r.month.toISOString().startsWith('2026-10-01'))).toBe(true);
    }
    expect((await counts(world.ownerId)).rows).toEqual([]);
    const server = await asRole(db, 'service_role', null, (tx) =>
      tx.query(`select * from public.usage_counts($1)`, [w.accountId]),
    );
    expect(server.rows, 'no signed-in user, no seat').toEqual([]);
    await expect(
      asRole(db, 'authenticated', w.ownerId, (tx) => tx.query(`select 1 from public.usage_events`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRole(db, 'anon', null, (tx) =>
        tx.query(`select * from public.usage_counts($1)`, [w.accountId]),
      ),
    ).rejects.toThrow(/permission denied/);
  }, 120_000);
});

// ─── 6. Migration 006b applies, re-applies and reverts ────────────────────────────────────────────

describe('migration 006b applies, re-applies and reverts', () => {
  it('re-applying it changes nothing in the catalog', async () => {
    const d = await freshDb();
    await applyAllMigrations(d, undefined, through(MIGRATION_006B));
    const once = await catalogSnapshot(d);
    await d.exec(readMigration(MIGRATION_006B));
    expect(await catalogSnapshot(d)).toEqual(once);
  }, 120_000);

  it('the revert returns the catalog to the state before 006b, twice, and 006b re-applies', async () => {
    const d = await freshDb();
    await applyAllMigrations(d, undefined, before(MIGRATION_006B));
    const pre = await catalogSnapshot(d);
    await d.exec(readMigration(MIGRATION_006B));
    const applied = await catalogSnapshot(d);
    expect(applied).not.toEqual(pre); // anti-vacuity
    await d.exec(readRollback(ROLLBACK));
    expect(await catalogSnapshot(d)).toEqual(pre);
    await d.exec(readRollback(ROLLBACK));
    expect(await catalogSnapshot(d)).toEqual(pre);
    await d.exec(readMigration(MIGRATION_006B));
    expect(await catalogSnapshot(d)).toEqual(applied);
  }, 120_000);

  it('the revert succeeds with rows in every table it drops', async () => {
    const d = await freshDb();
    await applyAllMigrations(d);
    await prepareMeasurement(d);
    await seedWorld(d, 'revert-006b');
    await d.exec(readRollback(ROLLBACK));
    const { rows } = await d.query<{ n: number }>(
      `select count(*)::int as n from pg_namespace where nspname = 'research'`,
    );
    expect(rows[0]!.n).toBe(0);
  }, 120_000);
});
