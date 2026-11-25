/**
 * The one writer of a built check (CC-20b D5). The database holds few of the contract's rules (owner
 * ruling 1; RULES_AT_WRITE in apps/web/__tests__/helpers/v2-contract-storage.ts), so every row is
 * parsed again here with its contract schema, and each page joined to the vantage its crawl row
 * carried, before anything is sent.
 *
 * A built check at the page cap measured 5.00 MiB as one request, over the 2 MB bound the owner set
 * (Q11). Its page rows and link edges are written first, in pieces of at most PIECE_ROWS rows and
 * CHUNK_BYTES of JSON, each piece its own request and statement (F-330: one statement for all of them
 * passed production's 8 s `statement_timeout`). The access tests are staged in chunks
 * (stage_check_rows), and one call to persist_built_check (migration 008) then writes the rest of the
 * check and marks it finished, in one transaction. A persist step writes at most PIECES_PER_STEP
 * pieces (`persistStep`), so a dense site's rows take several steps, none near the route's time.
 * A piece skips a row already written, and once the check is written the pieces write nothing,
 * staging answers false and persist_built_check {written: false}: a retried step changes nothing.
 *
 * The watermark (CC-26b D5, migration 20261112000001): the build reads the site's fixes and their
 * events minutes before persist runs, and a member can mark a fix done in between. The payload's
 * `read` names, per fix the build read, the last event it read (`readOfFixes`), and
 * persist_built_check withholds every row of this check about a fix whose last event is now another.
 * The RPC answers the verifications it wrote, and each is captured as `fix_closed` (questions.md Q6).
 *
 * The one-writer guard in persist.test.ts fails when a non-test file under apps/web, inngest, scripts,
 * packages or infra, other than this one and migration 008, writes these tables or calls either
 * function, as the guard's header defines a write: read from the TypeScript AST, a `from(…)` of one of
 * the tables whose result is not at once `.select`ed, or an `rpc(…)` of either function, the name
 * worked out from literals, `const`s and relative imports; and in SQL, an INSERT, UPDATE or DELETE.
 * A name it cannot work out (a parameter, say) it does not see. The guard:
 * pnpm --filter @crawlmouse/web exec vitest run lib/v2/pipeline/persist.test.ts -t "one-writer|only code"
 */
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import {
  AccessTestSchema,
  ChangeSchema,
  CheckSchema,
  CrawlPageSchema,
  FixEventSchema,
  FixSchema,
  LinkEdgeSchema,
  MeasurementLineageSchema,
  PageResultSchema,
  UsageEventSchema,
  instant,
  type CrawlPage,
  type Fix,
  type FixEvent,
  type LinkEdge,
} from '@crawlmouse/types/v2';
import { z } from 'zod';
import {
  SERVER_EVENTS,
  sendWithoutRequest,
  type Sender,
  type ServerEvents,
} from '../account/events';
import { PERSIST_RPC } from './columns';
import { DiffInputsSchema, withCoverageAdded } from './rows';
import type {
  FixRead,
  PageVantage,
  PersistDb,
  PersistInput,
  CheckIdentity,
  PersistOutcome,
  StagedCollection,
} from './types';

/** The function that makes a month's partitions (migration 003), called before the edges (F-330). */
export const PARTITIONS_RPC = 'v2_premake_month_partitions';
/** The function that stages one chunk (migration 008). */
export const STAGE_RPC = 'stage_check_rows';
/** The most JSON one staged chunk carries: half the 2 MB request bound (Q11). */
export const CHUNK_BYTES = 1024 * 1024;
/**
 * The collections staged for persist_built_check. Page rows and link edges are not (F-330): their
 * insert inside persist_built_check, one PostgREST statement, passed production's 8 s
 * `statement_timeout` for the edges, and took 3,460 ms of it for 2,000 page rows on production's
 * first 2,000-page save. They are written first, in pieces (`PIECE_ROWS`).
 */
const STAGED: readonly StagedCollection[] = ['access_tests'];
/**
 * The most rows one piece writes (F-330), each piece its own request and statement under
 * PostgREST's 8 s timeout. A piece is also bounded by CHUNK_BYTES of JSON. Production's first
 * 2,000-page save wrote its edges in 21 pieces, the slowest 2,257 ms (a2/evidence/prod-2000).
 * Measured on CI in scripts/db/persist-edges.test.ts against a real Postgres with an 8 s timeout.
 */
