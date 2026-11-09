import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { buildCheck, serialiseBuilt, type BuiltCheck } from '@crawlmouse/engine/v2/pipeline';
import type { BatchResult, CrawlPage } from '@crawlmouse/types/v2';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { recordedBuild } from '../../../../../packages/engine/fixtures/v2/build/recorded';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { loadCheck } from './load';
import { pageVantage, persistBuiltCheck, persistCalls } from './persist';
import { pgliteCheckReader, pglitePersistDb, seedRunningCheck } from './test-support/pglite';
import type { PageVantage, PersistInput } from './types';

/**
 * D12: the engine's build of the recorded site, computed here at run time, persisted into PGlite with
 * every migration, and read back with loadCheck, equals apps/web/lib/fixtures/v2/built-site.json as
 * it is on disk, which the engine's generator wrote from buildCheck without a database. The exceptions
 * are the dataset's four metadata fields (Q2: provenance, as_of, description, engine_derived), and
 * timestamps, compared as instants (the database writes them in its own spelling).
 *
 * D5: a second persist of the same check writes nothing; a finishing call that fails part way leaves
 * nothing of the check in any table it writes; page_results holds each page's vantage from its crawl
 * row, which the contract's PageResult does not carry; and the built check as the persist step reads it
 * (JSON.parse(serialiseBuilt(built)), from built.json.gz) writes the rows the build in memory writes.
 */

const FIXTURE = resolve(__dirname, '../../fixtures/v2/built-site.json');
const META = ['provenance', 'as_of', 'description', 'engine_derived'];
/** The tables persist_built_check writes, with the column that names the check's rows. */
const WRITTEN: [string, string][] = [
  ['page_results', 'check_id'],
  ['link_edges', 'check_id'],
  ['access_tests', 'check_id'],
  ['changes', 'check_id'],
  ['usage_events', 'check_id'],
  ['site_fixes', 'first_seen_check_id'],
  ['fix_events', 'check_id'],
];

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
/** Timestamps as instants; everything else as it is. Applied to both sides. */
function normalize(v: unknown): unknown {
  if (typeof v === 'string' && ISO.test(v)) return Date.parse(v);
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalize(x)]));
  return v;
}
const withoutMeta = (d: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(d).filter(([k]) => !META.includes(k)));

let built: BuiltCheck;
let crawl: CrawlPage[];
let input: PersistInput;
let base: PGlite;
let db: PGlite;
beforeAll(async () => {
  const recorded = recordedBuild();
  built = buildCheck(recorded);
  crawl = (recorded.batches as BatchResult[]).flatMap((b): CrawlPage[] =>
    b.kind === 'crawl' ? b.pages : [],
  );
  input = {
    built,
    vantage: pageVantage(crawl),
    map_path: `anon/${built.check.site_id}/${built.check.id}/map.json.gz`,
  };
  base = await freshDb();
  await applyAllMigrations(base);
}, 120_000);
beforeEach(async () => {
  db = (await base.clone()) as PGlite;
  const recorded = recordedBuild();
  await seedRunningCheck(db, recorded.site, recorded.check);
});
afterEach(async () => {
  await db.close();
});

async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [table, column] of WRITTEN) {
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.${table} where ${column} = $1`,
      [built.check.id],
    );
    out[table] = rows[0]!.n;
  }
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from public.measurement_lineages where id = any($1::uuid[])`,
    [[built.lineages.grading.id, built.lineages.fetching.id]],
  );
  out.measurement_lineages = rows[0]!.n;
  return out;
}

describe('a built check, persisted and read back, is the built-site fixture', () => {
  it('equal to the file on disk in every collection', async () => {
    await persistBuiltCheck(pglitePersistDb(db), input);
    const loaded = await loadCheck(pgliteCheckReader(db), built.check.id);
    const file = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(loaded).sort()).toEqual(Object.keys(file).sort());
    expect(normalize(withoutMeta(loaded))).toEqual(normalize(withoutMeta(file)));
    // Anti-vacuity: the collections compared hold the check's rows.
    expect((loaded.page_results as unknown[]).length).toBeGreaterThan(50);
    expect((loaded.access_tests as unknown[]).length).toBeGreaterThan(100);
  });
});

describe('persisting is idempotent (D5)', () => {
  it('a second persist of the same check writes nothing and says so', async () => {
    const first = await persistBuiltCheck(pglitePersistDb(db), input);
    expect(first.written).toBe(true);
    const after = await counts();
    expect(after.page_results).toBe(built.page_results.length); // anti-vacuity
    const second = await persistBuiltCheck(pglitePersistDb(db), input);
    expect(second).toEqual({ written: false, counts: {} });
    expect(await counts()).toEqual(after);
  });
});

