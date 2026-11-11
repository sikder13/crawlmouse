import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { buildCheck, type BuiltCheck } from '@crawlmouse/engine/v2/pipeline';
import type { BatchResult, CrawlPage } from '@crawlmouse/types/v2';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { recordedBuild } from '../../../../../packages/engine/fixtures/v2/build/recorded';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { personalAccount, signUp } from '../../../__tests__/helpers/v2-check-tables';
import { loadCheck, supabaseCheckReader } from './load';
import { pageVantage, persistBuiltCheck } from './persist';
import { pgliteCheckReader, pglitePersistDb, seedRunningCheck } from './test-support/pglite';
import type { CheckReader, ReadTable } from './types';

/**
 * loadCheck reads a persisted check back as a CheckDataset. That it reads back exactly what the
 * engine built is round-trip.test.ts; this file holds what it refuses, what it reads beyond the
 * check's own rows, and how supabaseCheckReader pages through PostgREST.
 */

let built: BuiltCheck;
let base: PGlite;
let db: PGlite;
const crawlRows = (batches: readonly unknown[]): CrawlPage[] =>
  (batches as BatchResult[]).flatMap((b) => (b.kind === 'crawl' ? b.pages : []));
const vantage = () => pageVantage(crawlRows(recordedBuild().batches));
const CHECK = () => built.check.id;

beforeAll(async () => {
  built = buildCheck(recordedBuild());
  base = await freshDb();
  await applyAllMigrations(base);
}, 120_000);

/** Persists the built check, for a site kept by `accountId` when one is given. */
async function persisted(accountId: string | null = null): Promise<void> {
  const input = recordedBuild();
  await seedRunningCheck(db, { ...input.site, account_id: accountId }, input.check);
  await persistBuiltCheck(pglitePersistDb(db), {
    built,
    vantage: vantage(),
    map_path: null,
    read: [],
  });
}

/** A reader that records which tables it was asked for. */
function recordingReader(inner: CheckReader) {
  const asked: ReadTable[] = [];
  const read: CheckReader = {
    rows: (table, column, values) => {
      asked.push(table);
      return inner.rows(table, column, values);
    },
  };
  return { read, asked };
}

describe('loadCheck on the database', () => {
  beforeEach(async () => {
    db = (await base.clone()) as PGlite;
  });
  afterEach(async () => {
    await db.close();
  });

  it('reads a persisted check as a measured dataset, every collection the check’s', async () => {
    await persisted();
    const d = await loadCheck(pgliteCheckReader(db), CHECK());
    expect(d.provenance).toBe('measured');
    expect(d.as_of).toBe(built.check.finished_at);
    expect(d.description).toContain(built.check.id);
    expect(d.checks.map((c) => c.id)).toEqual([CHECK()]);
    expect(d.page_results).toHaveLength(built.page_results.length);
    expect(d.link_edges).toHaveLength(built.link_edges.length);
    expect(d.access_tests).toHaveLength(built.access_tests.length);
    expect(d.fixes).toHaveLength(built.fixes.length);
    expect(d.changes).toHaveLength(built.changes.length);
    expect(d.lineages.map((l) => l.id)).toEqual([
      built.lineages.grading.id,
      built.lineages.fetching.id,
    ]);
  });

  it('refuses a check that does not exist', async () => {
    await expect(loadCheck(pgliteCheckReader(db), randomUUID())).rejects.toThrow(/not found/);
  });

  it.each([
    ['queued', `status = 'queued', started_at = null, progress = null`],
    ['running', `status = 'running'`],
    [
      'failed',
      `status = 'failed', failure_reason = 'stalled', finished_at = now(), progress = null`,
    ],
    [
      'deferred',
      `status = 'deferred', started_at = null, progress = null, deferred_until = now() + interval '1 hour'`,
    ],
  ])('refuses a %s check: only a finished or partial check is read back', async (status, set) => {
    const input = recordedBuild();
    await seedRunningCheck(db, input.site, input.check);
    await db.query(`update public.checks set ${set} where id = $1`, [CHECK()]);
    await expect(loadCheck(pgliteCheckReader(db), CHECK())).rejects.toThrow(
      new RegExp(`is ${status}`),
    );
  });

  it('a kept site reads back with no accounts or seats, by design: the reader is never asked for them', async () => {
    const user = await signUp(db, `load-${randomUUID()}@example.com`);
    const { accountId } = await personalAccount(db, user);
    await persisted(accountId);
    const { read, asked } = recordingReader(pgliteCheckReader(db));
    const d = await loadCheck(read, CHECK());
    expect(d.sites[0]!.account_id).toBe(accountId);
    expect(d.accounts).toEqual([]);
    expect(d.seats).toEqual([]);
    expect(asked).not.toContain('accounts');
    expect(asked).not.toContain('seats');
  });

  it('reads the site’s client report from report_schedules', async () => {
    const user = await signUp(db, `report-${randomUUID()}@example.com`);
    const { accountId } = await personalAccount(db, user);
    await persisted(accountId);
    const report = {
      cadence: 'monthly',
      iso_weekday: 1,
      time_local: '08:00',
      timezone: 'Europe/London',
      send_when_unchanged: false,
      open_tracking: true,
      page_slug: 'built',
      paused_by_recipient_at: null,
    };
    await db.query(
      `insert into public.report_schedules (site_id, account_id, cadence, iso_weekday, time_local,
         timezone, send_when_unchanged, open_tracking, page_slug)
       values ($1, $2, 'monthly', 1, '08:00', 'Europe/London', false, true, 'built')`,
      [built.check.site_id, accountId],
    );
    const d = await loadCheck(pgliteCheckReader(db), CHECK());
    expect(d.sites[0]!.client_report).toEqual(report);
  });

  it('a fix first seen by a later check of the site is not this check’s', async () => {
    await persisted();
    const later = randomUUID();
    await db.query(
      `insert into public.checks (id, site_id, status, trigger, grade_version, queued_at, started_at,
         finished_at, failure_reason)
       values ($1, $2, 'failed', 'manual', '2.0.0', $3::timestamptz + interval '1 day',
               $3::timestamptz + interval '1 day', $3::timestamptz + interval '1 day', 'stalled')`,
      [later, built.check.site_id, built.check.queued_at],
    );
    const theirs = built.fixes[0]!;
    await db.query(
      `insert into public.site_fixes (id, site_id, fingerprint, number, type, section, title,
         recommendation_class, status, last_state, last_measured_check_id, first_seen_check_id,
         confidence, affected_pages, rank, effect)
       values ($1, $2, 'ffffffffffffffff', 99, $3, $4, 'later', $5, 'open', 'detected', $6, $6,
               'confirmed', 1, 99, $7::jsonb)`,
      [
        randomUUID(),
        built.check.site_id,
        theirs.type,
        theirs.section,
        theirs.recommendation_class,
        later,
        JSON.stringify(theirs.effect),
      ],
    );
    const d = await loadCheck(pgliteCheckReader(db), CHECK());
    expect(d.fixes.map((f) => f.number)).toEqual(built.fixes.map((f) => f.number));
  });
});

