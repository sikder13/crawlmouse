import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chunked, persistBuiltCheck, persistCalls } from '../../apps/web/lib/v2/pipeline/persist';
import {
  largeBuiltInput,
  largeBuiltSeed,
} from '../../apps/web/lib/v2/pipeline/test-support/large-built';
import {
  pglitePersistDb,
  seedRunning,
  seedSite,
} from '../../apps/web/lib/v2/pipeline/test-support/pglite';
import type { PersistDb } from '../../apps/web/lib/v2/pipeline/types';

/**
 * F-330: a 2,000-page check persisted on production as it was (25 Nov, check 37944f5e) and as it is
 * now, on a real Postgres with PostgREST's 8 s `statement_timeout` on every call, and with
 * `link_edges` already holding ten times production's rows (production held 56,859 on 25 Nov).
 *
 * The edge count is what `large.lab` produced on staging, 37,540. Production's insert of those
 * edges in persist_built_check, one statement, passed 8 s three times and the check failed. Now
 * the edges are written first, in pieces (persist.ts EDGE_PIECE_ROWS), each its own statement.
 *
 * Run like render-budget-race.test.ts: against TRIAL_RACE_DB_URL (a Postgres on this machine),
 * required when TRIAL_RACE_REQUIRED=1, skipped otherwise. A Postgres on CI or a laptop is faster
 * than production's instance (about 2.8× slower than staging's on this call; a2/status.md, inbox
 * 113), so the bound each piece is held to is a tenth of the timeout, not the timeout itself.
 */

const URL_ENV = process.env.TRIAL_RACE_DB_URL;
if (!URL_ENV && process.env.TRIAL_RACE_REQUIRED === '1') {
  throw new Error('TRIAL_RACE_REQUIRED=1 but TRIAL_RACE_DB_URL is not set');
}
if (URL_ENV && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(URL_ENV).hostname)) {
  throw new Error('TRIAL_RACE_DB_URL must name a local Postgres (localhost, 127.0.0.1 or [::1])');
}

const PAGES = 2_000;
const EDGES = 37_540;
/**
 * The shapes persisted the new way: production's failing check, and the densest 500-page check QA
 * measured on staging (19,886 edges, 2.4× the most production has saved in one call), on which the
 * Free 500-page check is held.
 */
const SHAPES = [
  { name: 'now', pages: PAGES, edges: EDGES },
  { name: 'dense500', pages: 500, edges: 19_886 },
] as const;
/** Production's `link_edges` on 25 Nov, ten times over. */
const FILLER_EDGES = 568_590;
const TIMEOUT_MS = 8_000;
/**
 * What persist_built_check, now without the edges, is held to on CI: half the timeout, for
 * production's slower instance (the CTO's margin, inbox 114).
 */
const FINISH_BOUND_MS = TIMEOUT_MS / 2;
/** What one edge piece is held to: a tenth of the timeout, for production's slower instance. */
const PIECE_BOUND_MS = TIMEOUT_MS / 10;
const HOOK_TIMEOUT_MS = 600_000;
const TEST_TIMEOUT_MS = 300_000;

type Sql = postgres.Sql;

function urlFor(base: string, database: string): string {
  const u = new URL(base);
  u.pathname = `/${database}`;
  return u.toString();
}

/** A fresh database with the Supabase stand-ins and every migration. */
async function migrated(admin: Sql, name: string): Promise<Sql> {
  const { PLATFORM_SHIM, migrationFiles, readMigration } =
    await import('../../apps/web/__tests__/helpers/pglite-migrations');
  await admin.unsafe(`create database ${name}`);
  const sql = postgres(urlFor(URL_ENV!, name), { max: 2, onnotice: () => {} });
  const shim = PLATFORM_SHIM.replace(
    /create role (\w+)([^;]*);/g,
    (_m, role: string, opts: string) =>
      `do $r$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role}${opts}; end if; end $r$;`,
  );
  await sql.unsafe(shim).simple();
  for (const f of migrationFiles()) await sql.unsafe(readMigration(f)).simple();
  return sql;
}