describe('persisting is atomic (D5)', () => {
  it('a change the database refuses, after the staged rows are moved, leaves nothing of the check anywhere', async () => {
    const calls = persistCalls(input);
    for (const st of calls.stages)
      await pglitePersistDb(db).stageCheckRows(calls.checkId, st.collection, st.chunk, st.rows);
    const changes = calls.payload.changes as { severity: unknown }[];
    changes[changes.length - 1]!.severity = null; // changes_severity refuses it
    await expect(pglitePersistDb(db).persistBuiltCheck(calls.payload)).rejects.toThrow(
      /changes_severity/,
    );
    expect(await counts()).toEqual(
      Object.fromEntries([...WRITTEN.map(([t]) => [t, 0]), ['measurement_lineages', 0]]),
    );
    const { rows } = await db.query<{ status: string; staged: number }>(
      `select status, (select count(*)::int from public.persist_chunks s where s.check_id = c.id) as staged
         from public.checks c where id = $1`,
      [built.check.id],
    );
    // The check is still running, with its staging as it was: a retry starts from there.
    expect(rows[0]).toEqual({ status: 'running', staged: calls.stages.length });
  });
});

describe('page_results holds each page’s vantage, as its crawl row carried it (D5)', () => {
  it('identity_sent, source_ip_class, request_headers and headers, read back, are the crawl row’s', async () => {
    await persistBuiltCheck(pglitePersistDb(db), input);
    const { rows } = await db.query<Record<string, unknown> & { url: string }>(
      `select url, identity_sent, source_ip_class, request_headers, headers
         from public.page_results where check_id = $1`,
      [built.check.id],
    );
    // Each URL's last fetched crawl row, as the builder reads the batches.
    const fetched = new Map(crawl.filter((p) => p.outcome === 'fetched').map((p) => [p.url, p]));
    const byUrl = (a: { url: string }, b: { url: string }) => (a.url < b.url ? -1 : 1);
    expect(rows.sort(byUrl)).toEqual(
      built.page_results
        .map(({ url }) => {
          const row = fetched.get(url)!;
          return {
            url,
            identity_sent: row.identity_sent,
            source_ip_class: row.source_ip_class,
            request_headers: row.request_headers,
            headers: row.headers,
          };
        })
        .sort(byUrl),
    );
    // Anti-vacuity: the pages are read, and their request and response headers differ.
    expect(rows.length).toBe(built.page_results.length);
    expect(rows.every((r) => JSON.stringify(r.request_headers) !== JSON.stringify(r.headers))).toBe(
      true,
    );
  });
});

describe('the persist step’s input writes what the build in memory writes', () => {
  /**
   * Every row the persist wrote for the check, by table. checks.heartbeat_at is left out:
   * persist_built_check sets it from the clock, so two writes cannot share it.
   */
  async function written(d: PGlite): Promise<Record<string, unknown[]>> {
    const tables: [string, string, string[]][] = [
      ...WRITTEN.map(([t, c]): [string, string, string[]] => [t, c, [built.check.id]]),
      ['checks', 'id', [built.check.id]],
      ['persist_chunks', 'check_id', [built.check.id]],
      ['measurement_lineages', 'id', [built.lineages.grading.id, built.lineages.fetching.id]],
    ];
    const out: Record<string, unknown[]> = {};
    for (const [table, column, values] of tables) {
      const { rows } = await d.query<{ row: unknown }>(
        `select to_jsonb(t) - $2::text[] as row from public.${table} t where t.${column}::text = any($1)`,
        [values, table === 'checks' ? ['heartbeat_at'] : []],
      );
      out[table] = rows
        .map((r) => r.row)
        .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
    }
    return out;
  }

  it('JSON.parse(serialiseBuilt(built)) and its vantage entries, as built.json.gz holds them, write the same rows', async () => {
    // As steps/finish.ts stores { built, vantage } and the persist step reads it back.
    const stored = JSON.parse(
      JSON.stringify({ built: JSON.parse(serialiseBuilt(built)), vantage: [...input.vantage] }),
    ) as { built: BuiltCheck; vantage: [string, PageVantage][] };
    const other = (await base.clone()) as PGlite;
    try {
      await seedRunningCheck(other, recordedBuild().site, recordedBuild().check);
      await persistBuiltCheck(pglitePersistDb(db), input);
      await persistBuiltCheck(pglitePersistDb(other), {
        built: stored.built,
        vantage: new Map(stored.vantage),
        map_path: input.map_path,
      });
      const fromMemory = await written(db);
      expect(await written(other)).toEqual(fromMemory);
      // Anti-vacuity: the rows compared are the check's.
      expect(fromMemory.page_results).toHaveLength(built.page_results.length);
      expect(fromMemory.access_tests).toHaveLength(built.access_tests.length);
      expect(fromMemory.site_fixes).toHaveLength(built.fixes.length);
      expect(fromMemory.checks).toHaveLength(1);
      expect(fromMemory.measurement_lineages).toHaveLength(2);
    } finally {
      await other.close();
    }
  });
});
