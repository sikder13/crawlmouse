/**
 * What the check pipeline reads and writes in Postgres, outside persistence (persist.ts) and the
 * read-back (load.ts). Claim, fail and reap are migration 008's SQL functions, so the statements that
 * race run as one statement in the database; every other method is one select, insert or update.
 * A list read pages with `.range()` until a short page, so PostgREST's row cap cannot cut it.
 *
 * `test-support/sql-store.ts` is the same interface over PGlite, with the same statements in SQL.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CheckSide, JsTextState } from '@crawlmouse/engine/v2/pipeline';
import {
  JsTextStateSchema,
  type Check,
  type Fix,
  type FixEvent,
  type Site,
} from '@crawlmouse/types/v2';
import type { FailureReason } from '../../../../../inngest/check-events';
import type { ReapedCheck } from '../../../../../inngest/check-reaper';
import { checkFromRow, diffInputsFromRow, fixEventFromRow, fixFromRow, siteFromRow } from './rows';
import type { CrawlBatchRow, CrawlBatchStatus } from './types';

export type ClaimOutcome = 'claimed' | 'site_busy' | 'gone';

/** What requestCheck reads of a site. `next_check_at` is migration 008's. */
export interface RequestSite {
  id: string;
  account_id: string | null;
  host: string;
  next_check_at: string | null;
}

/** A `checks` row requestCheck inserts. */
export interface QueuedCheck {
  id: string;
  site_id: string;
  trigger: Check['trigger'];
  grade_version: string;
  queued_at: string;
  heartbeat_at: string;
  expires_at: string | null;
}

/** A batch row as `post` writes it, before the worker has answered. */
export type PostedBatch = Pick<
  CrawlBatchRow,
  'check_id' | 'batch' | 'kind' | 'nonce' | 'posted_at' | 'summary'
>;

/** How a batch ended: `done` with its stored result, or `failed`. */
export interface BatchEnd {
  status: Extract<CrawlBatchStatus, 'done' | 'failed'>;
  finished_at: string;
  summary?: unknown;
  result_path?: string | null;
}

export interface PipelineStore {
  /** `claim_check`: queued → running with `progress`, or again by the run that claimed it. */
  claim(checkId: string, runId: string, progress: Check['progress']): Promise<ClaimOutcome>;
  /** `fail_check`, by the check's id or by the run that claimed it; true only on the transition. */
  fail(checkId: string | null, reason: FailureReason, runId: string | null): Promise<boolean>;
  /** `reap_stalled_checks`: checks whose heartbeat (or queue time) is before `cutoff`. */
  reap(cutoff: string): Promise<ReapedCheck[]>;
  /** The check a run claimed, if any. */
  checkOfRun(runId: string): Promise<{ checkId: string; siteId: string } | null>;
  /** The heartbeat and progress of a running check. */
  progress(checkId: string, progress: NonNullable<Check['progress']>, at: string): Promise<void>;
  check(checkId: string): Promise<Check>;
  site(siteId: string): Promise<Site>;
  requestSite(siteId: string): Promise<RequestSite>;
  /** The site's latest other check queued no later than this one; null when there is none. */
  previousCheckId(siteId: string, checkId: string, queuedAt: string): Promise<string | null>;
  /** The site's latest other finished or partial check queued no later, with its diff inputs. */
  previousGraded(siteId: string, checkId: string, queuedAt: string): Promise<CheckSide | null>;
  fixes(siteId: string): Promise<Fix[]>;
  fixEvents(fixIds: readonly string[]): Promise<FixEvent[]>;
  /** Each page's `without_js` state in a check, where it was measured. */
  pageStates(checkId: string): Promise<Map<string, JsTextState>>;
  batch(checkId: string, batch: number): Promise<CrawlBatchRow | null>;
  batches(checkId: string): Promise<CrawlBatchRow[]>;
  /** Writes the batch's row as posted, with this attempt's nonce, over an earlier attempt's. */
  upsertBatch(row: PostedBatch): Promise<void>;
  endBatch(checkId: string, batch: number, end: BatchEnd): Promise<void>;
  /** Inserts a queued check unless its id exists; true when it inserted. */
  insertQueued(row: QueuedCheck): Promise<boolean>;
}

/** PostgREST's row cap is 1,000; a page of this size is never cut by it. */
export const PAGE_ROWS = 1000;
/** Ids per `in` filter, so the request URL stays short. */
export const IN_LIST = 100;

type Row = Record<string, unknown>;
type Result<T> = { data: T | null; error: { message: string; code?: string } | null };

function must<T>(what: string, { data, error }: Result<T>): T {
  if (error) throw new Error(`pipeline store: ${what}: ${error.message}`);
  return data as T;
}

/** Every row of a query, page by page until a short page. */
async function paged(
  what: string,
  page: (from: number, to: number) => PromiseLike<Result<Row[]>>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const got = must(what, await page(from, from + PAGE_ROWS - 1)) ?? [];
    rows.push(...got);
    if (got.length < PAGE_ROWS) return rows;
  }
}

const CLAIM_OUTCOMES: readonly string[] = ['claimed', 'site_busy', 'gone'];
const REAP_REASONS: readonly string[] = ['stalled', 'not_started'];

