/**
 * What the check pipeline reads and writes in Postgres, outside persistence (persist.ts) and the
 * read-back (load.ts). Claim, fail and reap are migration 008's SQL functions, so the statements that
 * race run as one statement in the database; the others are single selects, inserts and updates. A
 * list read repeats its select with `.range()` from where the rows so far end, until an empty page.
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
import { isFailureReason, type FailureReason } from '../../../../../inngest/check-events';
import type { ReapedCheck } from '../../../../../inngest/check-reaper';
import { checkFromRow, diffInputsFromRow, fixEventFromRow, fixFromRow, siteFromRow } from './rows';
import type { CrawlBatchRow, CrawlBatchStatus } from './types';
import { effectiveTier, type EntitlementClock, type Tier } from '../../entitlement-v2';
import { ACCOUNT_CLOCK_COLUMNS, clockFromAccountRow, readAccountClock } from './load-for';

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
  /**
   * `fail_check`, by the check's id or by the run that claimed it: true when the check is failed with
   * `reason` after the call, whether this call moved it or an earlier one with the same reason did (a
   * retried call); false when it had ended otherwise.
   */
  fail(checkId: string | null, reason: FailureReason, runId: string | null): Promise<boolean>;
  /** Row 17: an account's plan at `nowMs`, as its entitlement clock gives it (`effectiveTier`). */
  planOf(accountId: string, nowMs: number): Promise<Tier>;
  /** Row 17: `take_full_render`; true when the check has one of the month's full renders. */
  takeFullRender(accountId: string, checkId: string, limit: number): Promise<boolean>;
  /** Row 17: `give_back_full_render`, for a full render that rendered no page. */
  giveBackFullRender(accountId: string, checkId: string): Promise<void>;
  /**
   * F-260: a check running under `runId` back to queued, as `checks`' constraints require of a queued
   * check (no start, no progress, no run), with its heartbeat at `at` so the reaper counts from now.
   * True when the check is queued with no run after the call: a retried call finds it so. False when
   * it is another run's or has ended, and then nothing is changed.
   */
  requeue(checkId: string, runId: string, at: string): Promise<boolean>;
  /** F-260: a requeued check's batch rows, deleted once their stored results are removed. */
  deleteBatches(checkId: string): Promise<void>;
  /** `reap_stalled_checks`: checks whose heartbeat (or queue time) is before `cutoff`. */
  reap(cutoff: string): Promise<ReapedCheck[]>;
  /** The check a run claimed, if any. */
  checkOfRun(runId: string): Promise<{ checkId: string; siteId: string } | null>;
  /** The site a check belongs to, as its row holds it; null when there is no such check. */
  siteOf(checkId: string): Promise<string | null>;
  /** The heartbeat and progress of a running check. */
  progress(checkId: string, progress: NonNullable<Check['progress']>, at: string): Promise<void>;
  check(checkId: string): Promise<Check>;
  site(siteId: string): Promise<Site>;
  requestSite(siteId: string): Promise<RequestSite>;
  /**
   * The entitlement clock of the account `accountId`, which sets a check's page cap (page-cap.ts). Every
   * store `requestCheck` runs on must read it: there is no default to fall back to.
   */
  accountClock(accountId: string): Promise<EntitlementClock>;
  /**
   * The diff's baseline: the site's other finished or partial check that finished last, with its diff
   * inputs. By `finished_at`, not queue order: claims are not in queue order (correctness 4). Its id
   * is the built check's `previous_check_id` (steps/finish.ts).
   */
  previousGraded(siteId: string, checkId: string): Promise<CheckSide | null>;
  fixes(siteId: string): Promise<Fix[]>;
  fixEvents(fixIds: readonly string[]): Promise<FixEvent[]>;
  /** Each page's `without_js` state in a check, where it was measured. */
  pageStates(checkId: string): Promise<Map<string, JsTextState>>;
  batch(checkId: string, batch: number): Promise<CrawlBatchRow | null>;
  batches(checkId: string): Promise<CrawlBatchRow[]>;
  /**
   * Writes the batch's row as posted, with this attempt's nonce, over an earlier attempt's; throws,
   * writing nothing, when the row is done, so a stored result is never orphaned (correctness 3).
   */
  upsertBatch(row: PostedBatch): Promise<void>;
  endBatch(checkId: string, batch: number, end: BatchEnd): Promise<void>;
  /** Inserts a queued check unless its id exists; true when it inserted. */
  insertQueued(row: QueuedCheck): Promise<boolean>;
  /**
   * A check's status, or null when there is no such check: requestCheck's next-bucket rule for a
   * re-check (CC-28 D11). Optional, so a store written before it still types; a requestCheck whose
   * store lacks it keeps the current bucket.
   */
  checkStatus?(checkId: string): Promise<Check['status'] | null>;
}

/**
 * Rows asked for per page. PostgREST may return fewer (its `max-rows` cap, 1,000 unless the project
 * changes it), so a list reads on from where the last page ended until a page comes back empty.
 */
export const PAGE_ROWS = 1000;
/** Ids per `in` filter, so the request URL stays short. */
export const IN_LIST = 100;

type Row = Record<string, unknown>;
type Result<T> = { data: T | null; error: { message: string; code?: string } | null };

