import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CHECK_PIPELINE_COLUMNS,
  CRAWL_BATCH_COLUMNS,
  PERSIST_RPC,
  SITE_SCHEDULE_COLUMNS,
} from '../lib/v2/pipeline/columns';
import { FAILURE_REASONS } from '../lib/v2/pipeline/limits';
import { catalogSnapshot } from './helpers/catalog-snapshot';
import {
  applyAllMigrations,
  asRole,
  freshDb,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';
import { before, through } from './helpers/v2-check-tables';

/**
 * Migration 008 (CC-20b, D6, Q11 and Q13): crawl_batches and persist_chunks, the pipeline's columns
 * on checks and sites, the one-running-check-per-site index, the state functions claim_check,
 * fail_check and reap_stalled_checks, the failure reasons they may write (check_failure_reasons, held
 * equal to the pipeline's FAILURE_REASONS here), and stage_check_rows and persist_built_check. What
 * the last two write, and that a check is written once and whole, is tested through their one caller
 * (apps/web/lib/v2/pipeline/persist.test.ts, round-trip.test.ts, recheck.test.ts) on a check the
 * engine built; this file holds the catalog, the grants, the reasons and the three state functions.
 *
 * PGlite has one backend, so two transactions never overlap here: "two claims at once" below runs
 * them in turn, which is the order a real race resolves in once the first commits.
 */

const MIGRATION = '20261109000001_v2_008_pipeline.sql';
const ROLLBACK = '20261109000001_v2_008_pipeline.revert.sql';
const CHECKS_DIR = resolve(__dirname, '../../../infra/supabase/checks');
const PROGRESS = { steps: [{ phase: 'crawl', state: 'running' }] };

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 120_000);
afterAll(async () => {
  await db?.close();
});

async function aSite(): Promise<string> {
  const id = randomUUID();
  await db.query(`insert into public.sites (id, account_id, host) values ($1, null, $2)`, [
    id,
    `p-${id.slice(0, 8)}.example`,
  ]);
  return id;
}

