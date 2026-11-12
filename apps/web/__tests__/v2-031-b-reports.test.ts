import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scopeWorld, type ScopeWorld } from '../lib/v2/account/sites-test-support';
import { REPORT_FILES, reportPath, type ReportFormat } from '../lib/v2/reports/generate';
import {
  applyAllMigrations,
  asRole,
  freshDb,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';
import { insertRow, ROWS } from './helpers/v2-check-tables';

/**
 * Migration 031's section B, report files (docs/specs/v2/31-agency.md §9): the three columns of
 * `reports`, and create_report, finish_report, fail_report and fail_abandoned_reports. The world is
 * `scopeWorld`'s Agency account with two client sites, each with a finished check and a fix.
 */

const MIGRATION = '20261114000002_v2_031_agency.sql';
const ROLLBACK = '20261114000002_v2_031_agency.revert.sql';

const FUNCTIONS = [
  'public.create_report(jsonb)',
  'public.finish_report(uuid, text, bigint)',
  'public.fail_report(uuid, text)',
  'public.fail_abandoned_reports(uuid, timestamptz)',
  'public.report_file_path(uuid, uuid, text)',
];

let db: PGlite;
let w: ScopeWorld;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  w = await scopeWorld(db);
}, 120_000);
afterAll(async () => db.close());

const asService = <T>(sql: string, params: unknown[] = []) =>
  asRole(db, 'service_role', null, async (tx) => (await tx.query<T>(sql, params)).rows);

const request = (over: Record<string, unknown> = {}) => ({
  account_id: w.accountId,
  site_id: w.site1.id,
  kind: 'audit_pdf',
  format: 'pdf',
  covers_check_ids: [w.site1.check],
  ...over,
});

async function create(over: Record<string, unknown> = {}): Promise<string> {
  const rows = await asService<{ id: string }>(`select public.create_report($1::jsonb) id`, [
    JSON.stringify(request(over)),
  ]);
  return rows[0]!.id;
}

interface FileRow {
  kind: string;
  format: string;
  status: string;
  made_by: string;
  file_state: string | null;
  storage_path: string | null;
  byte_count: string | number | null;
  failed_reason: string | null;
  subject_fix_id: string | null;
  covers_check_ids: string[];
}

async function row(id: string): Promise<FileRow> {
  const { rows } = await db.query<FileRow>(
    `select kind, format, status, made_by, file_state, storage_path, byte_count, failed_reason,
            subject_fix_id, covers_check_ids
       from public.reports where id = $1`,
    [id],
  );
  return rows[0]!;
}

const reportCount = async () =>
  (await db.query<{ n: number }>(`select count(*)::int n from public.reports`)).rows[0]!.n;

/** A check of `siteId` in `status`, written as postgres. */
async function checkIn(siteId: string, status: 'queued' | 'failed' | 'partial'): Promise<string> {
  if (status === 'partial') {
    const id = randomUUID();
    await insertRow(db, 'checks', { ...ROWS.checks(id, siteId), status });
    return id;
  }
  const { rows } = await db.query<{ id: string }>(
    status === 'queued'
      ? `insert into public.checks (site_id, status, trigger, grade_version)
         values ($1, 'queued', 'manual', '2.0.0') returning id`
      : `insert into public.checks (site_id, status, trigger, grade_version, started_at,
                                    finished_at, failure_reason)
         values ($1, 'failed', 'manual', '2.0.0', now(), now(), 'persist_failed') returning id`,
    [siteId],
  );
  return rows[0]!.id;
}