export const PIECE_ROWS = 2_000;
/**
 * The most pieces one persist step writes. At production's slowest piece measured (2,257 ms), 50 are
 * 113 s of inserts, which leaves at least 180 s of the Inngest route's 300 s (`maxDuration`,
 * app/api/webhooks/inngest/route.ts) for reading the built check from Storage and the finishing
 * call. At production's mean piece (509 ms) they are 25 s. A check whose rows are more pieces than
 * this takes further steps (inngest/check.ts), and a retry repeats one step's pieces, not all.
 */
export const PIECES_PER_STEP = 50;

/** page_results' vantage columns, in the crawl row's own shapes. */
const VantageSchema = z.strictObject({
  identity_sent: CrawlPageSchema.shape.identity_sent,
  source_ip_class: CrawlPageSchema.shape.source_ip_class,
  request_headers: CrawlPageSchema.shape.request_headers,
  headers: CrawlPageSchema.shape.headers,
});

const VerifiedSchema = z.strictObject({
  fix_id: z.uuid(),
  type: z.string().min(1),
  checks_to_close: z.int().min(1),
});

const OutcomeSchema = z.strictObject({
  written: z.boolean(),
  counts: z.record(z.string(), z.int().min(0)),
  // Migration 008's body, which the 026b revert restores, answers no `verified`.
  verified: z.array(VerifiedSchema).default([]),
});

const ReadSchema = z.array(
  z.strictObject({ fix_id: z.uuid(), last_event_id: z.uuid().nullable() }),
);

/**
 * What a build read of the site's fixes: each fix, with the id of its last event as the engine orders
 * a fix's events (by time, then by id; packages/engine/src/v2/diff/diff.ts), or null for none. The
 * database orders by (at, id) as well, and a uuid compares there as its lowercase text does here.
 */
export function readOfFixes(
  fixes: readonly Pick<Fix, 'id'>[],
  events: readonly Pick<FixEvent, 'id' | 'fix_id' | 'at'>[],
): FixRead[] {
  const last = new Map<string, Pick<FixEvent, 'id' | 'at'>>();
  for (const e of events) {
    const seen = last.get(e.fix_id);
    const later =
      !seen ||
      instant(e.at) > instant(seen.at) ||
      (instant(e.at) === instant(seen.at) && e.id > seen.id);
    if (later) last.set(e.fix_id, e);
  }
  return fixes.map((f) => ({ fix_id: f.id, last_event_id: last.get(f.id)?.id ?? null }));
}

export interface StageCall {
  collection: StagedCollection;
  chunk: number;
  rows: unknown[];
}

/** One request's rows: a piece of the page rows or of the link edges. */
export type Piece =
  | { table: 'page_results'; rows: Record<string, unknown>[] }
  | { table: 'link_edges'; rows: LinkEdge[] };

/**
 * The calls that persist a built check: its page rows and link edges, in pieces, written before
 * the finishing payload; its staged chunks, in order; then the finishing payload.
 */
export interface PersistCalls {
  checkId: string;
  stages: StageCall[];
  /** The page rows, then the edges, each cut into pieces of at most PIECE_ROWS rows and CHUNK_BYTES. */
  pieces: Piece[];
  /** The edges' pieces alone, as `pieces` holds them. */
  edges: LinkEdge[][];
  /** The lineage every page row and edge names (persist_built_check's `fetching`). */
  fetching: unknown;
  /** What persist_built_check holds the built check to; asked before any row is written. */
  identity: CheckIdentity;
  payload: Record<string, unknown>;
}

const encoder = new TextEncoder();

/**
 * `rows` cut into runs of at most `maxBytes` of JSON, in order. A row larger than that on its own is a
 * chunk of its own; the contract's bounds keep every row far below CHUNK_BYTES.
 */
export function chunked(rows: readonly unknown[], maxBytes = CHUNK_BYTES): unknown[][] {
  const out: unknown[][] = [];
  let current: unknown[] = [];
  let bytes = 2; // the array's brackets
  for (const row of rows) {
    const size = encoder.encode(JSON.stringify(row)).length + 1; // and its comma
    if (current.length > 0 && bytes + size > maxBytes) {
      out.push(current);
      current = [];
      bytes = 2;
    }
    current.push(row);
    bytes += size;
  }
  if (current.length > 0) out.push(current);
  return out;
}

