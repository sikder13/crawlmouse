/**
 * The seams of the check pipeline (CC-20b): the events it sends, a batch's row, what persistence and
 * the read-back take, and where a check's evidence lives. Each implementation is one module of this
 * directory; this file holds no behaviour beyond the evidence path.
 */
import type { BuiltCheck } from '@crawlmouse/engine/v2/pipeline';
import type { CrawlPage, FixtureDataset } from '@crawlmouse/types/v2';
import type { BatchKind } from '../../worker-client/types';

/** The pipeline's events live with the Inngest functions that send and receive them. */
export type {
  CheckCancelRequested,
  CheckFailed,
  CheckFinished,
  CheckRequested,
} from '../../../../../inngest/check-events';

/** One batch of one check: `batch` is the worker's batch number, unique within the check. */
export interface BatchRef {
  checkId: string;
  batch: number;
  kind: BatchKind;
}

/** `crawl_batches.status` (migration 008). */
export type CrawlBatchStatus = 'posted' | 'done' | 'failed' | 'released';

/** A `crawl_batches` row (migration 008), as PostgREST returns it. */
export interface CrawlBatchRow {
  check_id: string;
  batch: number;
  kind: BatchKind;
  nonce: string;
  status: CrawlBatchStatus;
  posted_at: string;
  finished_at: string | null;
  summary: unknown;
  /** The object's path in the `evidence` bucket, once the result is stored. */
  result_path: string | null;
}

/** page_results' vantage columns, which PageResult does not carry: the crawl row's, as fetched. */
export type PageVantage = Pick<
  CrawlPage,
  'identity_sent' | 'source_ip_class' | 'request_headers' | 'headers'
>;

export interface PersistInput {
  built: BuiltCheck;
  /** Every PageResult's vantage, by URL. */
  vantage: ReadonlyMap<string, PageVantage>;
  /** The stored map drawing's path in the `evidence` bucket (D10); null when none was drawn. */
  map_path: string | null;
}

export interface PersistOutcome {
  /** False when the check had been written already: the call changed nothing. */
  written: boolean;
  counts: Readonly<Record<string, number>>;
}

/** The one call persistence makes: the RPC `persist_built_check(p jsonb)` (migration 008). */
export interface PersistDb {
  persistBuiltCheck(payload: unknown): Promise<unknown>;
}

/** The tables the read-back reads. */
export type ReadTable =
  | 'checks'
  | 'sites'
  | 'accounts'
  | 'seats'
  | 'page_results'
  | 'link_edges'
  | 'access_tests'
  | 'site_fixes'
  | 'fix_events'
  | 'changes'
  | 'measurement_lineages'
  | 'usage_events';

/**
 * Rows as PostgREST serialises them (JSON), where `column` is one of `values`. A list is read whole:
 * an implementation pages past PostgREST's row cap rather than return part of a table.
 */
export interface CheckReader {
  rows(
    table: ReadTable,
    column: string,
    values: readonly string[],
  ): Promise<Record<string, unknown>[]>;
}

/**
 * A persisted check as the screens read it: FixtureDataset's collections, with a provenance that says
 * it was measured. FixtureDataset's own provenance can only be "fixture" (types/src/v2/fixture.ts).
 */
export type CheckDataset = Omit<FixtureDataset, 'provenance'> & { provenance: 'measured' };

/** The private bucket a check's batch results, seeds, render, built check and map live in (D7). */
export const EVIDENCE_BUCKET = 'evidence';

export interface EvidenceOwner {
  /** Null for a site no account keeps: its objects live under `anon/`. */
  accountId: string | null;
  siteId: string;
  checkId: string;
}

export type EvidenceName = `batch-${number}` | 'seeds' | 'render' | 'built' | 'map';

/** `{account_id|anon}/{site_id}/{check_id}/{name}.json.gz`, inside EVIDENCE_BUCKET. */
export const evidencePath = (owner: EvidenceOwner, name: EvidenceName): string =>
  `${owner.accountId ?? 'anon'}/${owner.siteId}/${owner.checkId}/${name}.json.gz`;

/** Gzipped JSON objects in EVIDENCE_BUCKET. */
export interface EvidenceStore {
  put(path: string, gzipped: Uint8Array): Promise<void>;
  get(path: string): Promise<Uint8Array>;
  remove(paths: readonly string[]): Promise<void>;
}
