/**
 * The SQL store on PGlite with every migration: the statements the pipeline's race-critical calls make
 * (claim, fail, reap) and the one-statement methods, against migration 008's columns and functions.
 *
 * Migration 008 is workstream A's. Until `20261109000001_v2_008_pipeline.sql` is in
 * infra/supabase/migrations these tests are skipped, and the sentinel test below says so in the run.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  applyAllMigrations,
  asRole,
  freshDb,
  migrationFiles,
} from '../../../__tests__/helpers/pglite-migrations';
import { reapStalled } from './steps';
import { sqlPipelineStore, type SqlDb } from './test-support/sql-store';

const HAS_008 = migrationFiles().some((f) => f.startsWith('20261109000001_v2_008_pipeline'));

it.runIf(!HAS_008)(
  'waits for migration 008: the PGlite store tests in this file run once it is in the tree',
  () => {
    expect(HAS_008).toBe(false);
  },
);

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

describe.runIf(HAS_008)('sqlPipelineStore on PGlite (migration 008)', () => {
  let template: PGlite;
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

  it('reads the previous check as the latest other one queued no later', async () => {
    const { db, store } = await fresh();
    const s = await site(db);
    const first = await check(db, s, { status: 'queued', heartbeat: null, queued: ago(30 * MIN) });
    const second = await check(db, s, { status: 'queued', heartbeat: null, queued: ago(20 * MIN) });
    const later = await check(db, s, { status: 'queued', heartbeat: null, queued: ago(5 * MIN) });
    expect(await store.previousCheckId(s, second, ago(20 * MIN))).toBe(first);
    expect(await store.previousCheckId(s, later, ago(5 * MIN))).toBe(second);
    expect(await store.previousCheckId(s, first, ago(30 * MIN))).toBeNull();
  });
});
