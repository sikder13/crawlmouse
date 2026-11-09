import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { buildCheck, type BuiltCheck } from '@crawlmouse/engine/v2/pipeline';
import type { BatchResult, CrawlPage, UsageEvent } from '@crawlmouse/types/v2';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { recordedBuild } from '../../../../../packages/engine/fixtures/v2/build/recorded';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { personalAccount, signUp } from '../../../__tests__/helpers/v2-check-tables';
import {
  CHUNK_BYTES,
  chunked,
  pageVantage,
  persistBuiltCheck,
  persistCalls,
  supabasePersistDb,
} from './persist';
import { pglitePersistDb, seedRunningCheck } from './test-support/pglite';
import type { PageVantage, PersistDb, PersistInput } from './types';

/**
 * The one writer (D5): persistBuiltCheck parses every row before any call, stages the bulk rows in
 * chunks (stage_check_rows), and persist_built_check (migration 008) writes the check whole or
 * refuses. The check is the engine's own build of the
 * recorded site (packages/engine/fixtures/v2/build), so the rows are what the pipeline will send.
 * Reading a persisted check back, idempotency and atomicity are round-trip.test.ts; a site's second
 * check, persisted over its first, is recheck.test.ts.
 */

const crawlRows = (batches: readonly unknown[]): CrawlPage[] =>
  (batches as BatchResult[]).flatMap((b) => (b.kind === 'crawl' ? b.pages : []));

let built: BuiltCheck;
let vantage: Map<string, PageVantage>;
let base: PGlite;
beforeAll(async () => {
  const input = recordedBuild();
  built = buildCheck(input);
  vantage = pageVantage(crawlRows(input.batches));
  base = await freshDb();
  await applyAllMigrations(base);
}, 120_000);

const inputOf = (b: BuiltCheck = built): PersistInput => ({
  built: b,
  vantage,
  map_path: `anon/${b.check.site_id}/${b.check.id}/map.json.gz`,
});
const site = () => recordedBuild().site;
const checkOf = (b: BuiltCheck = built) => ({ ...recordedBuild().check, id: b.check.id });

/** A PersistDb that records what it was sent, stages answering `staged`, the last call `answer`. */
function recording(answer: unknown = { written: true, counts: {} }, staged: unknown = true) {
  const sent: unknown[] = [];
  const stages: [string, string, number, readonly unknown[]][] = [];
  const db: PersistDb = {
    async stageCheckRows(checkId, collection, chunk, rows) {
      stages.push([checkId, collection, chunk, rows]);
      return staged;
    },
    async persistBuiltCheck(payload) {
      sent.push(payload);
      return answer;
    },
  };
  return { db, sent, stages };
}

