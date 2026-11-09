import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { FlyRegionSchema, WorkerReleaseSchema } from '@crawlmouse/types/v2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalogSnapshot } from './helpers/catalog-snapshot';
import {
  applyAllMigrations,
  freshDb,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';
import {
  before,
  constraints,
  enumSetOf,
  insertLedgerRow,
  insertRow,
  ledgerRun,
  prepareMeasurement,
  ROWS,
  seedWorld,
  SHA,
  through,
} from './helpers/v2-check-tables';

/**
 * Migration 006d: the contract fields CC-12d added that no column held (PageResult's title and meta
 * description; AccessTest's identity, vantage and timing), and the enum values it added
 * (SourceIpClass's other_egress, SignalKind's four declarations). That every field now has a column
 * of the contract's nullability, and every enum CHECK the contract's values, is the contract guard's
 * (v2-contract-guard.test.ts, v2-006b-data-foundations.test.ts); the shape and rule CHECKs on
 * page_results are compared with the contract in v2-003-rule-agreement.test.ts. This file holds what
 * is particular to the migration: it refuses to add the NOT NULL columns over existing rows, it finds
 * the CHECKs it widens by the catalog, it re-applies and reverts cleanly, and the revert refuses to
 * narrow a CHECK over a row that holds a value it would drop.
 */

const MIGRATION = '20261108000003_v2_006d_contract_columns.sql';
const ROLLBACK = '20261108000003_v2_006d_contract_columns.revert.sql';
const CHECKS_DIR = resolve(__dirname, '../../../infra/supabase/checks');

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  await prepareMeasurement(db);
}, 120_000);
afterAll(async () => {
  await db?.close();
});

/** A check to hang measurement rows on, in MONTH0 (prepareMeasurement's partitions). */
async function aCheck(d: PGlite): Promise<string> {
  const site = randomUUID();
  const check = randomUUID();
  await insertRow(d, 'sites', ROWS.sites(site, null, `d-${site.slice(0, 8)}.example`));
  await insertRow(d, 'checks', ROWS.checks(check, site));
  return check;
}

describe('the new columns hold contract values', () => {
  it('an access row of every identity role, with its vantage and timing, is stored and read back', async () => {
    const check = await aCheck(db);
    const rows = [
      { identity_role: 'crawler', ua: 'GPTBot', tagged: true },
      { identity_role: 'control', ua: null, tagged: false },
      { identity_role: 'canary', ua: null, tagged: true },
      { identity_role: 'render', ua: null, tagged: false },
    ].map((r) => ({
      ...ROWS.access_tests(randomUUID(), check),
      ...r,
      witness: null,
      fly_region: 'iad',
      request_signing: 'unsigned',
      signature_verified: 'not_observable',
      worker_release: 'unreleased',
      timing: { dns_ms: 3, connect_ms: 20, ttfb_ms: 140, total_ms: 180 },
    }));
    for (const r of rows) await insertRow(db, 'access_tests', r);
    const { rows: back } = await db.query<{ r: Record<string, unknown> }>(
      `select to_jsonb(t) as r from public.access_tests t where check_id = $1 order by identity_role`,
      [check],
    );
    expect(back.map((b) => b.r.identity_role)).toEqual(['canary', 'control', 'crawler', 'render']);
    expect(back[0]!.r.timing).toEqual({ dns_ms: 3, connect_ms: 20, ttfb_ms: 140, total_ms: 180 });
  });

  it('source_ip_class takes other_egress on both tables', async () => {
    const check = await aCheck(db);
    await insertRow(db, 'access_tests', {
      ...ROWS.access_tests(randomUUID(), check),
      source_ip_class: 'other_egress',
    });
    await insertRow(db, 'page_results', {
      ...ROWS.page_results(check, 'https://x.example/egress'),
      source_ip_class: 'other_egress',
    });
  });

  it('a ledger run records the four declarations CC-12d added, detected or indeterminate', async () => {
    await insertLedgerRow(db, 'check_runs', {
      ...ledgerRun(randomUUID(), SHA(0x6d01)),
      signals_detected: ['ucp', 'rsl'],
      signals_indeterminate: ['agent_card', 'llms_full'],
    });
  });

  // FlyRegion and WorkerRelease are regular expressions in the contract; each CHECK is the same one.
  it.each([
    ['fly_region', FlyRegionSchema, ['iad', 'ams', 'IAD', 'ia', 'iadx', 'ia1', 'iad\n', '']],
    [
      'worker_release',
      WorkerReleaseSchema,
      [
        'unreleased',
        '0123456789ab',
        '0123456789AB',
        '0123456789a',
        '0123456789abc',
        'released',
        '',
      ],
    ],
  ] as const)(
    'access_tests.%s refuses exactly what the contract refuses',
    async (column, schema, values) => {
      const check = await aCheck(db);
      const verdicts: [string, boolean, boolean][] = [];
      for (const v of values) {
        const stored = await db
          .transaction(async (tx) => {
            await insertRow(tx, 'access_tests', {
              ...ROWS.access_tests(randomUUID(), check),
              [column]: v,
            });
            await tx.rollback();
          })
          .then(
            () => true,
            (e: { code?: string }) => {
              if (e.code !== '23514') throw e;
              return false;
            },
          );
        verdicts.push([v, schema.safeParse(v).success, stored]);
      }
      expect(verdicts.filter(([, contract, database]) => contract !== database)).toEqual([]);
      expect(new Set(verdicts.map(([, c]) => c)), 'both verdicts').toEqual(new Set([true, false]));
    },
  );
});