/** `rows` cut into pieces of at most `maxRows` rows and CHUNK_BYTES of JSON, in order. */
export function rowPieces<T>(rows: readonly T[], maxRows = PIECE_ROWS): T[][] {
  return chunked(rows).flatMap((chunk) => {
    const out: T[][] = [];
    for (let i = 0; i < chunk.length; i += maxRows) {
      out.push(chunk.slice(i, i + maxRows) as T[]);
    }
    return out;
  });
}

/** `edges` cut into pieces of at most `maxRows` rows and CHUNK_BYTES of JSON, in order. */
export const edgePieces = (edges: readonly LinkEdge[], maxRows = PIECE_ROWS): LinkEdge[][] =>
  rowPieces(edges, maxRows);

/**
 * The built check's rows, each parsed with its contract schema and every page with its vantage, as
 * the calls that persist it. Throws on a row the contract refuses and on a page with no vantage.
 */
export function persistCalls(input: PersistInput): PersistCalls {
  const { built } = input;
  const page_results = z
    .array(PageResultSchema)
    .parse(built.page_results)
    .map((page) => {
      const vantage = input.vantage.get(page.url);
      if (!vantage) throw new Error(`persistBuiltCheck: no vantage for page ${page.url}`);
      return { ...page, ...VantageSchema.parse(vantage) };
    });
  const link_edges = z.array(LinkEdgeSchema).parse(built.link_edges);
  const bulk: Record<StagedCollection, unknown[]> = {
    page_results,
    link_edges,
    access_tests: z.array(AccessTestSchema).parse(built.access_tests),
  };
  // A check built before `coverage.stopped` was kept, and persisted after the deploy, has none.
  const check = CheckSchema.parse({
    ...built.check,
    coverage: withCoverageAdded(built.check.coverage),
  });
  const stages = STAGED.flatMap((collection) =>
    chunked(bulk[collection]).map((rows, chunk) => ({ collection, chunk, rows })),
  );
  const fetching = MeasurementLineageSchema.parse(built.lineages.fetching);
  // The edges are written by row, before persist_built_check reads anything (F-330): one naming
  // another check is refused here, as persist_built_check refused a staged row naming another.
  const other = link_edges.find((e) => e.check_id !== check.id);
  if (other) {
    throw new Error(`persistBuiltCheck: an edge names check ${other.check_id}, not ${check.id}`);
  }
  const edges = edgePieces(link_edges);
  return {
    checkId: check.id,
    stages,
    pieces: [
      ...rowPieces(page_results).map((rows) => ({ table: 'page_results' as const, rows })),
      ...edges.map((rows) => ({ table: 'link_edges' as const, rows })),
    ],
    edges,
    fetching,
    identity: {
      site_id: check.site_id,
      trigger: check.trigger,
      grade_version: check.grade_version,
      queued_at: check.queued_at,
      started_at: check.started_at,
    },
    payload: {
      check,
      fixes: z.array(FixSchema).parse(built.fixes),
      fix_events: z.array(FixEventSchema).parse(built.fix_events),
      changes: z.array(ChangeSchema).parse(built.changes),
      lineages: {
        grading: MeasurementLineageSchema.parse(built.lineages.grading),
        fetching,
      },
      usage_event: built.usage_event === null ? null : UsageEventSchema.parse(built.usage_event),
      diff_inputs: DiffInputsSchema.parse(built.diff_inputs),
      map_path: z.string().min(1).nullable().parse(input.map_path),
      read: ReadSchema.parse(input.read),
      // Page rows and link edges are written before this call (F-330), so none is staged for it.
      staged: {
        ...Object.fromEntries(
          STAGED.map((collection) => [
            collection,
            {
              chunks: stages.filter((s) => s.collection === collection).length,
              rows: bulk[collection].length,
            },
          ]),
        ),
        page_results: { chunks: 0, rows: 0 },
        link_edges: { chunks: 0, rows: 0 },
      },
    },
  };
}

/** The event a verification sends (owner rulings Q6, Q7), one of the catalogue's server events. */
const FIX_CLOSED = 'fix_closed' satisfies (typeof SERVER_EVENTS)[number];

/**
 * Writes pieces [from, to) of `calls`, a request each (F-330). Asks first whether the check may be
 * written: one that does not exist, or that the built check does not match, throws before any row;
 * one that is not running writes nothing (written already, or refused by the finishing call). Each
 * piece skips a row already written, so a retried step repeats its pieces safely. The check is
 * finished only by persist_built_check, after the last piece, and until then the read-back refuses
 * it (load.ts: finished or partial).
 */