function must<T>(what: string, { data, error }: Result<T>): T {
  if (error) throw new Error(`pipeline store: ${what}: ${error.message}`);
  return data as T;
}

/**
 * Every row of a query: each page starts where the rows so far end, and an empty page ends the list,
 * so a server cap below PAGE_ROWS shortens the pages and never the list.
 */
async function paged(
  what: string,
  page: (from: number, to: number) => PromiseLike<Result<Row[]>>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (;;) {
    const got = must(what, await page(rows.length, rows.length + PAGE_ROWS - 1)) ?? [];
    if (got.length === 0) return rows;
    rows.push(...got);
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
      knownReason(reason);
      const out = must(
        'fail_check',
        await sb.rpc('fail_check', { p_check: checkId, p_reason: reason, p_run: runId }),
      );
      return out === true;
    },

    async planOf(accountId, nowMs) {
      const row = must<Row | null>(
        'account plan',
        await sb.from('accounts').select(ACCOUNT_CLOCK_COLUMNS).eq('id', accountId).maybeSingle(),
      );
      if (!row) throw new Error(`pipeline store: account ${accountId} not found`);
      return effectiveTier(clockFromAccountRow(row), new Date(nowMs));
    },

    async takeFullRender(accountId, checkId, limit) {
      const out = must(
        'take_full_render',
        await sb.rpc('take_full_render', {
          p_account: accountId,
          p_check: checkId,
          p_limit: limit,
        }),
      );
      return out === true;
    },

    async giveBackFullRender(accountId, checkId) {
      must(
        'give_back_full_render',
        await sb.rpc('give_back_full_render', { p_account: accountId, p_check: checkId }),
      );
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

    async siteOf(checkId) {
      const row = must<Row | null>(
        'site of check',
        await sb.from('checks').select('site_id').eq('id', checkId).maybeSingle(),
      );
      return row ? String(row.site_id) : null;
    },

    async requeue(checkId, runId, at) {
      const moved = must<Row[]>(
        'requeue',
        await sb
          .from('checks')
          .update({
            status: 'queued',
            started_at: null,
            progress: null,
            inngest_run_id: null,
            heartbeat_at: at,
          })
          .eq('id', checkId)
          .eq('status', 'running')
          .eq('inngest_run_id', runId)
          .select('id'),
      );
      if ((moved ?? []).length === 0) {
        const now = must<Row[]>(
          'requeue status',
          await sb.from('checks').select('status, inngest_run_id').eq('id', checkId),
        );
        const r = (now ?? [])[0];
        if (r?.status !== 'queued' || r.inngest_run_id !== null) return false;
      }
      return true;
    },

    async deleteBatches(checkId) {
      must('delete batches', await sb.from('crawl_batches').delete().eq('check_id', checkId));
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

    async accountClock(accountId) {
      return readAccountClock(sb, accountId);
    },

    async previousGraded(siteId, checkId) {
      const row = must<Row | null>(
        'previous graded check',
        await sb
          .from('checks')
          .select('*')
          .eq('site_id', siteId)
          .neq('id', checkId)
          .in('status', ['finished', 'partial'])
          .order('finished_at', { ascending: false })
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
      for (const ids of inLists(fixIds)) {
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
      // PostgREST's upsert takes no condition on the row it would write over, so a new row is
      // inserted, and an existing one is written over only while it is not done.
      const posted = { ...row, status: 'posted', finished_at: null, result_path: null };
      const inserted = must<Row[]>(
        'insert batch',
        await sb
          .from('crawl_batches')
          .upsert(posted, { onConflict: 'check_id,batch', ignoreDuplicates: true })
          .select('batch'),
      );
      if ((inserted ?? []).length > 0) return;
      const { check_id: checkId, batch, ...fields } = posted;
      const reposted = must<Row[]>(
        'repost batch',
        await sb
          .from('crawl_batches')
          .update(fields)
          .eq('check_id', checkId)
          .eq('batch', batch)
          .neq('status', 'done')
          .select('batch'),
      );
      if ((reposted ?? []).length === 0) throw batchDone(checkId, batch);
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

    async checkStatus(checkId) {
      const row = must<{ status: Check['status'] } | null>(
        'check status',
        await sb.from('checks').select('status').eq('id', checkId).maybeSingle(),
      );
      return row?.status ?? null;
    },
  };
}

/** upsertBatch's refusal of a done batch. */
export const batchDone = (checkId: string, batch: number): Error =>
  new Error(`pipeline store: batch ${batch} of check ${checkId} is done; it is not posted again`);

/** `ids` in lists of at most IN_LIST, in order. */
export function inLists(ids: readonly string[]): string[][] {
  const lists: string[][] = [];
  ids.forEach((id, i) => {
    if (i % IN_LIST === 0) lists.push([]);
    lists[lists.length - 1]!.push(id);
  });
  return lists;
}

/** `failure_reason` is readable by the site's members: a word from FAILURE_REASONS, nothing else. */
export function knownReason(reason: unknown): asserts reason is FailureReason {
  if (!isFailureReason(reason))
    throw new Error('pipeline store: a failure reason outside FAILURE_REASONS');
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