/** A queued check of `site`, queued `ageMin` minutes ago. */
async function aQueuedCheck(site: string, ageMin = 0): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into public.checks (id, site_id, status, trigger, grade_version, queued_at)
     values ($1, $2, 'queued', 'manual', '2.0.0', now() - make_interval(mins => $3))`,
    [id, site, ageMin],
  );
  return id;
}

interface CheckState {
  status: string;
  started_at: string | null;
  finished_at: string | null;
  failure_reason: string | null;
  progress: unknown;
  inngest_run_id: string | null;
  heartbeat_at: string | null;
}
async function stateOf(id: string): Promise<CheckState> {
  const { rows } = await db.query<CheckState>(
    `select status, started_at::text, finished_at::text, failure_reason, progress, inngest_run_id,
            heartbeat_at::text
       from public.checks where id = $1`,
    [id],
  );
  return rows[0]!;
}

const claim = async (check: string, run: string, progress: unknown = PROGRESS) =>
  (
    await db.query<{ r: string }>(`select public.claim_check($1, $2, $3::jsonb) as r`, [
      check,
      run,
      JSON.stringify(progress),
    ])
  ).rows[0]!.r;
const fail = async (check: string | null, reason: string, run: string | null = null) =>
  (
    await db.query<{ r: boolean }>(`select public.fail_check($1, $2, $3) as r`, [
      check,
      reason,
      run,
    ])
  ).rows[0]!.r;

async function aBatch(check: string, batch: number, status = 'posted'): Promise<void> {
  await db.query(
    `insert into public.crawl_batches (check_id, batch, kind, nonce, status, posted_at)
     values ($1, $2, 'crawl', $3, $4, now())`,
    [check, batch, `nonce-${randomUUID().replaceAll('-', '')}`, status],
  );
}
/** One staged chunk of link edges for a running check. */
async function stage(check: string): Promise<void> {
  await db.query(`select public.stage_check_rows($1, 'link_edges', 0, '[]'::jsonb)`, [check]);
}
const stagedChunks = async (check: string) =>
  (
    await db.query<{ n: number }>(
      `select count(*)::int as n from public.persist_chunks where check_id = $1`,
      [check],
    )
  ).rows[0]!.n;
const batchStatuses = async (check: string) =>
  (
    await db.query<{ status: string }>(
      `select status from public.crawl_batches where check_id = $1 order by batch`,
      [check],
    )
  ).rows.map((r) => r.status);

// ─── The catalog ──────────────────────────────────────────────────────────────────────────────────

describe('the columns 008 adds are the ones columns.ts names', () => {
  it.each([
    ['crawl_batches', CRAWL_BATCH_COLUMNS],
    ['checks', CHECK_PIPELINE_COLUMNS],
    ['sites', SITE_SCHEDULE_COLUMNS],
  ] as const)('%s', async (table, names) => {
    const { rows } = await db.query<{ c: string }>(
      `select attname as c from pg_attribute
        where attrelid = ('public.' || $1)::regclass and attnum > 0 and not attisdropped`,
      [table],
    );
    expect(rows.map((r) => r.c)).toEqual(expect.arrayContaining([...names]));
    if (table === 'crawl_batches') expect(rows.map((r) => r.c).sort()).toEqual([...names].sort());
  });
});

describe('access', () => {
  it.each(['crawl_batches', 'persist_chunks'])(
    '%s: RLS on; anon, authenticated and crawl_worker hold nothing; service_role reads and writes',
    async (table) => {
      const { rows } = await db.query<{ rls: boolean }>(
        `select relrowsecurity as rls from pg_class where oid = ('public.' || $1)::regclass`,
        [table],
      );
      expect(rows[0]!.rls).toBe(true);
      const held = async (role: string) =>
        (
          await db.query<{ p: string }>(
            `select p from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES',
                                      'TRIGGER']) with ordinality as t (p, n)
            where has_table_privilege($1, ('public.' || $2)::regclass, p)
               or case when p in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                       then has_any_column_privilege($1, ('public.' || $2)::regclass, p) else false end
            order by n`,
            [role, table],
          )
        ).rows.map((r) => r.p);
      expect(await held('anon')).toEqual([]);
      expect(await held('authenticated')).toEqual([]);
      expect(await held('crawl_worker')).toEqual([]);
      expect(await held('service_role')).toEqual(['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
    },
  );

  it('no client role reads the pipeline columns of checks or the schedule columns of sites', async () => {
    const { rows } = await db.query<{ col: string; role: string }>(
      `select c.col, r.role
         from (select 'checks' as t, unnest($1::text[]) as col
               union all select 'sites', unnest($2::text[])) c
         cross join (values ('anon'), ('authenticated'), ('crawl_worker')) r (role)
        where has_column_privilege(r.role, ('public.' || c.t)::regclass, c.col, 'SELECT')`,
      [CHECK_PIPELINE_COLUMNS, SITE_SCHEDULE_COLUMNS],
    );
    expect(rows).toEqual([]);
  });

  it('the six functions: service_role alone may execute them', async () => {
    const { rows } = await db.query<{
      name: string;
      definer: boolean;
      config: string[];
      owner: string;
      public_: boolean;
      anon: boolean;
      auth: boolean;
      sr: boolean;
    }>(
      `select p.proname as name, p.prosecdef as definer, p.proconfig as config,
              pg_get_userbyid(p.proowner) as owner,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       where a.grantee = 0) as public_,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
              has_function_privilege('service_role', p.oid, 'EXECUTE') as sr
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('check_failure_reasons', 'claim_check', 'fail_check', 'reap_stalled_checks',
                            'stage_check_rows', $1)
        order by 1`,
      [PERSIST_RPC],
    );
    const invoker = {
      definer: false,
      config: ['search_path=pg_catalog, public, pg_temp'],
      owner: 'postgres',
      public_: false,
      anon: false,
      auth: false,
      sr: true,
    };
    expect(rows).toEqual([
      { name: 'check_failure_reasons', ...invoker },
      { name: 'claim_check', ...invoker },
      { name: 'fail_check', ...invoker },
      {
        name: PERSIST_RPC,
        ...invoker,
        definer: true,
        config: ['search_path=pg_catalog, pg_temp'],
      },
      { name: 'reap_stalled_checks', ...invoker },
      { name: 'stage_check_rows', ...invoker },
    ]);
  });

  it('a client cannot call persist_built_check', async () => {
    for (const role of ['anon', 'authenticated'] as const)
      await expect(
        asRole(db, role, null, (tx) => tx.query(`select public.persist_built_check('{}'::jsonb)`)),
      ).rejects.toThrow(/permission denied for function persist_built_check/);
  });
});

describe('the catalog checks', () => {
  const files = readdirSync(CHECKS_DIR)
    .filter((f) => /^0\d-.*\.sql$/.test(f))
    .sort();

  it('are the eight on this branch', () => {
    expect(files.map((f) => f.slice(0, 2))).toEqual([
      '01',
      '02',
      '03',
      '04',
      '05',
      '06',
      '07',
      '08',
    ]);
  });

  it.each(files)('%s finds nothing once every migration has run', async (file) => {
    const { rows } = await db.query(readFileSync(join(CHECKS_DIR, file), 'utf8'));
    expect(rows).toEqual([]);
  });
});

// ─── The state functions ──────────────────────────────────────────────────────────────────────────

describe('claim_check', () => {
  let site: string;
  beforeEach(async () => {
    site = await aSite();
  });

  it('claims a queued check: running, started, with its progress, run and heartbeat', async () => {
    const check = await aQueuedCheck(site);
    expect(await claim(check, 'run-1')).toBe('claimed');
    const s = await stateOf(check);
    expect(s).toMatchObject({ status: 'running', progress: PROGRESS, inngest_run_id: 'run-1' });
    expect(s.started_at).not.toBeNull();
    expect(s.heartbeat_at).not.toBeNull();
  });

  it('claims again for the same run (a retried step), and changes nothing', async () => {
    const check = await aQueuedCheck(site);
    await claim(check, 'run-1');
    const once = await stateOf(check);
    expect(await claim(check, 'run-1', { steps: [] })).toBe('claimed');
    expect(await stateOf(check)).toEqual(once);
  });

  it('is gone for another run, a check that is not queued or running, and a check that does not exist', async () => {
    const running = await aQueuedCheck(site);
    await claim(running, 'run-1');
    expect(await claim(running, 'run-2')).toBe('gone');
    const failed = await aQueuedCheck(await aSite());
    await fail(failed, 'stalled');
    expect(await claim(failed, 'run-3')).toBe('gone');
    expect(await claim(randomUUID(), 'run-4')).toBe('gone');
    expect((await stateOf(running)).inngest_run_id).toBe('run-1');
  });

  it('answers site_busy while another check of the site runs, and claims once that one ends', async () => {
    const first = await aQueuedCheck(site);
    const second = await aQueuedCheck(site);
    expect(await claim(first, 'run-a')).toBe('claimed');
    expect(await claim(second, 'run-b')).toBe('site_busy');
    expect((await stateOf(second)).status).toBe('queued');
    await fail(first, 'stalled');
    expect(await claim(second, 'run-b')).toBe('claimed');
  });

  it('two claims at once for two checks of one site: one claimed, one site_busy', async () => {
    const [a, b] = [await aQueuedCheck(site), await aQueuedCheck(site)];
    const answers = await Promise.all([claim(a, 'run-a'), claim(b, 'run-b')]);
    expect(answers.sort()).toEqual(['claimed', 'site_busy']);
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.checks where site_id = $1 and status = 'running'`,
      [site],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('checks of two sites run at once', async () => {
    const other = await aSite();
    expect(await claim(await aQueuedCheck(site), 'run-a')).toBe('claimed');
    expect(await claim(await aQueuedCheck(other), 'run-b')).toBe('claimed');
  });

  it('a claim without progress is refused by checks_progress, and the check stays queued', async () => {
    const check = await aQueuedCheck(site);
    await expect(db.query(`select public.claim_check($1, 'run-1', null)`, [check])).rejects.toThrow(
      /checks_progress/,
    );
    expect((await stateOf(check)).status).toBe('queued');
  });
});