/**
 * The PGlite port's shape over postgres.js: `query(text, params)` answering `{ rows }`. The port
 * passes jsonb as a JSON string (`$n::jsonb`, which PGlite reads as text). postgres.js serializes a
 * parameter Postgres types as jsonb with JSON.stringify, so that string would arrive as a JSON
 * string, not the array or object it holds; the cast is moved past a text parameter instead.
 */
const asDb = (sql: Sql) =>
  ({
    query: async (text: string, params: unknown[] = []) => ({
      rows: await sql.unsafe(
        text.replace(/\$(\d+)::jsonb\b/g, '($$$1::text)::jsonb'),
        params as never[],
      ),
    }),
  }) as never;

/** The site, and ten times production's edges under another check of the same month. */
async function seedWithFiller(sql: Sql) {
  const { site, check } = largeBuiltSeed();
  await seedSite(asDb(sql), site);
  // On a site of its own: a site has one running check at a time (checks_one_running_per_site).
  const fillerSite = { ...site, id: randomUUID(), host: 'filler.test' };
  await seedSite(asDb(sql), fillerSite);
  const filler = { ...check, id: randomUUID(), site_id: fillerSite.id };
  await seedRunning(asDb(sql), filler);
  const [lineage] = await sql`
    insert into public.measurement_lineages (id, engine_sha, detector_ruleset_version,
      crawler_registry_version, worker_release, population_version, created_at)
    values (${randomUUID()}, ${'f'.repeat(40)}, '9.9.9', ${'e'.repeat(64)}, 'filler', null, now())
    returning id`;
  await sql`
    insert into public.link_edges (check_id, check_month, lineage_id, from_url, to_url,
      anchor_text, is_generic_anchor, js_only)
    select ${filler.id}, c.check_month, ${lineage!.id}, 'https://filler.test/p/' || (g / 20),
           'https://filler.test/q/' || g, 'filler ' || g, false, false
      from generate_series(1, ${FILLER_EDGES}) g, public.checks c where c.id = ${filler.id}`;
  await sql`analyze public.link_edges`;
  return { site, check };
}

/** Each call of `db`, timed, with its kind. */
function timed(db: PersistDb) {
  const calls: { kind: string; ms: number }[] = [];
  const time =
    <A extends unknown[], R>(kind: string, f: (...a: A) => Promise<R>) =>
    async (...a: A) => {
      const t = performance.now();
      try {
        return await f(...a);
      } finally {
        calls.push({ kind, ms: performance.now() - t });
      }
    };
  const port: PersistDb = {
    stageCheckRows: time('stage', db.stageCheckRows),
    persistBuiltCheck: time('persist_built_check', db.persistBuiltCheck),
    edgeTarget: time('edge_target', db.edgeTarget),
    insertEdges: time('edges', db.insertEdges),
  };
  return { port, calls };
}