describe('persistBuiltCheck: what it sends', () => {
  it('every row the builder made: the bulk rows staged in order, each page with its crawl row’s vantage, the rest in the last call', async () => {
    const { db, sent, stages } = recording({ written: true, counts: { page_results: 60 } });
    const outcome = await persistBuiltCheck(db, inputOf());
    expect(outcome).toEqual({ written: true, counts: { page_results: 60 } });
    const stagedRows = (collection: string) =>
      stages.filter(([, c]) => c === collection).flatMap(([, , , rows]) => rows);
    expect(stages.every(([id]) => id === built.check.id)).toBe(true);
    expect(stagedRows('page_results')).toEqual(
      built.page_results.map((page) => ({ ...page, ...vantage.get(page.url) })),
    );
    expect(stagedRows('link_edges')).toEqual(built.link_edges);
    expect(stagedRows('access_tests')).toEqual(built.access_tests);
    for (const collection of ['page_results', 'link_edges', 'access_tests'])
      expect(stages.filter(([, c]) => c === collection).map(([, , n]) => n)).toEqual([
        ...Array(stages.filter(([, c]) => c === collection).length).keys(),
      ]);
    expect(sent).toHaveLength(1);
    const p = sent[0] as Record<string, unknown>;
    expect(p.check).toEqual(built.check);
    const chunks = (collection: string) => stages.filter(([, c]) => c === collection).length;
    expect(p.staged).toEqual({
      page_results: { chunks: chunks('page_results'), rows: built.page_results.length },
      link_edges: { chunks: chunks('link_edges'), rows: built.link_edges.length },
      access_tests: { chunks: chunks('access_tests'), rows: built.access_tests.length },
    });
    // The recorded access tests are more than one chunk's worth.
    expect(chunks('access_tests')).toBeGreaterThan(1);
    expect(p.fixes).toEqual(built.fixes);
    expect(p.fix_events).toEqual(built.fix_events);
    expect(p.changes).toEqual(built.changes);
    expect(p.lineages).toEqual(built.lineages);
    expect(p.usage_event).toBeNull();
    expect(p.diff_inputs).toEqual(built.diff_inputs);
    expect(p.map_path).toBe(inputOf().map_path);
    expect(Object.keys(p).sort()).toEqual([
      'changes',
      'check',
      'diff_inputs',
      'fix_events',
      'fixes',
      'lineages',
      'map_path',
      'staged',
      'usage_event',
    ]);
  });

  it('stops staging once a stage answers that the check is written, and still asks the last call', async () => {
    const { db, sent, stages } = recording({ written: false, counts: {} }, false);
    expect(await persistBuiltCheck(db, inputOf())).toEqual({ written: false, counts: {} });
    expect(stages).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it('refuses a page with no vantage, before any call', async () => {
    const { db, sent, stages } = recording();
    const partial = new Map(vantage);
    partial.delete(built.page_results[7]!.url);
    await expect(persistBuiltCheck(db, { ...inputOf(), vantage: partial })).rejects.toThrow(
      /no vantage/,
    );
    expect(sent).toEqual([]);
    expect(stages).toEqual([]);
  });

  // The access rows' CC-12d rules are the writer's (RULES_AT_WRITE): this is where they hold.
  const crawlerId = () => built.access_tests.find((t) => t.identity_role === 'crawler')!.id;
  it.each([
    [
      'an access row naming no crawler on a crawler row (access_identity_ua)',
      (b: BuiltCheck) => ({
        ...b,
        access_tests: b.access_tests.map((t) => (t.id === crawlerId() ? { ...t, ua: null } : t)),
      }),
    ],
    [
      'an access row from Fly with no region (fly_region)',
      (b: BuiltCheck) => ({
        ...b,
        access_tests: b.access_tests.map((t) =>
          t.id === crawlerId()
            ? { ...t, fly_region: null, source_ip_class: 'fly_egress' as const }
            : t,
        ),
      }),
    ],
    [
      'a page with a field the contract does not have',
      (b: BuiltCheck) => ({
        ...b,
        page_results: b.page_results.map((p, i) => (i === 0 ? { ...p, extra: 1 } : p)),
      }),
    ],
    [
      'a change the contract refuses (change_severity)',
      (b: BuiltCheck) => ({
        ...b,
        changes: b.changes.map((c, i) => (i === 0 ? { ...c, severity: null } : c)),
      }),
    ],
    [
      'diff inputs naming a detector the contract does not know',
      (b: BuiltCheck) => ({ ...b, diff_inputs: { ...b.diff_inputs, detectors: ['nope'] } }),
    ],
  ])('refuses %s, before any call', async (_label, edit) => {
    const { db, sent, stages } = recording();
    await expect(
      persistBuiltCheck(db, inputOf(edit(structuredClone(built)) as BuiltCheck)),
    ).rejects.toThrow();
    expect(sent).toEqual([]);
    expect(stages).toEqual([]);
  });

  it('refuses a vantage the contract refuses', async () => {
    const { db, sent, stages } = recording();
    const bad = new Map(vantage);
    const url = built.page_results[0]!.url;
    bad.set(url, { ...vantage.get(url)!, source_ip_class: 'elsewhere' as never });
    await expect(persistBuiltCheck(db, { ...inputOf(), vantage: bad })).rejects.toThrow();
    expect(sent).toEqual([]);
    expect(stages).toEqual([]);
  });

  it.each([
    [null],
    [{ written: 'yes', counts: {} }],
    [{ written: true }],
    [{ written: true, counts: { x: -1 } }],
  ])('refuses an answer that is not {written, counts}: %j', async (answer) => {
    await expect(persistBuiltCheck(recording(answer).db, inputOf())).rejects.toThrow();
  });

  it('refuses a stage answer that is not a boolean', async () => {
    await expect(
      persistBuiltCheck(recording(undefined, { staged: 1 }).db, inputOf()),
    ).rejects.toThrow();
  });
});

describe('chunked', () => {
  const rows = Array.from({ length: 300 }, (_, i) => ({ i, text: 'x'.repeat(i % 97) }));

  it('keeps every row, in order, each chunk within the bound', () => {
    const bound = 2_000;
    const chunks = chunked(rows, bound);
    expect(chunks.flat()).toEqual(rows);
    expect(chunks.length).toBeGreaterThan(5); // anti-vacuity
    for (const c of chunks)
      expect(new TextEncoder().encode(JSON.stringify(c)).length).toBeLessThanOrEqual(bound);
  });

  it('a row larger than the bound is a chunk of its own; no rows, no chunks', () => {
    const big = { text: 'x'.repeat(300) };
    expect(chunked([{ a: 1 }, big, { b: 2 }], 100)).toEqual([[{ a: 1 }], [big], [{ b: 2 }]]);
    expect(chunked([], 100)).toEqual([]);
  });

  it('the bound is half the 2 MB request bound of Q11', () => {
    expect(CHUNK_BYTES).toBe(1024 * 1024);
  });
});

describe('pageVantage', () => {
  const row = (url: string, outcome: CrawlPage['outcome'], identity: string): CrawlPage => ({
    ...crawlRows(recordedBuild().batches)[0]!,
    url,
    outcome,
    identity_sent: identity,
  });

  it('is each fetched crawl row’s vantage, by URL; a row not fetched gives none', () => {
    const v = pageVantage([
      row('https://a.test/1', 'fetched', 'ua-1'),
      row('https://a.test/2', 'robots_disallowed', 'ua-2'),
      row('https://a.test/3', 'failed', 'ua-3'),
    ]);
    expect([...v.keys()]).toEqual(['https://a.test/1']);
    expect(Object.keys(v.get('https://a.test/1')!).sort()).toEqual([
      'headers',
      'identity_sent',
      'request_headers',
      'source_ip_class',
    ]);
  });

  it('a URL fetched twice takes its last row, as the builder reads the batches', () => {
    const v = pageVantage([
      row('https://a.test/1', 'fetched', 'first'),
      row('https://a.test/1', 'fetched', 'second'),
    ]);
    expect(v.get('https://a.test/1')!.identity_sent).toBe('second');
  });

  it('covers every page the builder made from the recorded batches', () => {
    expect(built.page_results.filter((p) => !vantage.has(p.url))).toEqual([]);
  });
});

describe('supabasePersistDb', () => {
  const client = (answer: { data: unknown; error: unknown }) => {
    const calls: unknown[][] = [];
    const sb = {
      rpc: async (...args: unknown[]) => {
        calls.push(args);
        return answer;
      },
    } as unknown as SupabaseClient;
    return { sb, calls };
  };

  it('calls stage_check_rows with its four arguments, and returns its answer', async () => {
    const { sb, calls } = client({ data: true, error: null });
    expect(await supabasePersistDb(sb).stageCheckRows('c', 'link_edges', 2, [{ a: 1 }])).toBe(true);
    expect(calls).toEqual([
      [
        'stage_check_rows',
        { p_check: 'c', p_collection: 'link_edges', p_chunk: 2, p_rows: [{ a: 1 }] },
      ],
    ]);
  });

  it('calls persist_built_check with the payload as p, and returns its answer', async () => {
    const { sb, calls } = client({ data: { written: false, counts: {} }, error: null });
    expect(await supabasePersistDb(sb).persistBuiltCheck({ a: 1 })).toEqual({
      written: false,
      counts: {},
    });
    expect(calls).toEqual([['persist_built_check', { p: { a: 1 } }]]);
  });

  it('throws on an error, naming its code and message', async () => {
    const { sb } = client({
      data: null,
      error: { code: '55000', message: 'persist_built_check: check x is queued, not running' },
    });
    await expect(supabasePersistDb(sb).persistBuiltCheck({})).rejects.toThrow(/55000.*not running/);
  });
});

// ─── On the database ──────────────────────────────────────────────────────────────────────────────

let db: PGlite;

const count = async (table: string, column = 'check_id', value = built.check.id) =>
  (
    await db.query<{ n: number }>(
      `select count(*)::int as n from public.${table} where ${column} = $1`,
      [value],
    )
  ).rows[0]!.n;

describe('persist_built_check, through persistBuiltCheck', () => {
  beforeEach(async () => {
    db = (await base.clone()) as PGlite;
  });
  afterEach(async () => {
    await db.close();
  });

  it('writes the check, its rows and its fixes, and returns the counts', async () => {
    await seedRunningCheck(db, site(), checkOf());
    const outcome = await persistBuiltCheck(pglitePersistDb(db), inputOf());
    expect(outcome).toEqual({
      written: true,
      counts: {
        page_results: built.page_results.length,
        link_edges: built.link_edges.length,
        access_tests: built.access_tests.length,
        fixes: built.fixes.length,
        fix_events: built.fix_events.length,
        changes: built.changes.length,
        usage_events: 0,
        usage_events_skipped: 0,
      },
    });
    expect(await count('page_results')).toBe(built.page_results.length);
    expect(await count('link_edges')).toBe(built.link_edges.length);
    expect(await count('access_tests')).toBe(built.access_tests.length);
    expect(await count('changes')).toBe(built.changes.length);
    expect(await count('site_fixes', 'site_id', built.check.site_id)).toBe(built.fixes.length);
    const { rows } = await db.query<Record<string, unknown>>(
      `select status, progress, map_path, diff_inputs, inngest_run_id from public.checks where id = $1`,
      [built.check.id],
    );
    expect(rows[0]).toEqual({
      status: built.check.status,
      progress: null,
      map_path: inputOf().map_path,
      diff_inputs: built.diff_inputs,
      inngest_run_id: 'test-run',
    });
  });

  it('names the fetching lineage on every measurement row and the grading lineage on the check', async () => {
    await seedRunningCheck(db, site(), checkOf());
    await persistBuiltCheck(pglitePersistDb(db), inputOf());
    const { rows } = await db.query<{ t: string; lineage: string }>(
      `select 'check' as t, lineage_id::text as lineage from public.checks where id = $1
       union select 'page', lineage_id::text from public.page_results where check_id = $1
       union select 'edge', lineage_id::text from public.link_edges where check_id = $1
       union select 'access', lineage_id::text from public.access_tests where check_id = $1
       order by 1`,
      [built.check.id],
    );
    const fetching = built.lineages.fetching.id;
    expect(rows).toEqual([
      { t: 'access', lineage: fetching },
      { t: 'check', lineage: built.lineages.grading.id },
      { t: 'edge', lineage: fetching },
      { t: 'page', lineage: fetching },
    ]);
  });

  it('reuses a lineage that already exists with the same five values, whatever its id', async () => {
    const existing = randomUUID();
    const f = built.lineages.fetching;
    await db.query(
      `insert into public.measurement_lineages (id, engine_sha, detector_ruleset_version,
         crawler_registry_version, worker_release, population_version)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        existing,
        f.engine_sha,
        f.detector_ruleset_version,
        f.crawler_registry_version,
        f.worker_release,
        f.population_version,
      ],
    );
    await seedRunningCheck(db, site(), checkOf());
    await persistBuiltCheck(pglitePersistDb(db), inputOf());
    const { rows } = await db.query<{ lineage: string }>(
      `select distinct lineage_id::text as lineage from public.page_results where check_id = $1`,
      [built.check.id],
    );
    expect(rows).toEqual([{ lineage: existing }]);
  });

  it('creates the partitions of the check’s month when they are missing', async () => {
    const queued = '2025-01-15T10:00:00Z';
    const old = { ...built, check: { ...built.check, queued_at: queued } };
    await seedRunningCheck(db, site(), { ...checkOf(), queued_at: queued });
    await persistBuiltCheck(pglitePersistDb(db), inputOf(old));
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from partitions.public_page_results_2025_01 where check_id = $1`,
      [built.check.id],
    );
    expect(rows[0]!.n).toBe(built.page_results.length);
  });

  it('does not write expires_at, result_email, deferred_until or failure_reason', async () => {
    // checks_deferred_until and checks_failure_reason hold both columns null on a running check and
    // on a finished one, so a write of the payload's nulls could not be told from no write. This copy
    // of the database drops the two constraints, so each column can hold a value the payload's differs
    // from, and a write shows.
    await db.query(
      `alter table public.checks drop constraint checks_deferred_until,
                                 drop constraint checks_failure_reason`,
    );
    await seedRunningCheck(db, site(), { ...checkOf(), expires_at: null });
    const seeded = {
      expires_at: null,
      result_email: { sent_at: null, link_expires_at: '2026-12-05T02:29:58Z' },
      deferred_until: '2026-11-05 03:00:00', // UTC
      failure_reason: 'seeded-reason',
    };
    await db.query(
      `update public.checks
          set result_email = $2::jsonb, deferred_until = ($3::timestamp at time zone 'UTC'),
              failure_reason = $4
        where id = $1`,
      [
        built.check.id,
        JSON.stringify(seeded.result_email),
        seeded.deferred_until,
        seeded.failure_reason,
      ],
    );
    // Anti-vacuity: the payload's check differs from the row in each of the four.
    const sent = persistCalls(inputOf()).payload.check as Record<string, unknown>;
    expect(sent.expires_at).not.toBeNull();
    expect([sent.result_email, sent.deferred_until, sent.failure_reason]).toEqual([
      null,
      null,
      null,
    ]);
    await persistBuiltCheck(pglitePersistDb(db), inputOf());
    const { rows } = await db.query<Record<string, unknown>>(
      `select status, expires_at, result_email,
              (deferred_until at time zone 'UTC')::text as deferred_until, failure_reason
         from public.checks where id = $1`,
      [built.check.id],
    );
    expect(rows[0]).toEqual({ status: built.check.status, ...seeded });
  });

  it('refuses a check that does not exist', async () => {
    await expect(persistBuiltCheck(pglitePersistDb(db), inputOf())).rejects.toThrow(/not found/);
  });

  it.each(['queued', 'failed'])('refuses a %s check, and writes nothing', async (status) => {
    await seedRunningCheck(db, site(), checkOf());
    await db.query(
      status === 'queued'
        ? `update public.checks set status = 'queued', started_at = null, progress = null where id = $1`
        : `update public.checks set status = 'failed', failure_reason = 'stalled', finished_at = now(), progress = null where id = $1`,
      [built.check.id],
    );
    await expect(persistBuiltCheck(pglitePersistDb(db), inputOf())).rejects.toThrow(
      new RegExp(`is ${status}, not running`),
    );
    expect(await count('page_results')).toBe(0);
  });

  it.each([
    ['start time', `started_at = started_at + interval '1 microsecond'`],
    ['queue time', `queued_at = queued_at - interval '1 second'`],
    ['trigger', `trigger = 'manual'`],
    ['grade version', `grade_version = '1.9.9'`],
  ])('refuses a built check whose %s differs from the row', async (_label, change) => {
    await seedRunningCheck(db, site(), checkOf());
    await db.query(`update public.checks set ${change} where id = $1`, [built.check.id]);
    await expect(persistBuiltCheck(pglitePersistDb(db), inputOf())).rejects.toThrow(/differs/);
    expect(await count('page_results')).toBe(0);
  });

  /** Stages every chunk of `calls` as persistBuiltCheck would, through `pdb`. */
  async function stageAll(calls: ReturnType<typeof persistCalls>) {
    for (const st of calls.stages)
      await pglitePersistDb(db).stageCheckRows(calls.checkId, st.collection, st.chunk, st.rows);
  }
  const staged = async () =>
    (
      await db.query<{ collection: string; chunk: number; n: number }>(
        `select collection, chunk, jsonb_array_length(rows) as n from public.persist_chunks
          where check_id = $1 order by 1, 2`,
        [built.check.id],
      )
    ).rows;

  it('refuses, in the RPC, a staged row naming another check', async () => {
    await seedRunningCheck(db, site(), checkOf());
    const calls = persistCalls(inputOf());
    const edges = calls.stages.find((st) => st.collection === 'link_edges')!;
    (edges.rows[3] as { check_id: string }).check_id = randomUUID();
    await stageAll(calls);
    await expect(pglitePersistDb(db).persistBuiltCheck(calls.payload)).rejects.toThrow(
      /another check or site/,
    );
  });

  it('the finished write leaves no staging behind', async () => {
    await seedRunningCheck(db, site(), checkOf());
    await persistBuiltCheck(pglitePersistDb(db), inputOf());
    expect(await staged()).toEqual([]);
  });

  it('refuses when a staged chunk is missing, and writes nothing', async () => {
    await seedRunningCheck(db, site(), checkOf());
    // Small chunks, so a collection has several.
    const calls = persistCalls(inputOf());
    const pages = calls.stages.find((st) => st.collection === 'page_results')!;
    const halves = [pages.rows.slice(0, 30), pages.rows.slice(30)];
    const payload = {
      ...calls.payload,
      staged: {
        ...(calls.payload.staged as object),
        page_results: { chunks: 2, rows: pages.rows.length },
      },
    };
    const others = calls.stages.filter((st) => st.collection !== 'page_results');
    for (const st of others)
      await pglitePersistDb(db).stageCheckRows(calls.checkId, st.collection, st.chunk, st.rows);
    await pglitePersistDb(db).stageCheckRows(calls.checkId, 'page_results', 0, halves[0]!);
    await expect(pglitePersistDb(db).persistBuiltCheck(payload)).rejects.toThrow(
      /the staged page_results are not chunks 0 to 1/,
    );
    await pglitePersistDb(db).stageCheckRows(calls.checkId, 'page_results', 1, halves[1]!);
    expect((await pglitePersistDb(db).persistBuiltCheck(payload)) as object).toMatchObject({
      written: true,
    });
    expect(await count('page_results')).toBe(built.page_results.length);
  });

  it('refuses a chunk beyond the stated number', async () => {
    await seedRunningCheck(db, site(), checkOf());
    const calls = persistCalls(inputOf());
    await stageAll(calls);
    await pglitePersistDb(db).stageCheckRows(calls.checkId, 'link_edges', 1, []);
    await expect(pglitePersistDb(db).persistBuiltCheck(calls.payload)).rejects.toThrow(
      /the staged link_edges are not chunks 0 to 0/,
    );
    expect(await count('link_edges')).toBe(0);
  });

  it('refuses when the staged rows are not the stated number, and writes nothing', async () => {
    await seedRunningCheck(db, site(), checkOf());
    const calls = persistCalls(inputOf());
    await stageAll(calls);
    const stated = (calls.payload.staged as Record<string, { chunks: number; rows: number }>)
      .access_tests!;
    const payload = {
      ...calls.payload,
      staged: {
        ...(calls.payload.staged as object),
        access_tests: { ...stated, rows: built.access_tests.length + 1 },
      },
    };
    await expect(pglitePersistDb(db).persistBuiltCheck(payload)).rejects.toThrow(
      new RegExp(
        `${built.access_tests.length} staged rows of access_tests, not ${built.access_tests.length + 1}`,
      ),
    );
    expect(await count('page_results')).toBe(0);
  });

  it('staging a chunk again replaces it, so a retried stage writes it once', async () => {
    await seedRunningCheck(db, site(), checkOf());
    const calls = persistCalls(inputOf());
    await stageAll(calls);
    await stageAll(calls);
    expect(await staged()).toEqual(
      calls.stages
        .map((st) => ({ collection: st.collection, chunk: st.chunk, n: st.rows.length }))
        .sort((a, b) => a.collection.localeCompare(b.collection) || a.chunk - b.chunk),
    );
    await pglitePersistDb(db).persistBuiltCheck(calls.payload);
    expect(await count('link_edges')).toBe(built.link_edges.length);
  });

  it('staging a chunk again with other rows keeps only the later rows', async () => {
    await seedRunningCheck(db, site(), checkOf());
    const pdb = pglitePersistDb(db);
    await pdb.stageCheckRows(built.check.id, 'link_edges', 0, [{ a: 1 }]);
    await pdb.stageCheckRows(built.check.id, 'link_edges', 1, [{ a: 2 }, { a: 3 }]);
    await pdb.stageCheckRows(built.check.id, 'link_edges', 1, [{ a: 4 }]);
    const { rows } = await db.query<{ rows: unknown }>(
      `select rows from public.persist_chunks where check_id = $1 and collection = 'link_edges' and chunk = 1`,
      [built.check.id],
    );
    expect(rows).toEqual([{ rows: [{ a: 4 }] }]);
  });

  it('staging chunk 0 clears the collection’s earlier chunks, so an attempt starts clean', async () => {
    await seedRunningCheck(db, site(), checkOf());
    const pdb = pglitePersistDb(db);
    await pdb.stageCheckRows(built.check.id, 'link_edges', 0, [{ a: 1 }]);
    await pdb.stageCheckRows(built.check.id, 'link_edges', 1, [{ a: 2 }]);
    await pdb.stageCheckRows(built.check.id, 'page_results', 0, [{ a: 3 }]);
    await pdb.stageCheckRows(built.check.id, 'link_edges', 0, [{ a: 4 }]);
    expect(await staged()).toEqual([
      { collection: 'link_edges', chunk: 0, n: 1 },
      { collection: 'page_results', chunk: 0, n: 1 },
    ]);
  });

  it('staging answers false, and writes nothing, once the check is written', async () => {
    await seedRunningCheck(db, site(), checkOf());
    await persistBuiltCheck(pglitePersistDb(db), inputOf());
    expect(
      await pglitePersistDb(db).stageCheckRows(built.check.id, 'link_edges', 0, [{ a: 1 }]),
    ).toBe(false);
    expect(await staged()).toEqual([]);
  });

  it.each([
    [
      'a queued check',
      `status = 'queued', started_at = null, progress = null`,
      /is queued, not running/,
    ],
    ['a check that does not exist', null, /not found/],
  ])('staging refuses %s', async (_label, set, error) => {
    await seedRunningCheck(db, site(), checkOf());
    if (set) await db.query(`update public.checks set ${set} where id = $1`, [built.check.id]);
    const id = set ? built.check.id : randomUUID();
    await expect(pglitePersistDb(db).stageCheckRows(id, 'link_edges', 0, [])).rejects.toThrow(
      error,
    );
  });

  it('staging refuses an unknown collection and rows that are not an array', async () => {
    await seedRunningCheck(db, site(), checkOf());
    await expect(
      db.query(`select public.stage_check_rows($1, 'site_fixes', 0, '[]'::jsonb)`, [
        built.check.id,
      ]),
    ).rejects.toThrow(/a collection, a chunk number and an array of rows are required/);
    await expect(
      db.query(`select public.stage_check_rows($1, 'link_edges', 0, '{}'::jsonb)`, [
        built.check.id,
      ]),
    ).rejects.toThrow(/a collection, a chunk number and an array of rows are required/);
  });

  it('refuses a fix whose id is another site’s fix: the upsert leaves it, and the count says so', async () => {
    const other = { ...site(), id: randomUUID(), host: 'other.test' };
    await seedRunningCheck(db, other, { ...checkOf(), id: randomUUID(), site_id: other.id });
    const theirs = built.fixes[0]!;
    const { rows } = await db.query<{ id: string }>(
      `select id::text from public.checks where site_id = $1`,
      [other.id],
    );
    await db.query(
      `insert into public.site_fixes (id, site_id, fingerprint, number, type, section, title,
         recommendation_class, status, last_state, last_measured_check_id, first_seen_check_id,
         confidence, affected_pages, rank, effect)
       values ($1, $2, $3, 1, $4, $5, 'theirs', $6, 'open', 'detected', $7, $7, 'confirmed', 1, 1, $8::jsonb)`,
      [
        theirs.id,
        other.id,
        theirs.fingerprint,
        theirs.type,
        theirs.section,
        theirs.recommendation_class,
        rows[0]!.id,
        JSON.stringify(theirs.effect),
      ],
    );
    await seedRunningCheck(db, site(), checkOf());
    await expect(persistBuiltCheck(pglitePersistDb(db), inputOf())).rejects.toThrow(
      new RegExp(`wrote ${built.fixes.length - 1} of ${built.fixes.length} fixes`),
    );
    expect(await count('page_results')).toBe(0);
  });

  it('inserts the fix events the diff appended, and refuses one naming a fix of another site', async () => {
    await seedRunningCheck(db, site(), checkOf());
    const event = {
      id: randomUUID(),
      fix_id: built.fixes[0]!.id,
      at: built.check.finished_at!,
      kind: 'reopened' as const,
      check_id: built.check.id,
    };
    const withEvent = { ...built, fix_events: [event] };
    expect(
      (await persistBuiltCheck(pglitePersistDb(db), inputOf(withEvent))).counts.fix_events,
    ).toBe(1);

    const again = (await base.clone()) as PGlite;
    try {
      await seedRunningCheck(again, site(), checkOf());
      const stray = { ...withEvent, fix_events: [{ ...event, fix_id: randomUUID() }] };
      await expect(persistBuiltCheck(pglitePersistDb(again), inputOf(stray))).rejects.toThrow(
        /an event names a fix of another site/,
      );
    } finally {
      await again.close();
    }
  });

  describe('the usage event of a kept site', () => {
    async function keptSite() {
      const user = await signUp(db, `kept-${randomUUID()}@example.com`);
      const { accountId } = await personalAccount(db, user);
      const usage: UsageEvent = {
        id: randomUUID(),
        account_id: accountId,
        kind: 'check_finished',
        check_id: built.check.id,
        report_id: null,
        result: 'delivered',
        billable: true,
        compute_seconds: 42,
        request_count: 460,
        occurred_at: built.check.finished_at!,
      };
      await seedRunningCheck(db, { ...site(), account_id: accountId }, checkOf());
      return { accountId, input: inputOf({ ...built, usage_event: usage }) };
    }

    it('is written while the site belongs to the event’s account, keyed to the check', async () => {
      const { input } = await keptSite();
      const outcome = await persistBuiltCheck(pglitePersistDb(db), input);
      expect(outcome.counts).toMatchObject({ usage_events: 1, usage_events_skipped: 0 });
      const { rows } = await db.query<{ key: string }>(
        `select idempotency_key as key from public.usage_events where check_id = $1`,
        [built.check.id],
      );
      expect(rows).toEqual([{ key: `usage:${built.check.id}` }]);
    });

    it('is skipped, and counted as skipped, once the site belongs to no account or another', async () => {
      const { input } = await keptSite();
      await db.query(
        `update public.sites set account_id = null, schedule_cadence = null where id = $1`,
        [built.check.site_id],
      );
      const outcome = await persistBuiltCheck(pglitePersistDb(db), input);
      expect(outcome.counts).toMatchObject({ usage_events: 0, usage_events_skipped: 1 });
      expect(await count('usage_events')).toBe(0);
      expect(await count('page_results')).toBe(built.page_results.length);
    });
  });
});

// ─── At the page cap (Q11) ────────────────────────────────────────────────────────────────────────

/** The response headers a crawl row keeps on a typical CDN-fronted page, a long Link and CSP among them. */
const RESPONSE_HEADERS = [
  { name: 'content-type', value: 'text/html; charset=utf-8' },
  { name: 'server', value: 'cloudflare' },
  { name: 'cf-ray', value: '8d9f2c1a7b3e4f01-IAD' },
  { name: 'cf-cache-status', value: 'HIT' },
  { name: 'cache-control', value: 'public, max-age=0, must-revalidate' },
  { name: 'age', value: '1834' },
  { name: 'vary', value: 'Accept-Encoding' },
  { name: 'x-robots-tag', value: 'index, follow' },
  { name: 'last-modified', value: 'Tue, 03 Nov 2026 14:12:09 GMT' },
  { name: 'etag', value: 'W/"5f2c1b9e8d7a6c5b4e3d2f1a0"' },
  {
    name: 'link',
    value: Array.from(
      { length: 4 },
      (_, i) => `<https://cdn.built-site.test/assets/app-${i}.css>; rel=preload; as=style`,
    ).join(', '),
  },
  {
    name: 'content-security-policy',
    value:
      `default-src 'self'; ${Array.from({ length: 14 }, (_, i) => `script-src-elem https://cdn${i}.vendor.test`).join('; ')}`.slice(
        0,
        1024,
      ),
  },
];

/**
 * A built check at the cap: 500 pages (titles, descriptions and the headers above), 10,000 link
 * edges (20 out of each page), and the recorded check's 400 access tests, fixes and changes.
 */
function atTheCap(): PersistInput {
  const template = built.page_results[0]!;
  const url = (i: number) => `https://built-site.test/products/item-${i}`;
  const page_results = Array.from({ length: 500 }, (_, i) => ({
    ...template,
    url: url(i),
    final_url: url(i),
    template_key: '/products/{slug}',
    title: {
      text: `Item ${i} – handmade oak furniture for small rooms | Built Site`,
      chars: 62,
      cut: false,
    },
    meta_description: {
      text: `Item ${i}: solid oak, finished by hand in our workshop, delivered in two weeks. Read the care guide, see the sizes and order a sample before you buy.`.slice(
        0,
        160,
      ),
      chars: 150,
      cut: false,
    },
  }));
  const link_edges = page_results.flatMap((p, i) =>
    Array.from({ length: 20 }, (_, j) => ({
      check_id: built.check.id,
      from_url: p.url,
      to_url: url((i + j + 1) % 500),
      anchor_text: `See item ${(i + j + 1) % 500} in solid oak`,
      is_generic_anchor: false,
      js_only: false,
    })),
  );
  const crawl = vantage.get(template.url)!;
  const capVantage = new Map(
    page_results.map((p) => [p.url, { ...crawl, headers: RESPONSE_HEADERS }] as const),
  );
  return {
    built: { ...built, page_results, link_edges },
    vantage: capVantage,
    map_path: `anon/${built.check.site_id}/${built.check.id}/map.json.gz`,
  };
}

describe('a built check at the page cap (Q11)', () => {
  let capDb: PGlite;
  beforeEach(async () => {
    capDb = (await base.clone()) as PGlite;
  });
  afterEach(async () => {
    await capDb.close();
  });

  it('every request stays under 2 MB, and the sizes and PGlite times are reported', async () => {
    const input = atTheCap();
    expect(input.built.page_results).toHaveLength(500);
    expect(input.built.link_edges).toHaveLength(10_000);
    expect(input.built.access_tests).toHaveLength(400);
    const calls = persistCalls(input);
    const size = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
    // What one request would have carried: every row in a single body (supabase-js sends {"p": …}).
    const bulk = Object.fromEntries(
      ['page_results', 'link_edges', 'access_tests'].map((c) => [
        c,
        calls.stages.filter((st) => st.collection === c).flatMap((st) => st.rows),
      ]),
    );
    const rest: Record<string, unknown> = { ...calls.payload };
    delete rest.staged;
    const single = size({ p: { ...rest, ...bulk } });
    const stageBodies = calls.stages.map((st) =>
      size({
        p_check: calls.checkId,
        p_collection: st.collection,
        p_chunk: st.chunk,
        p_rows: st.rows,
      }),
    );
    const finishing = size({ p: calls.payload });

    await seedRunningCheck(capDb, site(), checkOf());
    const pdb = pglitePersistDb(capDb);
    let stagingMs = 0;
    let finishingMs = 0;
    const timed: PersistDb = {
      async stageCheckRows(...args) {
        const t = performance.now();
        const answer = await pdb.stageCheckRows(...args);
        stagingMs += performance.now() - t;
        return answer;
      },
      async persistBuiltCheck(payload) {
        const t = performance.now();
        const answer = await pdb.persistBuiltCheck(payload);
        finishingMs = performance.now() - t;
        return answer;
      },
    };
    const outcome = await persistBuiltCheck(timed, input);
    expect(outcome.counts).toMatchObject({
      page_results: 500,
      link_edges: 10_000,
      access_tests: 400,
    });
    const mib = (n: number) => `${n} bytes (${(n / 1024 / 1024).toFixed(2)} MiB)`;
    process.stdout.write(
      [
        `Q11 at the cap, as one request: ${mib(single)}; by collection ${Object.entries(bulk)
          .map(([c, rows]) => `${c} ${size(rows)}`)
          .join(', ')}`,
        `Q11 staged: ${calls.stages.length} chunks, the largest request ${mib(Math.max(...stageBodies))}, staging ${Math.round(stagingMs)} ms in PGlite`,
        `Q11 finishing request ${mib(finishing)}, persist_built_check ${Math.round(finishingMs)} ms in PGlite`,
      ].join('\n') + '\n',
    );
    // The owner's bound (rulings.md Q11), on every request the writer makes.
    expect(single, 'anti-vacuity: one request would exceed the bound').toBeGreaterThan(
      2 * 1024 * 1024,
    );
    for (const bytes of [...stageBodies, finishing]) expect(bytes).toBeLessThan(2 * 1024 * 1024);
  }, 120_000);
});

// ─── The one writer ───────────────────────────────────────────────────────────────────────────────

const WRITTEN = [
  'page_results',
  'link_edges',
  'access_tests',
  'site_fixes',
  'fix_events',
  'changes',
  'usage_events',
  'persist_chunks',
];
const TABLE = WRITTEN.join('|');
const RPCS = 'persist_built_check|stage_check_rows';
const QUOTED = `['"\`]`;
/**
 * A write to one of WRITTEN, or a call of either persist function: a supabase-js insert, upsert,
 * update or delete on the table; SQL inserting into, updating or deleting from it; `.rpc(` with a
 * function's name or its constant; SQL selecting the function. A select from a table is not a write.
 */
const WRITES = [
  new RegExp(
    `\\.from\\(\\s*${QUOTED}(${TABLE})${QUOTED}\\s*\\)[^;]*?\\.(?:insert|upsert|update|delete)\\s*\\(`,
    'g',
  ),
  new RegExp(`\\binsert\\s+into\\s+(?:"?public"?\\s*\\.\\s*)?"?(${TABLE})"?\\b`, 'gi'),
  new RegExp(`\\bupdate\\s+(?:"?public"?\\s*\\.\\s*)?"?(${TABLE})"?\\s+(?:\\w+\\s+)?set\\b`, 'gi'),
  new RegExp(`\\bdelete\\s+from\\s+(?:"?public"?\\s*\\.\\s*)?"?(${TABLE})"?\\b`, 'gi'),
  new RegExp(`\\.rpc\\(\\s*(?:${QUOTED}(${RPCS})${QUOTED}|(PERSIST_RPC|STAGE_RPC)\\b)`, 'g'),
  new RegExp(`\\bselect\\s+(?:"?public"?\\s*\\.\\s*)?(${RPCS})\\s*\\(`, 'gi'),
];
const writesIn = (source: string): string[] =>
  WRITES.flatMap((re) => [...source.matchAll(re)].map((m) => (m[1] ?? m[2])!));

const ROOT = resolve(__dirname, '../../../../..');
const WRITER = 'apps/web/lib/v2/pipeline/persist.ts';
const SKIP_DIR = new Set(['node_modules', '.next', '.turbo', '__tests__', 'test-support', 'dist']);
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const at = join(dir, e.name);
    if (e.isDirectory()) return SKIP_DIR.has(e.name) ? [] : sources(at);
    return /\.(ts|tsx|js|mjs|cjs|sql)$/.test(e.name) && !/\.test\.[a-z]+$/.test(e.name) ? [at] : [];
  });
}

