/**
 * The SQL store on PGlite with every migration: the statements the pipeline's race-critical calls make
 * (claim, fail, reap) and the one-statement methods, against migration 008's columns and functions;
 * and the build and persist steps over it, for the check a built check names as its previous one.
 */
import type { PGlite } from '@electric-sql/pglite';
import { buildCheck, GRADE_VERSION } from '@crawlmouse/engine/v2/pipeline';
import type { BatchResult, CrawlPage } from '@crawlmouse/types/v2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CheckRequested } from '../../../../../inngest/check-events';
import { recordedBuild } from '../../../../../packages/engine/fixtures/v2/build/recorded';
import { applyAllMigrations, asRole, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { putJson } from './evidence';
import { pageVantage, persistBuiltCheck } from './persist';
import { reapStalled, type StepDeps } from './steps';
import { finishSteps } from './steps/finish';
import { pathOf } from './steps/stored';
import { memoryEvidenceStore } from './test-support/memory-evidence';
import { pglitePersistDb, seedRunning, seedRunningCheck } from './test-support/pglite';
import { sqlPipelineStore, type SqlDb } from './test-support/sql-store';

const NOW = Date.parse('2026-11-08T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const PROGRESS = {
  steps: [{ phase: 'robots_and_sitemap', state: 'now' }],
  pages_crawled: 0,
  pages_estimated: null,
  links_found: 0,
  elapsed_ms: 0,
  recent_fetches: [],
};

describe('sqlPipelineStore on PGlite (migration 008)', () => {
  let template: PGlite;
  // Closed when the file ends: a PGlite holds its memory outside the JS heap until then.
  afterAll(async () => {
    await template?.close();
  });

  beforeAll(async () => {
    template = await freshDb();
    await applyAllMigrations(template);
  }, 120_000);

  /** A fresh database, and the store over it as the service role, one transaction per call. */
  async function fresh() {
    const db = (await template.clone()) as PGlite;
    const sql: SqlDb = {
      query: (text, params) => asRole(db, 'service_role', null, (tx) => tx.query(text, params)),
    };
    return { db, store: sqlPipelineStore(sql) };
  }

  async function site(db: PGlite, host = 'example.com'): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.sites (host) values ($1) returning id`,
      [host],
    );
    return rows[0]!.id;
  }

  async function check(
    db: PGlite,
    siteId: string,
    s: { status: 'queued' | 'running'; heartbeat: string | null; queued?: string; run?: string },
  ): Promise<string> {
    const running = s.status === 'running';
    const { rows } = await db.query<{ id: string }>(
      `insert into public.checks
         (site_id, status, trigger, grade_version, queued_at, started_at, progress, inngest_run_id, heartbeat_at)
       values ($1, $2, 'manual', '2.0.0', $3, $4, $5::jsonb, $6, $7) returning id`,
      [
        siteId,
        s.status,
        s.queued ?? ago(60 * MIN),
        running ? ago(50 * MIN) : null,
        running ? JSON.stringify(PROGRESS) : null,
        s.run ?? null,
        s.heartbeat,
      ],
    );
    return rows[0]!.id;
  }

  const statusOf = async (db: PGlite, id: string) =>
    (
      await db.query<{ status: string; failure_reason: string | null }>(
        `select status, failure_reason from public.checks where id = $1`,
        [id],
      )
    ).rows[0]!;

  it('claims a queued check once, again for the same run, and not for another', async () => {
    const { db, store } = await fresh();
    const id = await check(db, await site(db), { status: 'queued', heartbeat: ago(0) });
    expect(await store.claim(id, 'run-1', PROGRESS as never)).toBe('claimed');
    expect(await store.claim(id, 'run-1', PROGRESS as never)).toBe('claimed');
    expect(await store.claim(id, 'run-2', PROGRESS as never)).toBe('gone');
    expect((await statusOf(db, id)).status).toBe('running');
    expect(await store.checkOfRun('run-1')).toEqual({ checkId: id, siteId: expect.any(String) });
  });

  it('reads the site a check belongs to', async () => {
    const { db, store } = await fresh();
    const s = await site(db);
    const id = await check(db, s, { status: 'queued', heartbeat: ago(0) });
    expect(await store.siteOf(id)).toBe(s);
    expect(await store.siteOf('c0000000-0000-4000-8000-00000000dead')).toBeNull();
  });

  it('answers site_busy while another check of the site runs', async () => {
    const { db, store } = await fresh();
    const s = await site(db);
    const a = await check(db, s, { status: 'queued', heartbeat: ago(0) });
    const b = await check(db, s, { status: 'queued', heartbeat: ago(0) });
    expect(await store.claim(a, 'run-a', PROGRESS as never)).toBe('claimed');
    expect(await store.claim(b, 'run-b', PROGRESS as never)).toBe('site_busy');
  });

  it('fails a check once, by its id or by its run', async () => {
    const { db, store } = await fresh();
    const s = await site(db);
    const a = await check(db, s, { status: 'queued', heartbeat: ago(0) });
    expect(await store.fail(a, 'paused', null)).toBe(true);
    expect(await store.fail(a, 'internal', null)).toBe(false);
    expect(await statusOf(db, a)).toEqual({ status: 'failed', failure_reason: 'paused' });
    const b = await check(db, s, { status: 'running', heartbeat: ago(0), run: 'run-b' });
    expect(await store.fail(null, 'canceled', 'run-b')).toBe(true);
    expect(await statusOf(db, b)).toEqual({ status: 'failed', failure_reason: 'canceled' });
  });

  it('reaps a heartbeat older than 30 minutes, not one 30:00 or 29:59 old (D13)', async () => {
    const { db, store } = await fresh();
    const young = await check(db, await site(db, 'a.test'), {
      status: 'running',
      heartbeat: ago(29 * MIN + 59_000),
      run: 'r1',
    });
    const edge = await check(db, await site(db, 'b.test'), {
      status: 'running',
      heartbeat: ago(30 * MIN),
      run: 'r2',
    });
    const old = await check(db, await site(db, 'c.test'), {
      status: 'running',
      heartbeat: ago(30 * MIN + 1_000),
      run: 'r3',
    });
    const never = await check(db, await site(db, 'd.test'), {
      status: 'queued',
      heartbeat: null,
      queued: ago(31 * MIN),
    });
    await store.upsertBatch({
      check_id: old,
      batch: 1,
      kind: 'crawl',
      nonce: 'n'.repeat(24),
      posted_at: ago(40 * MIN),
      summary: { urls: 1, max_seconds: 60 },
    });
    const reaped = await reapStalled(store, () => NOW);
    expect(reaped.map((r) => [r.checkId, r.reason]).sort()).toEqual(
      [
        [old, 'stalled'],
        [never, 'not_started'],
      ].sort(),
    );
    expect((await statusOf(db, young)).status).toBe('running');
    expect((await statusOf(db, edge)).status).toBe('running');
    expect(await statusOf(db, old)).toEqual({ status: 'failed', failure_reason: 'stalled' });
    expect((await store.batch(old, 1))!.status).toBe('released');
  });

  it('upserts a batch row over an earlier attempt, and ends it only while posted', async () => {
    const { db, store } = await fresh();
    const id = await check(db, await site(db), { status: 'running', heartbeat: ago(0), run: 'r' });
    const posted = { check_id: id, batch: 1, kind: 'crawl' as const, posted_at: ago(0) };
    await store.upsertBatch({
      ...posted,
      nonce: 'a'.repeat(24),
      summary: { urls: 3, max_seconds: 90 },
    });
    await store.upsertBatch({
      ...posted,
      nonce: 'b'.repeat(24),
      summary: { urls: 3, max_seconds: 80 },
    });
    expect(await store.batches(id)).toHaveLength(1);
    expect(await store.batch(id, 1)).toMatchObject({ nonce: 'b'.repeat(24), status: 'posted' });
    await store.endBatch(id, 1, {
      status: 'done',
      finished_at: ago(0),
      summary: { pages: 3 },
      result_path: 'anon/x/y/batch-1.json.gz',
    });
    await store.endBatch(id, 1, { status: 'failed', finished_at: ago(0) });
    expect(await store.batch(id, 1)).toMatchObject({
      status: 'done',
      summary: { pages: 3 },
      result_path: 'anon/x/y/batch-1.json.gz',
    });
    // A done batch is not posted again (correctness 3): its stored result stays where its row says.
    await expect(
      store.upsertBatch({
        ...posted,
        nonce: 'c'.repeat(24),
        summary: { urls: 3, max_seconds: 70 },
      }),
    ).rejects.toThrow('is done; it is not posted again');
    expect(await store.batch(id, 1)).toMatchObject({
      status: 'done',
      nonce: 'b'.repeat(24),
      result_path: 'anon/x/y/batch-1.json.gz',
    });
  });

  it('inserts a queued check once by id, and reads the request site', async () => {
    const { db, store } = await fresh();
    const s = await site(db);
    const row = {
      id: '0b6a5a52-90b1-8c1e-9c56-2d0e3a7f6b11',
      site_id: s,
      trigger: 'manual' as const,
      grade_version: '2.0.0',
      queued_at: ago(0),
      heartbeat_at: ago(0),
      expires_at: null,
    };
    expect(await store.insertQueued(row)).toBe(true);
    expect(await store.insertQueued(row)).toBe(false);
    expect(await store.requestSite(s)).toEqual({
      id: s,
      account_id: null,
      host: 'example.com',
      next_check_at: null,
    });
  });

  it('writes progress and the heartbeat on a running check only', async () => {
    const { db, store } = await fresh();
    const s = await site(db);
    const queued = await check(db, s, { status: 'queued', heartbeat: ago(10 * MIN) });
    await store.progress(queued, PROGRESS as never, ago(0));
    const { rows } = await db.query<{ progress: unknown }>(
      `select progress from public.checks where id = $1`,
      [queued],
    );
    expect(rows[0]!.progress).toBeNull();
  });

  /**
   * A copy of check `from` under `id`, queued, started (when it was queued, unless given) and finished
   * at the times given, graded under `grade_version` when given: every column the table does not
   * generate, so the copy is a graded check as the persisted one is.
   */
  async function copyCheck(
    db: PGlite,
    from: string,
    id: string,
    at: { queued: string; started?: string; finished: string; grade_version?: string },
  ): Promise<void> {
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'checks' and is_generated = 'NEVER'
        order by ordinal_position`,
    );
    const set: Record<string, string> = {
      id: '$2::uuid',
      queued_at: '$3::timestamptz',
      started_at: 'coalesce($5::timestamptz, $3::timestamptz)',
      finished_at: '$4::timestamptz',
      grade_version: 'coalesce($6::text, grade_version)',
    };
    const cols = rows.map((r) => r.column_name);
    await db.query(
      `insert into public.checks (${cols.join(', ')})
       select ${cols.map((c) => set[c] ?? c).join(', ')} from public.checks where id = $1`,
      [from, id, at.queued, at.finished, at.started ?? null, at.grade_version ?? null],
    );
  }

  /** The recorded check, built and persisted as the site's first: what a later check is diffed with. */
  async function persistRecorded(db: PGlite) {
    const input = recordedBuild();
    const built = buildCheck(input);
    await seedRunningCheck(db, input.site, input.check);
    const crawl = (input.batches as BatchResult[]).flatMap((b): CrawlPage[] =>
      b.kind === 'crawl' ? b.pages : [],
    );
    await persistBuiltCheck(pglitePersistDb(db), {
      built,
      vantage: pageVantage(crawl),
      map_path: null,
      read: [],
    });
    return { input, built };
  }

  const shift = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

  it('takes the diff baseline as the site’s check that finished last, in whatever order the checks were queued (correctness 4)', async () => {
    const { db, store } = await fresh();
    const { built } = await persistRecorded(db);
    const newer = built.check;
    const H = 60 * MIN;
    const at = shift;
    // `before` was queued and finished before `newer`; `after` was queued after `newer` and finished
    // before it; `older` was queued before both and claims only now, after `newer` has finished.
    const before = 'b0000000-0000-4000-8000-0000000000f1';
    await copyCheck(db, newer.id, before, {
      queued: at(newer.queued_at, -2 * H),
      finished: at(newer.finished_at!, -H),
    });
    const after = 'b0000000-0000-4000-8000-0000000000f3';
    await copyCheck(db, newer.id, after, {
      queued: at(newer.queued_at, MIN),
      finished: at(newer.finished_at!, -MIN),
    });
    const older = await check(db, newer.site_id, {
      status: 'running',
      heartbeat: ago(0),
      queued: at(newer.queued_at, -H),
      run: 'run-older',
    });
    // By queue order the graded check last queued is `after`; by finish order it is `newer`.
    expect((await store.previousGraded(newer.site_id, older))?.check.id).toBe(newer.id);
    expect((await store.previousGraded(newer.site_id, newer.id))?.check.id).toBe(after);
    expect((await store.previousGraded(newer.site_id, after))?.check.id).toBe(newer.id);
  }, 60_000);

  it('writes the diff baseline as the check’s previous_check_id, on its row and on its changes (correctness 1)', async () => {
    const { db, store } = await fresh();
    const { input, built } = await persistRecorded(db);
    const first = built.check;
    const siteId = first.site_id;
    const H = 60 * MIN;
    // `baseline` was queued before the first check and ran after it, under an earlier grading, so it
    // is the check that finished last and the diff writes one baseline row about it. `failed` was
    // queued after both: the latest other check by queue time, and not a graded one.
    const baseline = 'b0000000-0000-4000-8000-0000000000f2';
    await copyCheck(db, first.id, baseline, {
      queued: shift(first.queued_at, -H),
      started: shift(first.finished_at!, 10 * MIN),
      finished: shift(first.finished_at!, H),
      grade_version: '1.0.0',
    });
    const failed = await check(db, siteId, {
      status: 'queued',
      heartbeat: null,
      queued: shift(first.queued_at, 2 * H),
    });
    expect(await store.fail(failed, 'internal', null)).toBe(true);
    const current = 'b0000000-0000-4000-8000-0000000000c3';
    await seedRunning(db, {
      id: current,
      site_id: siteId,
      trigger: 'manual',
      grade_version: GRADE_VERSION,
      queued_at: shift(first.queued_at, 3 * H),
      started_at: shift(first.queued_at, 3 * H),
      expires_at: null,
    });
    // The vector the two rules this replaces differ on: by queue time, any status, the previous check
    // is `failed`; by queue time among graded checks it is the first check; by finish it is `baseline`.
    const latestBy = async (order: string, graded: boolean) =>
      (
        await db.query<{ id: string }>(
          `select id from public.checks where site_id = $1 and id <> $2
              ${graded ? `and status in ('finished', 'partial')` : ''}
            order by ${order} desc limit 1`,
          [siteId, current],
        )
      ).rows[0]!.id;
    expect(await latestBy('queued_at', false)).toBe(failed);
    expect(await latestBy('queued_at', true)).toBe(first.id);
    expect(await latestBy('finished_at', true)).toBe(baseline);

    // The check's evidence as its batches left it: the recorded crawl, renamed to this check. The
    // access batches are left out: their tests' ids are the first check's, which the table holds.
    const event: CheckRequested = {
      checkId: current,
      siteId,
      accountId: null,
      host: input.site.host,
      homepageUrl: input.homepage_url,
      trigger: 'manual',
      pageCap: input.check.page_cap,
    };
    const evidence = memoryEvidenceStore();
    await putJson(evidence, pathOf(event, 'seeds'), input.seeds);
    await putJson(evidence, pathOf(event, 'render'), null);
    const batches = (
      JSON.parse(JSON.stringify(input.batches).replaceAll(first.id, current)) as BatchResult[]
    ).filter((b) => b.kind === 'crawl');
    for (const [k, b] of batches.entries()) {
      const n = k + 1;
      const path = pathOf(event, `batch-${n}`);
      await putJson(evidence, path, b);
      const posted = shift(first.queued_at, 3 * H + n * MIN);
      await store.upsertBatch({
        check_id: current,
        batch: n,
        kind: b.kind,
        nonce: 'n'.repeat(24),
        posted_at: posted,
        summary: { urls: 1, max_seconds: 60 },
      });
      await store.endBatch(current, n, {
        status: 'done',
        finished_at: posted,
        summary: {},
        result_path: path,
      });
    }
    const steps = finishSteps({
      store,
      evidence,
      persistDb: pglitePersistDb(db),
      now: () => Date.parse(shift(first.queued_at, 4 * H)),
      env: { VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40) },
    } as unknown as StepDeps);
    const started = Date.parse(shift(first.queued_at, 3 * H));
    await steps.build(event, {
      startedAt: started,
      crawlFrom: started,
      pagesCrawled: 0,
      linksFound: 0,
      release: null,
    });
    expect(await steps.persist(event)).toEqual({ written: true });

    const row = await db.query<{ previous_check_id: string | null }>(
      `select previous_check_id from public.checks where id = $1`,
      [current],
    );
    const changes = await db.query<{ kind: string; previous_check_id: string | null }>(
      `select kind, previous_check_id from public.changes where check_id = $1`,
      [current],
    );
    expect(row.rows).toEqual([{ previous_check_id: baseline }]);
    expect(changes.rows).toEqual([{ kind: 'baseline', previous_check_id: baseline }]);
  }, 60_000);
});
