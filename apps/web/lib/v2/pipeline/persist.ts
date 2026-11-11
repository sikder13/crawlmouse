/**
 * The one writer of a built check (CC-20b D5). The database holds few of the contract's rules (owner
 * ruling 1; RULES_AT_WRITE in apps/web/__tests__/helpers/v2-contract-storage.ts), so every row is
 * parsed again here with its contract schema, and each page joined to the vantage its crawl row
 * carried, before anything is sent.
 *
 * A built check at the page cap measured 5.00 MiB as one request, over the 2 MB bound the owner set
 * (Q11), so the bulk rows (page results, link edges, access tests) are staged first, in chunks of at
 * most CHUNK_BYTES of JSON (stage_check_rows), and one call to persist_built_check (migration 008)
 * then writes the whole check, staged rows included, in one transaction. Once the check is written,
 * staging answers false and persist_built_check {written: false}, so a retried persist step changes
 * nothing.
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
} from '@crawlmouse/types/v2';
import { z } from 'zod';
import { SERVER_EVENTS, type Sender, type ServerEvents } from '../account/events';
import { captureServerEvent } from '../account/server-capture-interim';
import { PERSIST_RPC } from './columns';
import { DiffInputsSchema } from './rows';
import type {
  FixRead,
  PageVantage,
  PersistDb,
  PersistInput,
  PersistOutcome,
  StagedCollection,
} from './types';

/** The function that stages one chunk (migration 008). */
export const STAGE_RPC = 'stage_check_rows';
/** The most JSON one staged chunk carries: half the 2 MB request bound (Q11). */
export const CHUNK_BYTES = 1024 * 1024;
const STAGED: readonly StagedCollection[] = ['page_results', 'link_edges', 'access_tests'];

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

/** The calls that persist a built check: its staged chunks, in order, then the finishing payload. */
export interface PersistCalls {
  checkId: string;
  stages: StageCall[];
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
  const bulk: Record<StagedCollection, unknown[]> = {
    page_results,
    link_edges: z.array(LinkEdgeSchema).parse(built.link_edges),
    access_tests: z.array(AccessTestSchema).parse(built.access_tests),
  };
  const check = CheckSchema.parse(built.check);
  const stages = STAGED.flatMap((collection) =>
    chunked(bulk[collection]).map((rows, chunk) => ({ collection, chunk, rows })),
  );
  return {
    checkId: check.id,
    stages,
    payload: {
      check,
      fixes: z.array(FixSchema).parse(built.fixes),
      fix_events: z.array(FixEventSchema).parse(built.fix_events),
      changes: z.array(ChangeSchema).parse(built.changes),
      lineages: {
        grading: MeasurementLineageSchema.parse(built.lineages.grading),
        fetching: MeasurementLineageSchema.parse(built.lineages.fetching),
      },
      usage_event: built.usage_event === null ? null : UsageEventSchema.parse(built.usage_event),
      diff_inputs: DiffInputsSchema.parse(built.diff_inputs),
      map_path: z.string().min(1).nullable().parse(input.map_path),
      read: ReadSchema.parse(input.read),
      staged: Object.fromEntries(
        STAGED.map((collection) => [
          collection,
          {
            chunks: stages.filter((s) => s.collection === collection).length,
            rows: bulk[collection].length,
          },
        ]),
      ),
    },
  };
}

/** The event a verification sends (owner rulings Q6, Q7), one of the catalogue's server events. */
const FIX_CLOSED = 'fix_closed' satisfies (typeof SERVER_EVENTS)[number];

/**
 * Persists the built check, then sends `fix_closed` for each verification the call wrote, as
 * `account:<id>` of the usage event's account (a site no account keeps has none, and sends nothing),
 * through the product's server sender. A repeated call answers no verifications, so a retried step
 * does not send them twice. No request reaches this step, so no consent cookie can be read here.
 */
export async function persistBuiltCheck(
  db: PersistDb,
  input: PersistInput,
  send: Sender = captureServerEvent,
): Promise<PersistOutcome> {
  const calls = persistCalls(input);
  for (const s of calls.stages) {
    const staged = z
      .boolean()
      .parse(await db.stageCheckRows(calls.checkId, s.collection, s.chunk, s.rows));
    // False: the check is written already, and persist_built_check will say so.
    if (!staged) break;
  }
  const outcome = OutcomeSchema.parse(await db.persistBuiltCheck(calls.payload));
  const accountId = input.built.usage_event?.account_id ?? null;
  if (accountId !== null) {
    for (const v of outcome.verified) {
      const properties: ServerEvents[typeof FIX_CLOSED] = {
        type: v.type,
        checksToClose: v.checks_to_close,
      };
      await send(FIX_CLOSED, `account:${accountId}`, properties).catch(() => undefined);
    }
  }
  return outcome;
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
  };
}