describe('persist.ts is the only code that writes a built check’s rows', () => {
  it.each([
    [`sb.from('changes').insert(rows)`, ['changes']],
    [`sb\n  .from("page_results")\n  .upsert(rows, { onConflict: 'x' })`, ['page_results']],
    ['sb.from(`site_fixes`).update({ rank: 1 }).eq("id", x)', ['site_fixes']],
    [`sb.from('persist_chunks').delete().eq('check_id', id)`, ['persist_chunks']],
    [`INSERT INTO public.link_edges (a) VALUES (1)`, ['link_edges']],
    [`insert into "public"."fix_events" (a) select 1`, ['fix_events']],
    [`insert   into\n access_tests (id)`, ['access_tests']],
    [`update public.site_fixes f set rank = 1`, ['site_fixes']],
    [`DELETE FROM usage_events where true`, ['usage_events']],
    [`await sb.rpc('stage_check_rows', args)`, ['stage_check_rows']],
    [`await sb.rpc(PERSIST_RPC, { p })`, ['PERSIST_RPC']],
    [`select public.persist_built_check($1::jsonb)`, ['persist_built_check']],
    // Reads, other tables, and prose are not writes.
    [`sb.from('page_results').select('*').in('check_id', ids)`, []],
    [`sb.from('changes').select('*'); other.insert(rows)`, []],
    [`insert into public.changes_archive (a) values (1)`, []],
    [`sb.from('checks').update(row)`, []],
    [`// we update changes once the diff is read`, []],
    [`persist_built_check (migration 008) writes the check`, []],
  ])('the matcher reads %j as writing %j', (source, tables) => {
    expect(writesIn(source)).toEqual(tables);
  });

  it('no other file under apps/web, inngest or scripts writes them or calls the persist functions', () => {
    const files = ['apps/web', 'inngest', 'scripts']
      .flatMap((d) => sources(join(ROOT, d)))
      .filter((f) => relative(ROOT, f) !== WRITER);
    expect(files.length, 'anti-vacuity: the scan reads files').toBeGreaterThan(200);
    const writers = files
      .map((f) => [relative(ROOT, f), writesIn(readFileSync(f, 'utf8'))] as const)
      .filter(([, tables]) => tables.length > 0)
      .map(([f, tables]) => `${f}: ${tables.join(', ')}`);
    expect(writers).toEqual([]);
  });
});