async function writePieces(db: PersistDb, calls: PersistCalls, from: number, to: number) {
  if (from >= to) return;
  const target = await db.rowTarget(calls.checkId, calls.fetching, calls.identity);
  if (!target.running) return;
  const named = { check_month: target.checkMonth, lineage_id: target.lineageId };
  for (let i = from; i < to; i++) {
    const piece = calls.pieces[i]!;
    const rows = piece.rows.map((r) => ({ ...r, ...named }));
    if (piece.table === 'page_results') await db.insertPageResults(rows);
    else await db.insertEdges(rows);
  }
}

/**
 * The staged chunks, then persist_built_check, then `fix_closed` for each verification the call
 * wrote, as `account:<id>` of the usage event's account (a site no account keeps has none, and
 * sends nothing), through the product's server sender. A repeated call answers no verifications, so
 * a retried step does not send them twice. No request reaches this step, so no consent cookie can be
 * read here.
 */
async function finishCheck(
  db: PersistDb,
  calls: PersistCalls,
  input: PersistInput,
  send: Sender,
): Promise<PersistOutcome> {
  for (const s of calls.stages) {
    const staged = z
      .boolean()
      .parse(await db.stageCheckRows(calls.checkId, s.collection, s.chunk, s.rows));
    // False: the check is written already, and persist_built_check will say so.
    if (!staged) break;
  }
  const answered = OutcomeSchema.parse(await db.persistBuiltCheck(calls.payload));
  // persist_built_check moved no page row or edge (none was staged): its counts are the rows the
  // pieces sent.
  const sent = (table: Piece['table']) =>
    calls.pieces.filter((p) => p.table === table).reduce((n, p) => n + p.rows.length, 0);
  const outcome = answered.written
    ? {
        ...answered,
        counts: {
          ...answered.counts,
          page_results: sent('page_results'),
          link_edges: sent('link_edges'),
        },
      }
    : answered;
  const accountId = input.built.usage_event?.account_id ?? null;
  if (accountId !== null) {
    for (const v of outcome.verified) {
      const properties: ServerEvents[typeof FIX_CLOSED] = {
        type: v.type,
        checksToClose: v.checks_to_close,
      };
      await send(FIX_CLOSED, accountId, properties).catch(() => undefined);
    }
  }
  return outcome;
}

/** Persists the built check whole: every piece, then the finishing call (`finishCheck`). */
export async function persistBuiltCheck(
  db: PersistDb,
  input: PersistInput,
  send: Sender = sendWithoutRequest,
): Promise<PersistOutcome> {
  const calls = persistCalls(input);
  await writePieces(db, calls, 0, calls.pieces.length);
  return finishCheck(db, calls, input, send);
}

/** What one persist step did: more pieces to write from `next`, or the check's outcome. */
export type PersistStep = { next: number } | { next: null; outcome: PersistOutcome };

/**
 * One persist step (F-330): pieces [from, from + perStep), then, when no piece is left, the
 * finishing call. The pieces are worked out again from the stored built check on every step, the
 * same each time, so a step names where the next one starts and nothing else.
 */
export async function persistStep(
  db: PersistDb,
  input: PersistInput,
  from: number,
  send: Sender = sendWithoutRequest,
  perStep = PIECES_PER_STEP,
): Promise<PersistStep> {
  if (!Number.isInteger(from) || from < 0 || !Number.isInteger(perStep) || perStep < 1) {
    throw new Error(`persistStep: from ${from} and perStep ${perStep} are not a step`);
  }
  const calls = persistCalls(input);
  const to = Math.min(calls.pieces.length, from + perStep);
  await writePieces(db, calls, from, to);
  if (to < calls.pieces.length) return { next: to };
  return { next: null, outcome: await finishCheck(db, calls, input, send) };
}

/**
 * Each fetched crawl row's vantage, by URL. A URL fetched twice takes its last row, as the builder's
 * assemble() reads the batches.
 */
export function pageVantage(pages: readonly CrawlPage[]): Map<string, PageVantage> {
  const vantage = new Map<string, PageVantage>();
  for (const page of pages) {
    if (page.outcome !== 'fetched') continue;
    vantage.set(page.url, {
      identity_sent: page.identity_sent,
      source_ip_class: page.source_ip_class,
      request_headers: page.request_headers,
      headers: page.headers,
    });
  }
  return vantage;
}