describe('the columns', () => {
  it('lets a signed-in reader select file_state and none of storage_path, failed_reason, subject_fix_id', async () => {
    const { rows } = await db.query<{ col: string; can: boolean }>(
      `select c.col, has_column_privilege('authenticated', 'public.reports', c.col, 'SELECT') can
         from (values ('file_state'), ('storage_path'), ('failed_reason'), ('subject_fix_id')) c(col)
        order by 1`,
    );
    expect(rows).toEqual([
      { col: 'failed_reason', can: false },
      { col: 'file_state', can: true },
      { col: 'storage_path', can: false },
      { col: 'subject_fix_id', can: false },
    ]);
  });

  it('leaves a report with no file as it was: file_state null', async () => {
    expect((await row(w.site1.report)).file_state).toBeNull();
  });

  it.each([
    ['a path without the stored state', { storage_path: 'a/b.pdf' }, /reports_stored_path/],
    [
      'a path on a pending report',
      { file_state: 'pending', storage_path: 'a/b.pdf' },
      /reports_stored_path/,
    ],
    ['the stored state without a path', { file_state: 'stored' }, /reports_stored_path/],
    ['a state the column does not list', { file_state: 'ready' }, /reports_file_state/],
    [
      'a reason on a pending report',
      { file_state: 'pending', failed_reason: 'x' },
      /reports_failed_reason/,
    ],
    ['the failed state without a reason', { file_state: 'failed' }, /reports_failed_reason/],
    [
      'a reason that is not a short code',
      { file_state: 'failed', failed_reason: 'Error: boom at line 1' },
      /reports_failed_reason/,
    ],
  ])('refuses %s', async (_name, columns, constraint) => {
    await expect(
      insertRow(db, 'reports', {
        ...ROWS.reports(randomUUID(), w.accountId, w.site1.id, w.site1.check),
        ...columns,
      }),
    ).rejects.toThrow(constraint);
  });

  it('shows a seat file_state for a site it covers, and no row for one it does not', async () => {
    const id1 = await create();
    const id2 = await create({ site_id: w.site2.id, covers_check_ids: [w.site2.check] });
    const read = (userId: string) =>
      asRole(db, 'authenticated', userId, async (tx) => {
        const { rows } = await tx.query<{ id: string; file_state: string }>(
          `select id, file_state from public.reports where id = any($1) order by id`,
          [[id1, id2]],
        );
        return rows;
      });
    const both = [
      { id: id1, file_state: 'pending' },
      { id: id2, file_state: 'pending' },
    ].sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(await read(w.owner.id)).toEqual(both);
    expect(await read(w.developer.id)).toEqual([{ id: id1, file_state: 'pending' }]);
    expect(await read(w.removed.id)).toEqual([]);
    expect(await read(w.stranger.id)).toEqual([]);
  });
});