describe('the CHECKs 006d widens are found by the catalog and left one per column', () => {
  it.each([
    ['public', 'access_tests', 'source_ip_class', 'access_tests_source_ip_class_check'],
    ['public', 'page_results', 'source_ip_class', 'page_results_source_ip_class_check'],
    ['research', 'check_runs', 'signals_detected', 'check_runs_signals_detected_check'],
    ['research', 'check_runs', 'signals_indeterminate', 'check_runs_signals_indeterminate_check'],
  ])(
    '%s.%s.%s, whatever its CHECK was named',
    async (schema, table, column, name) => {
      const d = await freshDb();
      try {
        await applyAllMigrations(d, undefined, before(MIGRATION));
        await d.exec(`alter table ${schema}.${table} rename constraint ${name} to was_${column}`);
        await d.exec(readMigration(MIGRATION));
        const { rows } = await d.query<{ conname: string; def: string }>(
          `select k.conname, pg_get_constraintdef(k.oid) as def
           from pg_constraint k
          where k.conrelid = $1::regclass and k.contype = 'c'
            and pg_get_constraintdef(k.oid) ~ ('^CHECK \\(\\(?' || $2 || ' (= ANY|<@)')`,
          [`${schema}.${table}`, column],
        );
        expect(rows.map((r) => r.conname)).toEqual([name]);
        expect(enumSetOf(rows[0]!.def)).toContain(
          column === 'source_ip_class' ? 'other_egress' : 'ucp',
        );
      } finally {
        await d.close();
      }
    },
    120_000,
  );
});

describe('migration 006d refuses to add NOT NULL columns over existing access rows', () => {
  it('raises before changing anything when access_tests holds a row', async () => {
    const d = await freshDb();
    try {
      await applyAllMigrations(d, undefined, before(MIGRATION));
      await seedWorld(d, 'pre-006d');
      const pre = await catalogSnapshot(d);
      await expect(d.exec(readMigration(MIGRATION))).rejects.toThrow(
        /006d: access_tests holds rows/,
      );
      expect(await catalogSnapshot(d), 'the refused migration changed nothing').toEqual(pre);
    } finally {
      await d.close();
    }
  }, 120_000);

  it('re-applies over rows once the columns exist', async () => {
    const d = await freshDb();
    try {
      await applyAllMigrations(d, undefined, through(MIGRATION));
      await seedWorld(d, 'post-006d');
      const once = await catalogSnapshot(d);
      await d.exec(readMigration(MIGRATION));
      expect(await catalogSnapshot(d)).toEqual(once);
    } finally {
      await d.close();
    }
  }, 120_000);
});