describe('fail_check', () => {
  it('fails a running check: finished, progress cleared, its posted batches released, its staging deleted', async () => {
    const check = await aQueuedCheck(await aSite());
    await claim(check, 'run-1');
    await aBatch(check, 0, 'done');
    await aBatch(check, 1, 'posted');
    await stage(check);
    expect(await fail(check, 'worker_unavailable')).toBe(true);
    const s = await stateOf(check);
    expect(s).toMatchObject({
      status: 'failed',
      failure_reason: 'worker_unavailable',
      progress: null,
    });
    expect(s.finished_at).not.toBeNull();
    expect(await batchStatuses(check)).toEqual(['done', 'released']);
    expect(await stagedChunks(check)).toBe(0);
  });

  it('fails a queued check, which then has a start time as the contract requires', async () => {
    const check = await aQueuedCheck(await aSite());
    expect(await fail(check, 'paused')).toBe(true);
    const s = await stateOf(check);
    expect(s.status).toBe('failed');
    expect(s.started_at).not.toBeNull();
  });

  it('finds the check by its run when no check id is given', async () => {
    const check = await aQueuedCheck(await aSite());
    await claim(check, 'run-cancelled');
    expect(await fail(null, 'canceled', 'run-cancelled')).toBe(true);
    expect((await stateOf(check)).failure_reason).toBe('canceled');
  });

  it('is true again, and writes nothing, for a retried call: the check already failed with this reason', async () => {
    const check = await aQueuedCheck(await aSite());
    await claim(check, 'run-retried');
    await aBatch(check, 0, 'posted');
    expect(await fail(check, 'worker_unavailable')).toBe(true);
    const ended = await stateOf(check);
    expect(await fail(check, 'worker_unavailable')).toBe(true);
    expect(await fail(null, 'worker_unavailable', 'run-retried')).toBe(true);
    expect(await stateOf(check)).toEqual(ended);
    expect(await batchStatuses(check)).toEqual(['released']);
  });

  it('is false, and writes nothing, for a check ended with another reason, an unknown one, or no id and no run', async () => {
    const check = await aQueuedCheck(await aSite());
    await fail(check, 'stalled');
    const ended = await stateOf(check);
    expect(await fail(check, 'paused')).toBe(false);
    expect(await fail(null, 'paused', 'run-never-seen')).toBe(false);
    expect(await stateOf(check)).toEqual(ended);
    expect(await fail(randomUUID(), 'paused')).toBe(false);
    expect(await fail(null, 'paused', null)).toBe(false);
    expect(await fail(null, 'paused', 'run-never-seen')).toBe(false);
  });
});