describe('create_report', () => {
  it('writes a pending row a person made, for each kind and format it makes', async () => {
    const made: [string, string][] = [
      ['audit_pdf', 'pdf'],
      ['compare', 'html'],
      ['raw_export', 'csv'],
      ['raw_export', 'json'],
      ['raw_export', 'edge_list'],
    ];
    for (const [kind, format] of made) {
      const id = await create({ kind, format });
      expect(await row(id)).toEqual({
        kind,
        format,
        status: 'ready',
        made_by: 'user',
        file_state: 'pending',
        storage_path: null,
        byte_count: null,
        failed_reason: null,
        subject_fix_id: null,
        covers_check_ids: [w.site1.check],
      });
    }
  });

  it('accepts a partial check, two checks of the site for a compare, and a fix of the site', async () => {
    const partial = await checkIn(w.site1.id, 'partial');
    const id = await create({
      kind: 'compare',
      format: 'html',
      covers_check_ids: [w.site1.check, partial],
      subject_fix_id: w.site1.fix,
      owner_seat_id: w.owner.seatId,
    });
    const r = await row(id);
    expect(r.covers_check_ids).toEqual([w.site1.check, partial]);
    expect(r.subject_fix_id).toBe(w.site1.fix);
  });

  const refusedAsMissing = async (overs: Record<string, unknown>[]) => {
    const before = await reportCount();
    for (const over of overs) {
      await expect(create(over), JSON.stringify(over)).rejects.toMatchObject({ code: 'P0002' });
    }
    expect(await reportCount()).toBe(before);
  };

  it('writes nothing for a check of another site', async () => {
    await refusedAsMissing([
      { covers_check_ids: [w.site2.check] },
      { kind: 'compare', format: 'html', covers_check_ids: [w.site1.check, w.site2.check] },
      { kind: 'compare', format: 'html', covers_check_ids: [w.site2.check, w.site1.check] },
    ]);
  });

  it('writes nothing for a check that has no result, or that does not exist', async () => {
    await refusedAsMissing([
      { covers_check_ids: [await checkIn(w.site1.id, 'queued')] },
      { covers_check_ids: [await checkIn(w.site1.id, 'failed')] },
      { covers_check_ids: [randomUUID()] },
    ]);
  });

  it('writes nothing for a site that is not the account’s', async () => {
    await refusedAsMissing([{ account_id: w.stranger.accountId }, { site_id: randomUUID() }]);
  });

  it('writes nothing for a fix of another site', async () => {
    await refusedAsMissing([
      { kind: 'compare', format: 'html', subject_fix_id: w.site2.fix },
      { kind: 'compare', format: 'html', subject_fix_id: randomUUID() },
    ]);
  });

  it('raises 22023 for a request it does not make', async () => {
    const second = await checkIn(w.site1.id, 'partial');
    const malformed: Record<string, unknown>[] = [
      { kind: 'public_link', format: 'html' },
      { kind: 'client_report', format: 'pdf' },
      { kind: 'prospect_one_pager', format: 'pdf' },
      { kind: 'audit_pdf', format: 'csv' },
      { kind: 'compare', format: 'pdf' },
      { kind: 'raw_export', format: 'pdf' },
      { covers_check_ids: [] },
      { covers_check_ids: [w.site1.check, second] },
      { kind: 'compare', format: 'html', covers_check_ids: [w.site1.check, w.site1.check] },
      {
        kind: 'compare',
        format: 'html',
        covers_check_ids: [w.site1.check, second, w.site1.check],
      },
      { subject_fix_id: w.site1.fix },
      { status: 'sent' },
      { storage_path: 'a/b.pdf' },
      { covers_check_ids: 'not-an-array' },
    ];
    const before = await reportCount();
    for (const over of malformed) {
      await expect(create(over), JSON.stringify(over)).rejects.toMatchObject({ code: '22023' });
    }
    await expect(asService(`select public.create_report('[]'::jsonb)`)).rejects.toMatchObject({
      code: '22023',
    });
    await expect(
      asService(`select public.create_report($1::jsonb)`, [
        JSON.stringify({ ...request(), kind: undefined }),
      ]),
    ).rejects.toMatchObject({ code: '22023' });
    expect(await reportCount()).toBe(before);
  });
});