describe('migration 006d applies, re-applies and reverts', () => {
  it('re-applying it changes nothing in the catalog', async () => {
    const d = await freshDb();
    try {
      await applyAllMigrations(d, undefined, through(MIGRATION));
      const once = await catalogSnapshot(d);
      await d.exec(readMigration(MIGRATION));
      expect(await catalogSnapshot(d)).toEqual(once);
    } finally {
      await d.close();
    }
  }, 120_000);

  it('the revert returns the catalog to the state before 006d, twice, and 006d re-applies', async () => {
    const d = await freshDb();
    try {
      await applyAllMigrations(d, undefined, before(MIGRATION));
      const pre = await catalogSnapshot(d);
      await d.exec(readMigration(MIGRATION));
      const applied = await catalogSnapshot(d);
      expect(applied).not.toEqual(pre); // anti-vacuity
      await d.exec(readRollback(ROLLBACK));
      expect(await catalogSnapshot(d)).toEqual(pre);
      await d.exec(readRollback(ROLLBACK));
      expect(await catalogSnapshot(d)).toEqual(pre);
      await d.exec(readMigration(MIGRATION));
      expect(await catalogSnapshot(d)).toEqual(applied);
    } finally {
      await d.close();
    }
  }, 120_000);

  it.each([
    [
      'an access row from other egress',
      `update public.access_tests set source_ip_class = 'other_egress'`,
    ],
    [
      'a page row from other egress',
      `update public.page_results set source_ip_class = 'other_egress'`,
    ],
  ])(
    'the revert refuses while %s exists, and changes nothing',
    async (_label, update) => {
      const d = await freshDb();
      try {
        await applyAllMigrations(d, undefined, through(MIGRATION));
        await seedWorld(d, 'revert-006d');
        await d.exec(update);
        const applied = await catalogSnapshot(d);
        await expect(d.exec(readRollback(ROLLBACK))).rejects.toMatchObject({ code: '23514' });
        expect(await catalogSnapshot(d), 'the failed revert changed nothing').toEqual(applied);
      } finally {
        await d.close();
      }
    },
    120_000,
  );

  it('the revert refuses while a ledger run records a declaration CC-12d added', async () => {
    const d = await freshDb();
    try {
      await applyAllMigrations(d, undefined, through(MIGRATION));
      await prepareMeasurement(d);
      await insertLedgerRow(d, 'check_runs', {
        ...ledgerRun(randomUUID(), SHA(0x6d02)),
        signals_detected: ['llms_full'],
      });
      const applied = await catalogSnapshot(d);
      await expect(d.exec(readRollback(ROLLBACK))).rejects.toMatchObject({ code: '23514' });
      expect(await catalogSnapshot(d), 'the failed revert changed nothing').toEqual(applied);
    } finally {
      await d.close();
    }
  }, 120_000);
});

describe('grants', () => {
  it('check 01 finds nothing: authenticated reads the new columns as it reads their siblings', async () => {
    const { rows } = await db.query(
      readFileSync(join(CHECKS_DIR, '01-client-table-privileges.sql'), 'utf8'),
    );
    expect(rows).toEqual([]);
  });

  it('the shape functions the new page_results CHECKs call are executable by the writers only', async () => {
    const { rows } = await db.query<{
      fn: string;
      anon: boolean;
      auth: boolean;
      sr: boolean;
      cw: boolean;
    }>(
      `select p.proname as fn,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
              has_function_privilege('service_role', p.oid, 'EXECUTE') as sr,
              has_function_privilege('crawl_worker', p.oid, 'EXECUTE') as cw
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('v2_head_text_shape_ok', 'v2_head_text_absent_ok')
        order by 1`,
    );
    expect(rows).toEqual([
      { fn: 'v2_head_text_absent_ok', anon: false, auth: false, sr: true, cw: true },
      { fn: 'v2_head_text_shape_ok', anon: false, auth: false, sr: true, cw: true },
    ]);
  });

  it('the page_results CHECKs on title and meta_description exist under their names', async () => {
    const names = (await constraints(db, 'page_results')).map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'page_results_title',
        'page_results_meta_description',
        'page_results_head_text_absent',
      ]),
    );
  });
});