describe.skipIf(!URL_ENV)('a 2,000-page check persisted under an 8 s timeout (F-330)', () => {
  const stamp = `${process.pid}_${Date.now()}`;
  const names = {
    now: `persist_edges_${stamp}`,
    dense500: `persist_edges_dense_${stamp}`,
    before: `persist_edges_before_${stamp}`,
  };
  let admin: Sql;
  const dbs: Partial<Record<keyof typeof names, Sql>> = {};

  beforeAll(async () => {
    admin = postgres(URL_ENV!, { max: 1, onnotice: () => {} });
    for (const key of Object.keys(names) as (keyof typeof names)[]) {
      dbs[key] = await migrated(admin, names[key]);
      await seedWithFiller(dbs[key]!);
    }
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    for (const sql of Object.values(dbs)) await sql?.end();
    for (const name of Object.values(names)) {
      await admin?.unsafe(`drop database if exists ${name} with (force)`);
    }
    await admin?.end();
  }, HOOK_TIMEOUT_MS);

  /** A connection whose every statement has PostgREST's 8 s, as `authenticator` has it. */
  const underTimeout = (database: string) =>
    postgres(urlFor(URL_ENV!, database), {
      max: 1,
      onnotice: () => {},
      connection: { statement_timeout: TIMEOUT_MS },
    });

  it.each(SHAPES)(
    '$name ($pages pages, $edges edges): every call well inside 8 s, every edge once, the check finished last',
    async ({ name, pages: PAGES, edges: EDGES }) => {
      const { check } = largeBuiltSeed();
      await seedRunning(asDb(dbs[name]!), check);
      const sql = underTimeout(names[name]);
      try {
        const input = largeBuiltInput(PAGES, EDGES);
        expect(input.built.link_edges).toHaveLength(EDGES);
        const { port, calls } = timed(pglitePersistDb(asDb(sql)));
        const outcome = await persistBuiltCheck(port, input);
        expect(outcome.written).toBe(true);
        expect(outcome.counts).toMatchObject({ page_results: PAGES, link_edges: EDGES });
        const [{ n }] = (await sql`
          select count(*)::int as n from public.link_edges where check_id = ${check.id}`) as unknown as [
          { n: number },
        ];
        expect(n).toBe(EDGES);
        const kinds = calls.map((c) => c.kind);
        expect(kinds.at(-1)).toBe('persist_built_check');
        expect(kinds.lastIndexOf('edges')).toBeLessThan(kinds.indexOf('persist_built_check'));
        const pieces = calls.filter((c) => c.kind === 'edges');
        for (const c of calls) expect(c.ms, c.kind).toBeLessThan(TIMEOUT_MS);
        for (const c of pieces) expect(c.ms, 'an edge piece').toBeLessThan(PIECE_BOUND_MS);
        const max = (k: string) =>
          Math.round(Math.max(...calls.filter((c) => c.kind === k).map((c) => c.ms)));
        process.stdout.write(
          `F-330 ${name} (${PAGES} pages, ${EDGES} edges): ${pieces.length} edge pieces, the slowest ` +
            `${max('edges')} ms; persist_built_check ${max('persist_built_check')} ms; the slowest ` +
            `stage ${max('stage')} ms\n`,
        );
        // The rest of the check, still one statement: within the CTO's margin (inbox 114).
        expect(max('persist_built_check'), 'persist_built_check without the edges').toBeLessThan(
          FINISH_BOUND_MS,
        );
        // A retried persist step writes no edge twice.
        await persistBuiltCheck(pglitePersistDb(asDb(sql)), input);
        const [{ again }] = (await sql`
          select count(*)::int as again from public.link_edges where check_id = ${check.id}`) as unknown as [
          { again: number },
        ];
        expect(again).toBe(EDGES);
      } finally {
        await sql.end();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'before: the edges inside persist_built_check, one statement, take several pieces’ time',
    async () => {
      const { check } = largeBuiltSeed();
      await seedRunning(asDb(dbs.before!), check);
      const sql = underTimeout(names.before);
      try {
        const input = largeBuiltInput(PAGES, EDGES);
        const calls = persistCalls(input);
        const pdb = pglitePersistDb(asDb(sql));
        // As persist.ts did before F-330: the edges staged, and moved by persist_built_check.
        for (const st of calls.stages) {
          await pdb.stageCheckRows(calls.checkId, st.collection, st.chunk, st.rows);
        }
        const edgeChunks = chunked(calls.edges.flat());
        for (const [i, rows] of edgeChunks.entries()) {
          await pdb.stageCheckRows(calls.checkId, 'link_edges', i, rows);
        }
        const payload = {
          ...calls.payload,
          staged: {
            ...(calls.payload.staged as object),
            link_edges: { chunks: edgeChunks.length, rows: EDGES },
          },
        };
        const t = performance.now();
        const answer = (await pdb.persistBuiltCheck(payload)) as { written: boolean };
        const ms = Math.round(performance.now() - t);
        expect(answer.written).toBe(true);
        process.stdout.write(`F-330 before: persist_built_check with every edge in it ${ms} ms\n`);
        // The one statement production cancelled at 8 s is many times the slowest piece's bound.
        expect(ms).toBeGreaterThan(PIECE_BOUND_MS);
      } finally {
        await sql.end();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