describe('the failure reasons', () => {
  it('check_failure_reasons() is the pipeline’s FAILURE_REASONS, in order', async () => {
    const { rows } = await db.query<{ r: string[] }>(`select public.check_failure_reasons() as r`);
    expect(rows[0]!.r).toEqual([...FAILURE_REASONS]);
  });

  it.each([...FAILURE_REASONS])('fail_check writes %s', async (reason) => {
    const check = await aQueuedCheck(await aSite());
    expect(await fail(check, reason)).toBe(true);
    expect((await stateOf(check)).failure_reason).toBe(reason);
  });

  it.each([['timeout'], ['Request timed out: https://example.test/secret'], [''], [null]])(
    'fail_check refuses %j, and writes nothing',
    async (reason) => {
      const check = await aQueuedCheck(await aSite());
      await claim(check, 'run-refused');
      const before = await stateOf(check);
      await expect(
        db.query(`select public.fail_check($1, $2, null)`, [check, reason]),
      ).rejects.toThrow(/fail_check: the reason is not one of check_failure_reasons\(\)/);
      expect(await stateOf(check)).toEqual(before);
    },
  );

  it('reap_stalled_checks refuses, and writes nothing, when a reason it writes is not in the list', async () => {
    const d = (await db.clone()) as PGlite;
    try {
      const site = randomUUID();
      await d.query(
        `insert into public.sites (id, account_id, host) values ($1, null, 'r.example')`,
        [site],
      );
      const check = randomUUID();
      await d.query(
        `insert into public.checks (id, site_id, status, trigger, grade_version, queued_at)
         values ($1, $2, 'queued', 'manual', '2.0.0', now() - interval '2 hours')`,
        [check, site],
      );
      const reap = () =>
        d.query(`select * from public.reap_stalled_checks(now() - interval '30 minutes')`);
      // A list holding one of the two reasons the reaper writes, then the other.
      for (const kept of ['stalled', 'not_started']) {
        await d.query(
          `create or replace function public.check_failure_reasons() returns text[] language sql
             immutable set search_path = pg_catalog, public, pg_temp
             as $$ select array['${kept}']::text[] $$`,
        );
        await expect(reap()).rejects.toThrow(
          /reap_stalled_checks: not_started and stalled are not both in check_failure_reasons\(\)/,
        );
        const { rows } = await d.query<{ status: string }>(
          `select status from public.checks where id = $1`,
          [check],
        );
        expect(rows[0]!.status).toBe('queued');
      }
    } finally {
      await d.close();
    }
  });
});