/** An rpc's answer: its data, or a throw naming the function, the error's code and its message. */
function answer(rpc: string, { data, error }: { data: unknown; error: PostgrestError | null }) {
  if (error) throw new Error(`${rpc}: ${error.code} ${error.message}`);
  return data;
}

export function supabasePersistDb(sb: SupabaseClient): PersistDb {
  // Each call names its function here, where the one-writer guard in persist.test.ts reads it.
  return {
    stageCheckRows: async (checkId, collection, chunk, rows) =>
      answer(
        STAGE_RPC,
        await sb.rpc(STAGE_RPC, {
          p_check: checkId,
          p_collection: collection,
          p_chunk: chunk,
          p_rows: rows,
        }),
      ),
    persistBuiltCheck: async (payload) =>
      answer(PERSIST_RPC, await sb.rpc(PERSIST_RPC, { p: payload })),
    async rowTarget(checkId, fetching, identity) {
      const l = MeasurementLineageSchema.parse(fetching);
      const found = z
        .array(z.object({ status: z.string(), check_month: z.string() }))
        .max(1)
        .parse(
          answer('checks', await sb.from('checks').select('status, check_month').eq('id', checkId)),
        );
      if (found.length === 0) throw new Error(`persistBuiltCheck: check ${checkId} not found`);
      // In persist_built_check's order: a check that is not running first, then the comparison.
      const { status, check_month: checkMonth } = found[0]!;
      if (status !== 'running') return { running: false, status };
      // persist_built_check's own test of the built check against its row, asked here before any
      // row is written. PostgREST compares the times as timestamptz, to the microsecond.
      let same = sb
        .from('checks')
        .select('id')
        .eq('id', checkId)
        .eq('site_id', identity.site_id)
        .eq('trigger', identity.trigger)
        .eq('grade_version', identity.grade_version)
        .eq('queued_at', identity.queued_at);
      same =
        identity.started_at === null
          ? same.is('started_at', null)
          : same.eq('started_at', identity.started_at);
      if (z.array(z.unknown()).parse(answer('checks', await same)).length !== 1) {
        throw new Error(
          `persistBuiltCheck: the built check's site, trigger, grade version, queue time or start time differs from check ${checkId}`,
        );
      }
      // The month's partitions, as persist_built_check makes them before its first row.
      answer(
        PARTITIONS_RPC,
        await sb.rpc(PARTITIONS_RPC, { p_from: checkMonth, p_through: checkMonth }),
      );
      const key = {
        engine_sha: l.engine_sha,
        detector_ruleset_version: l.detector_ruleset_version,
        crawler_registry_version: l.crawler_registry_version,
        worker_release: l.worker_release,
        population_version: l.population_version,
      };
      // As persist_built_check writes it: its natural key decides, and an existing row is kept.
      answer(
        'measurement_lineages',
        await sb
          .from('measurement_lineages')
          .upsert(
            { id: l.id, ...key, created_at: l.created_at },
            { onConflict: Object.keys(key).join(','), ignoreDuplicates: true },
          ),
      );
      let q = sb
        .from('measurement_lineages')
        .select('id')
        .eq('engine_sha', key.engine_sha)
        .eq('detector_ruleset_version', key.detector_ruleset_version)
        .eq('crawler_registry_version', key.crawler_registry_version);
      q =
        key.worker_release === null
          ? q.is('worker_release', null)
          : q.eq('worker_release', key.worker_release);
      q =
        key.population_version === null
          ? q.is('population_version', null)
          : q.eq('population_version', key.population_version);
      const lineage = z
        .array(z.object({ id: z.uuid() }))
        .length(1)
        .parse(answer('measurement_lineages', await q));
      return { running: true, lineageId: lineage[0]!.id, checkMonth };
    },
    async insertPageResults(rows) {
      answer(
        'page_results',
        await sb.from('page_results').upsert([...rows], {
          onConflict: 'check_id,url_hash,check_month',
          ignoreDuplicates: true,
        }),
      );
    },
    async insertEdges(rows) {
      answer(
        'link_edges',
        await sb.from('link_edges').upsert([...rows], {
          onConflict: 'check_id,from_hash,to_hash,check_month',
          ignoreDuplicates: true,
        }),
      );
    },
  };
}
