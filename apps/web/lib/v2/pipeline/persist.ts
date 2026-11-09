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
 * nothing. persist.test.ts fails if a non-test file under apps/web, inngest or scripts other than
 * this one writes these rows or calls either function.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
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
  type CrawlPage,
} from '@crawlmouse/types/v2';
import { z } from 'zod';
import { PERSIST_RPC } from './columns';
import { DiffInputsSchema } from './rows';
import type {
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

const OutcomeSchema = z.strictObject({
  written: z.boolean(),
  counts: z.record(z.string(), z.int().min(0)),
});

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

export async function persistBuiltCheck(
  db: PersistDb,
  input: PersistInput,
): Promise<PersistOutcome> {
  const calls = persistCalls(input);
  for (const s of calls.stages) {
    const staged = z
      .boolean()
      .parse(await db.stageCheckRows(calls.checkId, s.collection, s.chunk, s.rows));
    // False: the check is written already, and persist_built_check will say so.
    if (!staged) break;
  }
  return OutcomeSchema.parse(await db.persistBuiltCheck(calls.payload));
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

export function supabasePersistDb(sb: SupabaseClient): PersistDb {
  const call = async (rpc: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(rpc, args);
    if (error) throw new Error(`${rpc}: ${error.code} ${error.message}`);
    return data as unknown;
  };
  return {
    stageCheckRows: (checkId, collection, chunk, rows) =>
      call(STAGE_RPC, { p_check: checkId, p_collection: collection, p_chunk: chunk, p_rows: rows }),
    persistBuiltCheck: (payload) => call(PERSIST_RPC, { p: payload }),
  };
}
