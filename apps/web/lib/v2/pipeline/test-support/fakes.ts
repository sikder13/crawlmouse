/**
 * Fakes for the step tests: a PipelineStore in memory that keeps the rules the steps rely on (claim
 * only from queued, fail only from queued or running and true again for the same reason, a batch ended only while posted and never
 * posted again once done), and a
 * WorkerClient that serves batch results the test hands it. PGlite runs the real statements
 * (sql-store.ts); these keep the step tests to the step's own logic.
 */
import type { Check, Fix, FixEvent, Site } from '@crawlmouse/types/v2';
import type { FailureReason } from '../../../../../../inngest/check-events';
import {
  WorkerError,
  batchIdOf,
  type BatchPost,
  type PollResult,
  type WorkerClient,
} from '../../../worker-client/types';
import {
  batchDone,
  type ClaimOutcome,
  type PipelineStore,
  type QueuedCheck,
  type RequestSite,
} from '../store';
import type { CrawlBatchRow } from '../types';

type CheckRow = Check & { inngest_run_id: string | null; heartbeat_at: string | null };

export function queuedCheck(
  id: string,
  siteId: string,
  queuedAt: string,
  gradeVersion: string,
): Check {
  return {
    id,
    site_id: siteId,
    previous_check_id: null,
    status: 'queued',
    trigger: 'manual',
    grade_version: gradeVersion,
    queued_at: queuedAt,
    started_at: null,
    finished_at: null,
    tested_at: null,
    expires_at: null,
    deferred_until: null,
    failure_reason: null,
    result_email: null,
    coverage: null,
    technical_seo: null,
    ai_readability: null,
    structure: null,
    without_js: null,
    content: null,
    signals: [],
    crawlers: [],
    stack: null,
    competitors: [],
    progress: null,
  };
}

export function memoryStore(site: Site, checks: Check[], now: () => string) {
  const rows = new Map<string, CheckRow>(
    checks.map((c) => [c.id, { ...c, inngest_run_id: null, heartbeat_at: null }]),
  );
  const batches = new Map<string, CrawlBatchRow>();
  const key = (c: string, n: number) => `${c}:${n}`;
  const fixes: Fix[] = [];
  const events: FixEvent[] = [];
  const end = (r: CheckRow, reason: FailureReason) =>
    Object.assign(r, {
      status: 'failed',
      failure_reason: reason,
      finished_at: now(),
      started_at: r.started_at ?? now(),
      progress: null,
    });
  const release = (checkId: string) => {
    for (const b of batches.values()) {
      if (b.check_id === checkId && b.status === 'posted') b.status = 'released';
    }
  };

  const store: PipelineStore = {
    async claim(checkId, runId, progress): Promise<ClaimOutcome> {
      const r = rows.get(checkId);
      if (r?.status === 'running' && r.inngest_run_id === runId) return 'claimed';
      if (r?.status !== 'queued') return 'gone';
      const busy = [...rows.values()].some(
        (o) => o.site_id === r.site_id && o.status === 'running',
      );
      if (busy) return 'site_busy';
      Object.assign(r, {
        status: 'running',
        started_at: now(),
        progress,
        inngest_run_id: runId,
        heartbeat_at: now(),
      });
      return 'claimed';
    },
    async fail(checkId, reason, runId) {
      const r = checkId
        ? rows.get(checkId)
        : [...rows.values()].find((o) => o.inngest_run_id === runId);
      // fail_check's answer: true for a check already failed with this reason (a retried call).
      if (r?.status === 'failed' && r.failure_reason === reason) return true;
      if (!r || (r.status !== 'queued' && r.status !== 'running')) return false;
      end(r, reason);
      release(r.id);
      return true;
    },
    async reap() {
      throw new Error('memoryStore: reap is tested on PGlite');
    },
    async checkOfRun(runId) {
      const r = [...rows.values()].find((o) => o.inngest_run_id === runId);
      return r ? { checkId: r.id, siteId: r.site_id } : null;
    },
    async siteOf(checkId) {
      return rows.get(checkId)?.site_id ?? null;
    },
    async progress(checkId, progress, at) {
      const r = rows.get(checkId);
      if (r?.status === 'running') Object.assign(r, { progress, heartbeat_at: at });
    },
    async check(checkId) {
      const r = rows.get(checkId);
      if (!r) throw new Error(`memoryStore: no check ${checkId}`);
      // The contract's Check, without the database-only columns the fake keeps beside it.
      const check: Partial<CheckRow> = { ...r };
      delete check.inngest_run_id;
      delete check.heartbeat_at;
      return check as Check;
    },
    async site() {
      return site;
    },
    async requestSite(): Promise<RequestSite> {
      return { id: site.id, account_id: site.account_id, host: site.host, next_check_at: null };
    },
    async previousGraded() {
      return null;
    },
    async fixes() {
      return fixes;
    },
    async fixEvents() {
      return events;
    },
    async pageStates() {
      return new Map();
    },
    async batch(checkId, n) {
      return batches.get(key(checkId, n)) ?? null;
    },
    async batches(checkId) {
      return [...batches.values()]
        .filter((b) => b.check_id === checkId)
        .sort((a, b) => a.batch - b.batch);
    },
    async upsertBatch(row) {
      if (batches.get(key(row.check_id, row.batch))?.status === 'done') {
        throw batchDone(row.check_id, row.batch);
      }
      batches.set(key(row.check_id, row.batch), {
        ...row,
        status: 'posted',
        finished_at: null,
        result_path: null,
      });
    },
    async endBatch(checkId, n, e) {
      const b = batches.get(key(checkId, n));
      if (b?.status === 'posted') Object.assign(b, e);
    },
    async insertQueued(row: QueuedCheck) {
      if (rows.has(row.id)) return false;
      rows.set(row.id, {
        ...queuedCheck(row.id, row.site_id, row.queued_at, row.grade_version),
        trigger: row.trigger,
        expires_at: row.expires_at,
        inngest_run_id: null,
        heartbeat_at: row.heartbeat_at,
      });
      return true;
    },
  };
  return { store, rows, batches };
}

/**
 * A worker that holds what it was posted and answers polls with `results` (keyed by batch number)
 * once `ready(batch)` says so. `refuse` makes the next posts throw WorkerErrors of those kinds.
 */
export function fakeWorker(results: Map<number, unknown>) {
  const posted: BatchPost[] = [];
  const held = new Map<string, number>();
  const refuse: WorkerError['kind'][] = [];
  const lost = new Set<number>();
  const worker: WorkerClient = {
    async postBatch(batch) {
      const kind = refuse.shift();
      if (kind) throw new WorkerError(kind, null, null);
      const id = batchIdOf(batch.check_id, batch.batch);
      if (held.has(id)) throw new WorkerError('batch_exists', 409, 'batch_exists');
      posted.push(batch);
      held.set(id, batch.batch);
      return { batch_id: id };
    },
    async pollBatch(id): Promise<PollResult> {
      const n = held.get(id);
      if (n === undefined || lost.has(n)) return { status: 'not_found' };
      const result = results.get(n);
      return result === undefined
        ? { status: 'running', progress: {} }
        : { status: 'done', result };
    },
    async readMetrics() {
      return {};
    },
  };
  return { worker, posted, refuse, lost, held };
}