// ─── supabaseCheckReader ──────────────────────────────────────────────────────────────────────────

interface Call {
  table: string;
  in?: [string, readonly string[]];
  order: string[];
  range?: [number, number];
}

/** A supabase-js stand-in: `pages[table]` answers each successive range request of that table. */
function fakeClient(pages: Record<string, unknown[][]>, error: unknown = null) {
  const calls: Call[] = [];
  const served: Record<string, number> = {};
  const sb = {
    from(table: string) {
      const call: Call = { table, order: [] };
      calls.push(call);
      const query = {
        select: () => query,
        in: (column: string, values: readonly string[]) => {
          call.in = [column, values];
          return query;
        },
        order: (column: string) => {
          call.order.push(column);
          return query;
        },
        range: async (from: number, to: number) => {
          call.range = [from, to];
          if (error) return { data: null, error };
          const k = (served[table] = (served[table] ?? 0) + 1) - 1;
          return { data: pages[table]?.[k] ?? [], error: null };
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { sb, calls };
}

describe('supabaseCheckReader', () => {
  const rows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ i: from + i }));

  it('reads page after page until one comes back empty, so a row cap cannot cut a list short', async () => {
    // A server whose cap (500) is below the page asked for still returns every row.
    const { sb, calls } = fakeClient({
      link_edges: [rows(500), rows(500, 500), rows(120, 1000), []],
    });
    const got = await supabaseCheckReader(sb).rows('link_edges', 'check_id', ['c']);
    expect(got).toEqual(rows(1120));
    expect(calls.map((c) => c.range)).toEqual([
      [0, 999],
      [500, 1499],
      [1000, 1999],
      [1120, 2119],
    ]);
  });

  it('orders each page by the table’s primary key, so pages do not overlap', async () => {
    const { sb, calls } = fakeClient({ access_tests: [rows(3), []] });
    await supabaseCheckReader(sb).rows('access_tests', 'check_id', ['c']);
    expect(calls[0]!.order).toEqual(['id', 'check_month']);
    expect(calls[0]!.in).toEqual(['check_id', ['c']]);
  });

  it('asks for at most 100 values at a time, and joins the answers', async () => {
    const ids = Array.from({ length: 230 }, (_, i) => `f${i}`);
    const { sb, calls } = fakeClient({
      fix_events: [rows(2), [], rows(1, 2), [], rows(1, 3), []],
    });
    const got = await supabaseCheckReader(sb).rows('fix_events', 'fix_id', ids);
    expect(got).toEqual(rows(4));
    expect(calls.filter((c) => c.range![0] === 0).map((c) => c.in![1].length)).toEqual([
      100, 100, 30,
    ]);
  });

  it('throws on an error, naming the table, code and message', async () => {
    const { sb } = fakeClient({}, { code: '42501', message: 'permission denied for table checks' });
    await expect(supabaseCheckReader(sb).rows('checks', 'id', ['c'])).rejects.toThrow(
      /checks.*42501.*permission denied/,
    );
  });

  it('asks nothing for no values', async () => {
    const { sb, calls } = fakeClient({});
    expect(await supabaseCheckReader(sb).rows('fix_events', 'fix_id', [])).toEqual([]);
    expect(calls).toEqual([]);
  });
});