export function supabasePipelineStore(sb: SupabaseClient): PipelineStore {
  return {
    async claim(checkId, runId, progress) {
      const out = must(
        'claim_check',
        await sb.rpc('claim_check', { p_check: checkId, p_run: runId, p_progress: progress }),
      );
      if (typeof out !== 'string' || !CLAIM_OUTCOMES.includes(out)) {
        throw new Error(`pipeline store: claim_check answered ${String(out)}`);
      }
      return out as ClaimOutcome;
    },

    async fail(checkId, reason, runId) {
      const out = must(
        'fail_check',
        await sb.rpc('fail_check', { p_check: checkId, p_reason: reason, p_run: runId }),
      );
      return out === true;
    },

    async reap(cutoff) {
      const rows = must<Row[]>(
        'reap_stalled_checks',
        await sb.rpc('reap_stalled_checks', { p_cutoff: cutoff }),
      );
      return (rows ?? []).map((r) => {
        if (!REAP_REASONS.includes(String(r.reason))) {
          throw new Error(`pipeline store: reap_stalled_checks gave reason ${String(r.reason)}`);
        }
        return {
          checkId: String(r.check_id),
          siteId: String(r.site_id),
          reason: r.reason as ReapedCheck['reason'],
        };
      });
    },

    async checkOfRun(runId) {
      const row = must<Row | null>(
        'check of run',
        await sb.from('checks').select('id, site_id').eq('inngest_run_id', runId).maybeSingle(),
      );
      return row ? { checkId: String(row.id), siteId: String(row.site_id) } : null;
    },

    async progress(checkId, progress, at) {
      must(
        'progress',
        await sb
          .from('checks')
          .update({ progress, heartbeat_at: at })
          .eq('id', checkId)
          .eq('status', 'running'),
      );
    },

    async check(checkId) {
      return checkFromRow(
        must('check', await sb.from('checks').select('*').eq('id', checkId).single()),
      );
    },

    async site(siteId) {
      // siteFromRow reads the site's report schedule from the row, under `report_schedules`.
      return siteFromRow(
        must(
          'site',
          await sb.from('sites').select('*, report_schedules(*)').eq('id', siteId).single(),
        ),
      );
    },

    async requestSite(siteId) {
      return must<RequestSite>(
        'request site',
        await sb
          .from('sites')
          .select('id, account_id, host, next_check_at')
          .eq('id', siteId)
          .single(),
      );
    },

    async previousCheckId(siteId, checkId, queuedAt) {
      const row = must<Row | null>(
        'previous check',
        await sb
          .from('checks')
          .select('id')
          .eq('site_id', siteId)
          .neq('id', checkId)
          .lte('queued_at', queuedAt)
          .order('queued_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle(),
      );
      return row ? String(row.id) : null;
    },

    async previousGraded(siteId, checkId, queuedAt) {
      const row = must<Row | null>(
        'previous graded check',
        await sb
          .from('checks')
          .select('*')
          .eq('site_id', siteId)
          .neq('id', checkId)
          .in('status', ['finished', 'partial'])
          .lte('queued_at', queuedAt)
          .order('queued_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle(),
      );
      return row ? graded(row) : null;
    },

    async fixes(siteId) {
      const rows = await paged('fixes', (from, to) =>
        sb.from('site_fixes').select('*').eq('site_id', siteId).order('id').range(from, to),
      );
      return rows.map(fixFromRow);
    },

    async fixEvents(fixIds) {
      const rows: Row[] = [];
      for (let i = 0; i < fixIds.length; i += IN_LIST) {
        const ids = fixIds.slice(i, i + IN_LIST);
        rows.push(
          ...(await paged('fix events', (from, to) =>
            sb.from('fix_events').select('*').in('fix_id', ids).order('id').range(from, to),
          )),
        );
      }
      return rows.map(fixEventFromRow);
    },

    async pageStates(checkId) {
      const rows = await paged('page states', (from, to) =>
        sb
          .from('page_results')
          .select('url, without_js')
          .eq('check_id', checkId)
          .not('without_js', 'is', null)
          .order('url')
          .range(from, to),
      );
      return statesOf(rows);
    },

    async batch(checkId, batch) {
      return must<CrawlBatchRow | null>(
        'batch',
        await sb
          .from('crawl_batches')
          .select('*')
          .eq('check_id', checkId)
          .eq('batch', batch)
          .maybeSingle(),
      );
    },

    async batches(checkId) {
      const rows = await paged('batches', (from, to) =>
        sb.from('crawl_batches').select('*').eq('check_id', checkId).order('batch').range(from, to),
      );
      return rows as unknown as CrawlBatchRow[];
    },

    async upsertBatch(row) {
      must(
        'upsert batch',
        await sb.from('crawl_batches').upsert(
          {
            ...row,
            status: 'posted',
            finished_at: null,
            result_path: null,
          },
          { onConflict: 'check_id,batch' },
        ),
      );
    },

    async endBatch(checkId, batch, end) {
      must(
        'end batch',
        await sb
          .from('crawl_batches')
          .update(end)
          .eq('check_id', checkId)
          .eq('batch', batch)
          .eq('status', 'posted'),
      );
    },

    async insertQueued(row) {
      const inserted = must<Row[]>(
        'insert queued check',
        await sb
          .from('checks')
          .upsert({ ...row, status: 'queued' }, { onConflict: 'id', ignoreDuplicates: true })
          .select('id'),
      );
      return (inserted ?? []).length > 0;
    },
  };
}

/** A finished or partial check row as the next check's diff reads it; null when it stored no diff inputs. */
export function graded(row: Row): CheckSide | null {
  const inputs = diffInputsFromRow(row);
  return inputs === null ? null : { check: checkFromRow(row), ...inputs };
}

/** `page_results.without_js` states by URL. */
export function statesOf(rows: readonly Row[]): Map<string, JsTextState> {
  const states = new Map<string, JsTextState>();
  for (const r of rows) {
    const state = (r.without_js as { state?: unknown } | null)?.state;
    states.set(String(r.url), JsTextStateSchema.parse(state));
  }
  return states;
}