describe('reap_stalled_checks', () => {
  const reap = async (cutoffSql: string) =>
    (
      await db.query<{ check_id: string; site_id: string; reason: string }>(
        `select * from public.reap_stalled_checks(${cutoffSql})`,
      )
    ).rows;

  it('fails checks whose heartbeat, or queue time when they have none, is before the cutoff', async () => {
    const site = await aSite();
    const neverStarted = await aQueuedCheck(site, 45);
    const queuedFresh = await aQueuedCheck(await aSite(), 5);
    const running = await aQueuedCheck(await aSite());
    await claim(running, 'run-stalled');
    await db.query(
      `update public.checks set heartbeat_at = now() - interval '31 minutes' where id = $1`,
      [running],
    );
    await aBatch(running, 0, 'posted');
    await stage(running);
    const runningFresh = await aQueuedCheck(await aSite());
    await claim(runningFresh, 'run-alive');
    await stage(runningFresh);
    const reaped = await reap(`now() - interval '30 minutes'`);
    const mine = reaped.filter((r) =>
      [neverStarted, queuedFresh, running, runningFresh].includes(r.check_id),
    );
    expect(mine.sort((a, b) => a.reason.localeCompare(b.reason))).toEqual([
      { check_id: neverStarted, site_id: site, reason: 'not_started' },
      { check_id: running, site_id: expect.any(String), reason: 'stalled' },
    ]);
    expect((await stateOf(neverStarted)).started_at).not.toBeNull();
    expect((await stateOf(running)).status).toBe('failed');
    expect(await batchStatuses(running)).toEqual(['released']);
    expect(await stagedChunks(running)).toBe(0);
    expect((await stateOf(queuedFresh)).status).toBe('queued');
    expect((await stateOf(runningFresh)).status).toBe('running');
    expect(await stagedChunks(runningFresh)).toBe(1);
  });

  it('a heartbeat exactly at the cutoff is not stalled', async () => {
    const check = await aQueuedCheck(await aSite());
    await claim(check, 'run-edge');
    const { rows } = await db.query<{ hb: string }>(
      `select heartbeat_at::text as hb from public.checks where id = $1`,
      [check],
    );
    expect(await reap(`'${rows[0]!.hb}'::timestamptz`)).not.toContainEqual(
      expect.objectContaining({ check_id: check }),
    );
    expect(
      (await reap(`'${rows[0]!.hb}'::timestamptz + interval '1 microsecond'`)).map(
        (r) => r.check_id,
      ),
    ).toContain(check);
  });

  it('a reaped check is not reaped again', async () => {
    const check = await aQueuedCheck(await aSite(), 60);
    expect((await reap(`now() - interval '30 minutes'`)).map((r) => r.check_id)).toContain(check);
    expect((await reap(`now() - interval '30 minutes'`)).map((r) => r.check_id)).not.toContain(
      check,
    );
  });
});

// ─── Apply, re-apply, revert ──────────────────────────────────────────────────────────────────────

describe('migration 008 applies, re-applies and reverts', () => {
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

  it('the revert returns the catalog to the state before 008, twice, and 008 re-applies', async () => {
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
});
