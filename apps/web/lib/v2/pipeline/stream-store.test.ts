import type { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { anonymousCheck, doorDb } from '../../../__tests__/v2/_lib/door-pglite';
import { factsOf, storedCrawlBatches } from './stream';
import { WAITING, sqlStreamStore, supabaseStreamStore } from './stream-store';
import { progressOf } from './steps/progress';
import { sqlPipelineStore } from './test-support/sql-store';

let db: PGlite;
beforeAll(async () => {
  db = await doorDb();
}, 120_000);

const notifyEmail = async (checkId: string) =>
  (
    await db.query<{ notify_email: string | null }>(
      `select notify_email from public.checks where id = $1`,
      [checkId],
    )
  ).rows[0]!.notify_email;

describe('sqlStreamStore, on the migrations', () => {
  it('reads a check with its site’s owner and its batch rows in batch order', async () => {
    const { siteId, checkId } = await anonymousCheck(
      db,
      'snapshot.example',
      new Date('2026-12-01'),
    );
    const stream = sqlStreamStore(db);
    const pipeline = sqlPipelineStore(db);
    expect(await stream.snapshot(checkId)).toMatchObject({
      siteId,
      accountId: null,
      siteRemoved: false,
      status: 'queued',
      progress: null,
      startedAt: null,
      finishedAt: null,
      batches: [],
    });

    await pipeline.claim(
      checkId,
      'run-1',
      progressOf('crawl', { pagesCrawled: 7, linksFound: 40 }, 0),
    );
    const post = (batch: number, kind: 'crawl' | 'access') =>
      pipeline.upsertBatch({
        check_id: checkId,
        batch,
        kind,
        nonce: `nonce-${String(batch).padStart(16, '0')}`,
        posted_at: '2026-11-10T10:00:00Z',
        summary: { urls: 5, max_seconds: 60 },
      });
    const done = (batch: number, pages: number, links: number) =>
      pipeline.endBatch(checkId, batch, {
        status: 'done',
        finished_at: '2026-11-10T10:01:00Z',
        summary: { pages, links, access_tests: 0, partial: false, release: null },
        result_path: `anon/${siteId}/${checkId}/batch-${batch}.json.gz`,
      });
    await post(2, 'crawl');
    await post(1, 'crawl');
    await post(3, 'access');
    await done(1, 4, 30);
    await done(3, 0, 0);
    const running = (await stream.snapshot(checkId))!;
    expect(running.status).toBe('running');
    expect(running.progress).toMatchObject({ pages_crawled: 7, links_found: 40 });
    expect(running.progress!.steps.find((s) => s.state === 'now')).toEqual({
      phase: 'crawl',
      state: 'now',
    });
    expect(running.batches).toEqual([
      {
        batch: 1,
        kind: 'crawl',
        status: 'done',
        resultPath: `anon/${siteId}/${checkId}/batch-1.json.gz`,
        pages: 4,
        links: 30,
      },
      { batch: 2, kind: 'crawl', status: 'posted', resultPath: null, pages: 0, links: 0 },
      {
        batch: 3,
        kind: 'access',
        status: 'done',
        resultPath: `anon/${siteId}/${checkId}/batch-3.json.gz`,
        pages: 0,
        links: 0,
      },
    ]);
    // The stream drains crawl batches whose result is stored: 1 here, not the posted 2 or the access 3.
    expect(storedCrawlBatches(running).map((b) => b.batch)).toEqual([1]);
    expect(factsOf(running, Date.parse(running.startedAt!) + 5000)).toMatchObject({
      counts: { pages_crawled: 7, links_found: 40 },
      elapsedMs: 5000,
    });

    // Ended, the row holds no progress: the counts are the read batches' own.
    await pipeline.fail(checkId, 'canceled', null);
    const ended = (await stream.snapshot(checkId))!;
    expect(ended.progress).toBeNull();
    expect(factsOf(ended, 0)).toMatchObject({
      status: 'failed',
      counts: { pages_crawled: 4, links_found: 30 },
      elapsedMs: Date.parse(ended.finishedAt!) - Date.parse(ended.startedAt!),
    });
    expect(await stream.snapshot('00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('stores the notify address only while the check waits', async () => {
    const stream = sqlStreamStore(db);
    const pipeline = sqlPipelineStore(db);
    const waiting = await anonymousCheck(db, 'waiting.example', null);
    expect(await stream.setNotifyEmail(waiting.checkId, 'a@example.com')).toBe(true);
    expect(await notifyEmail(waiting.checkId)).toBe('a@example.com');

    const ended = await anonymousCheck(db, 'ended.example', null);
    await pipeline.fail(ended.checkId, 'canceled', null);
    expect(await stream.setNotifyEmail(ended.checkId, 'a@example.com')).toBe(false);
    expect(await notifyEmail(ended.checkId)).toBeNull();
    expect(await stream.setNotifyEmail('00000000-0000-4000-8000-000000000000', 'a@b.co')).toBe(
      false,
    );
    expect(WAITING).toEqual(['queued', 'running', 'deferred']);
  });

  it('gives no score for a check with no grades', async () => {
    const { checkId } = await anonymousCheck(db, 'ungraded.example', null);
    expect(await sqlStreamStore(db).scores(checkId)).toEqual({
      seo: null,
      aiReadability: null,
      withheld: false,
    });
  });
});

/** A supabase-js client that records each query's calls and answers with `data`. */
function recordingClient(data: Record<string, unknown>) {
  const queries: { table: string; calls: [string, ...unknown[]][] }[] = [];
  const client = {
    from(table: string) {
      const calls: [string, ...unknown[]][] = [];
      queries.push({ table, calls });
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'update', 'eq', 'in', 'order', 'maybeSingle']) {
        builder[method] = (...args: unknown[]) => {
          calls.push([method, ...args]);
          return builder;
        };
      }
      const key = () => `${table}:${calls[0]![0]}`;
      builder.then = (resolve: (v: unknown) => void) =>
        resolve({ data: data[key()] ?? null, error: null });
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, queries };
}

describe('supabaseStreamStore', () => {
  it('writes the notify address under the status guard, and reports whether a row took it', async () => {
    const took = recordingClient({ 'checks:update': [{ id: 'c' }] });
    expect(await supabaseStreamStore(took.client).setNotifyEmail('c', 'a@example.com')).toBe(true);
    expect(took.queries).toEqual([
      {
        table: 'checks',
        calls: [
          ['update', { notify_email: 'a@example.com' }],
          ['eq', 'id', 'c'],
          ['in', 'status', ['queued', 'running', 'deferred']],
          ['select', 'id'],
        ],
      },
    ]);
    const none = recordingClient({ 'checks:update': [] });
    expect(await supabaseStreamStore(none.client).setNotifyEmail('c', 'a@example.com')).toBe(false);
  });

  it('reads one check by its id, then that check’s batch rows in batch order, and does not select the notify address', async () => {
    const { client, queries } = recordingClient({
      'checks:select': {
        site_id: 's',
        status: 'running',
        progress: { steps: [{ phase: 'crawl', state: 'now' }], pages_crawled: 3, links_found: 9 },
        started_at: '2026-11-10T10:00:00+00:00',
        finished_at: null,
        expires_at: null,
        sites: { account_id: 'acct', removed_at: null },
      },
      'crawl_batches:select': [
        {
          batch: 1,
          kind: 'crawl',
          status: 'done',
          result_path: 'p',
          summary: { pages: 3, links: 9 },
        },
      ],
    });
    const snapshot = await supabaseStreamStore(client).snapshot('c');
    expect(snapshot).toEqual({
      siteId: 's',
      accountId: 'acct',
      siteRemoved: false,
      status: 'running',
      progress: { steps: [{ phase: 'crawl', state: 'now' }], pages_crawled: 3, links_found: 9 },
      startedAt: '2026-11-10T10:00:00+00:00',
      finishedAt: null,
      expiresAt: null,
      batches: [{ batch: 1, kind: 'crawl', status: 'done', resultPath: 'p', pages: 3, links: 9 }],
    });
    // Each call of both requests: without `eq('check_id', …)` the second would read the batch rows
    // of each check there is.
    expect(queries).toEqual([
      {
        table: 'checks',
        calls: [
          [
            'select',
            'site_id, status, progress, started_at, finished_at, expires_at, sites(account_id, removed_at)',
          ],
          ['eq', 'id', 'c'],
          ['maybeSingle'],
        ],
      },
      {
        table: 'crawl_batches',
        calls: [
          ['select', 'batch, kind, status, result_path, summary'],
          ['eq', 'check_id', 'c'],
          ['order', 'batch'],
        ],
      },
    ]);
    expect(JSON.stringify(queries)).not.toContain('notify_email');
    expect(JSON.stringify(queries)).not.toContain('*');
  });

  it('the `sites(…)` embed has one foreign key to follow, from checks.site_id', async () => {
    // The recording client answers canned rows, so the embed meets no schema above. PostgREST
    // resolves it by the foreign key between the two tables, and refuses when there are two.
    const { rows } = await db.query<{ columns: string }>(
      `select (select string_agg(a.attname, ',') from pg_attribute a
                where a.attrelid = c.conrelid and a.attnum = any(c.conkey)) as columns
         from pg_constraint c
        where c.contype = 'f' and c.conrelid = 'public.checks'::regclass
          and c.confrelid = 'public.sites'::regclass`,
    );
    expect(rows).toEqual([{ columns: 'site_id' }]);
  });

  it('reads an ended check’s two scores from that check’s row', async () => {
    const { client, queries } = recordingClient({
      'checks:select': {
        technical_seo: { score: 71.5 },
        ai_readability: { withheld: false, total: 64 },
      },
    });
    expect(await supabaseStreamStore(client).scores('c')).toEqual({
      seo: 71.5,
      aiReadability: 64,
      withheld: false,
    });
    expect(queries).toEqual([
      {
        table: 'checks',
        calls: [['select', 'technical_seo, ai_readability'], ['eq', 'id', 'c'], ['maybeSingle']],
      },
    ]);
  });

  it('answers null for a check that is not there, and throws on a database error', async () => {
    expect(await supabaseStreamStore(recordingClient({}).client).snapshot('c')).toBeNull();
    const failing = {
      from: () => {
        const b: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'maybeSingle']) b[m] = () => b;
        b.then = (resolve: (v: unknown) => void) =>
          resolve({ data: null, error: { message: 'boom' } });
        return b;
      },
    } as unknown as SupabaseClient;
    await expect(supabaseStreamStore(failing).snapshot('c')).rejects.toThrow(
      'stream store: check: boom',
    );
  });
});