describe('finish_report', () => {
  const finish = async (id: string, path: string, bytes: number | null = 1234) =>
    (
      await asService<{ ok: boolean }>(`select public.finish_report($1, $2, $3) ok`, [
        id,
        path,
        bytes,
      ])
    )[0]!.ok;

  it('stores the report’s own path and size, once', async () => {
    const id = await create();
    const path = reportPath(w.accountId, id, 'pdf');
    expect(await finish(id, path)).toBe(true);
    expect(await row(id)).toMatchObject({
      file_state: 'stored',
      storage_path: path,
      byte_count: 1234,
    });
    expect(await finish(id, path, 99)).toBe(false);
    expect((await row(id)).byte_count).toBe(1234);
  });

  it('names the file as reportPath does, for every format', async () => {
    const report = randomUUID();
    for (const format of Object.keys(REPORT_FILES) as ReportFormat[]) {
      const [r] = await asService<{ path: string }>(
        `select public.report_file_path($1, $2, $3) path`,
        [w.accountId, report, format],
      );
      expect(r!.path).toBe(reportPath(w.accountId, report, format));
    }
  });

  it('refuses a path outside the report’s own, and leaves the report pending', async () => {
    const id = await create();
    const other = await create();
    const outside = [
      reportPath(w.accountId, other, 'pdf'),
      reportPath(w.stranger.accountId, id, 'pdf'),
      reportPath(w.accountId, id, 'csv'),
      `${reportPath(w.accountId, id, 'pdf')}/../x`,
      `../${reportPath(w.accountId, id, 'pdf')}`,
      '',
    ];
    for (const path of outside) {
      await expect(finish(id, path), path).rejects.toMatchObject({ code: '22023' });
    }
    await expect(asService(`select public.finish_report($1, null, 1)`, [id])).rejects.toMatchObject(
      { code: '22023' },
    );
    expect(await row(id)).toMatchObject({ file_state: 'pending', storage_path: null });
  });

  it('refuses a size that is not one, and a report that does not exist', async () => {
    const id = await create();
    const path = reportPath(w.accountId, id, 'pdf');
    await expect(finish(id, path, -1)).rejects.toMatchObject({ code: '22023' });
    await expect(finish(id, path, null)).rejects.toMatchObject({ code: '22023' });
    const missing = randomUUID();
    await expect(finish(missing, reportPath(w.accountId, missing, 'pdf'))).rejects.toMatchObject({
      code: 'P0002',
    });
  });

  it('does not store a file for a report that failed', async () => {
    const id = await create();
    await asService(`select public.fail_report($1, 'generation_failed')`, [id]);
    expect(await finish(id, reportPath(w.accountId, id, 'pdf'))).toBe(false);
    expect(await row(id)).toMatchObject({ file_state: 'failed', storage_path: null });
  });
});

describe('fail_report', () => {
  const fail = async (id: string, reason: string | null) =>
    (await asService<{ ok: boolean }>(`select public.fail_report($1, $2) ok`, [id, reason]))[0]!.ok;

  it('marks a pending report failed with its code, and no other report', async () => {
    const id = await create();
    expect(await fail(id, 'generation_failed')).toBe(true);
    expect(await row(id)).toMatchObject({
      file_state: 'failed',
      failed_reason: 'generation_failed',
      storage_path: null,
    });
    expect(await fail(id, 'store_failed')).toBe(false);
    expect((await row(id)).failed_reason).toBe('generation_failed');
    expect(await fail(randomUUID(), 'generation_failed')).toBe(false);
    expect(await fail(w.site1.report, 'generation_failed')).toBe(false);
    expect((await row(w.site1.report)).file_state).toBeNull();
  });

  it('refuses a reason that is not a short code', async () => {
    const id = await create();
    const reasons = [
      'Error: connect ECONNREFUSED 10.0.0.1',
      'TypeError\n    at render (pdf.ts:10)',
      'https://example.com/a',
      'x'.repeat(41),
      '',
      'Failed',
      null,
    ];
    for (const reason of reasons) {
      await expect(fail(id, reason), String(reason)).rejects.toMatchObject({ code: '22023' });
    }
    expect(await row(id)).toMatchObject({ file_state: 'pending', failed_reason: null });
  });
});

describe('fail_abandoned_reports', () => {
  it('marks the account’s reports pending since before the time, and no other', async () => {
    const old = await create();
    const recent = await create();
    const stored = await create();
    await asService(`select public.finish_report($1, $2, 1)`, [
      stored,
      reportPath(w.accountId, stored, 'pdf'),
    ]);
    await db.query(
      `update public.reports set created_at = now() - interval '1 hour' where id = any($1)`,
      [[old, stored, w.site1.report]],
    );
    await db.query(
      `update public.reports set file_state = 'failed', failed_reason = 'abandoned'
        where account_id = $1 and file_state = 'pending' and id <> all($2)`,
      [w.accountId, [old, recent]],
    );
    const call = (account: string) =>
      asService<{ n: number }>(
        `select public.fail_abandoned_reports($1, now() - interval '15 minutes') n`,
        [account],
      );
    expect((await call(w.stranger.accountId))[0]!.n).toBe(0);
    expect((await row(old)).file_state).toBe('pending');
    expect((await call(w.accountId))[0]!.n).toBe(1);
    expect(await row(old)).toMatchObject({ file_state: 'failed', failed_reason: 'abandoned' });
    expect((await row(recent)).file_state).toBe('pending');
    expect((await row(stored)).file_state).toBe('stored');
    expect((await row(w.site1.report)).file_state).toBeNull();
    await expect(
      asService(`select public.fail_abandoned_reports($1, null)`, [w.accountId]),
    ).rejects.toMatchObject({ code: '22023' });
  });
});

describe('the functions', () => {
  it('are executable by the service role and by no client role', async () => {
    const { rows } = await db.query<{ fn: string; roles: string[] }>(
      `select f.fn,
              array(select r.role
                      from (values ('anon'), ('authenticated'), ('public'), ('service_role')) r(role)
                     where has_function_privilege(r.role, f.fn, 'EXECUTE')
                     order by 1) roles
         from unnest($1::text[]) f(fn) order by 1`,
      [FUNCTIONS],
    );
    expect(rows).toEqual([...FUNCTIONS].sort().map((fn) => ({ fn, roles: ['service_role'] })));
  });

  it('pin their search_path, and each that writes is a definer function', async () => {
    const { rows } = await db.query<{ fn: string; definer: boolean; config: string[] }>(
      `select f.fn, p.prosecdef definer, p.proconfig config
         from unnest($1::text[]) f(fn) join pg_proc p on p.oid = f.fn::regprocedure order by 1`,
      [FUNCTIONS],
    );
    expect(rows).toEqual(
      [...FUNCTIONS].sort().map((fn) => ({
        fn,
        definer: fn !== 'public.report_file_path(uuid, uuid, text)',
        config: ['search_path=pg_catalog, pg_temp'],
      })),
    );
  });
});

describe('the migration', () => {
  it('applies twice, reverts its report columns and functions, and applies again', async () => {
    const columns = async () =>
      (
        await db.query<{ column_name: string }>(
          `select column_name from information_schema.columns
            where table_schema = 'public' and table_name = 'reports'
              and column_name in ('file_state', 'failed_reason', 'subject_fix_id') order by 1`,
        )
      ).rows.map((r) => r.column_name);
    const functions = async () =>
      (
        await db.query<{ proname: string }>(
          `select proname from pg_proc
            where proname in ('create_report', 'finish_report', 'fail_report',
                              'fail_abandoned_reports', 'report_file_path') order by 1`,
        )
      ).rows.map((r) => r.proname);
    const constraints = async () =>
      (
        await db.query<{ conname: string }>(
          `select conname from pg_constraint
            where conrelid = 'public.reports'::regclass
              and conname in ('reports_file_state', 'reports_stored_path', 'reports_failed_reason')
            order by 1`,
        )
      ).rows.map((r) => r.conname);
    const applied = async () => {
      expect(await columns()).toEqual(['failed_reason', 'file_state', 'subject_fix_id']);
      expect(await functions()).toEqual([
        'create_report',
        'fail_abandoned_reports',
        'fail_report',
        'finish_report',
        'report_file_path',
      ]);
      expect(await constraints()).toEqual([
        'reports_failed_reason',
        'reports_file_state',
        'reports_stored_path',
      ]);
    };
    const stored = await create();
    await asService(`select public.finish_report($1, $2, 1)`, [
      stored,
      reportPath(w.accountId, stored, 'pdf'),
    ]);
    await db.exec(readMigration(MIGRATION));
    await applied();
    expect((await row(stored)).file_state).toBe('stored');
    await db.exec(readRollback(ROLLBACK));
    expect(await columns()).toEqual([]);
    expect(await functions()).toEqual([]);
    expect(await constraints()).toEqual([]);
    await db.exec(readRollback(ROLLBACK));
    await db.exec(readMigration(MIGRATION));
    await applied();
  });
});
