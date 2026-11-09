/**
 * The batch steps: post, poll, read and failBatch (D1; plan §10 findings 2, 3 and 12).
 *
 * post. A batch whose row exists was posted by an earlier attempt: the worker is asked for it first,
 * and if it holds it the batch counts as posted. Otherwise the batch is planned from what the check
 * has stored (nextCrawlBatch, or the access sample's stage), its max_seconds cut to the time left,
 * its row written with this attempt's nonce, and posted. `batch_exists` counts as posted; `busy` and
 * `paused` are returned for the orchestration to wait on or end with; a timeout, a network error or
 * a 5xx asks the worker whether the batch arrived, and throws (so the step retries) when it did not.
 * An attempt that returns writes the heartbeat of a running check; one that throws writes none.
 *
 * read. The result is checked against the contract and against the batch it should be, stored
 * gzipped, and its row marked done with a summary of counts and the worker release its rows name. A
 * row already done answers with that summary, without asking the worker.
 */
import { nextCrawlBatch, sample, type Sample } from '@crawlmouse/engine/v2/pipeline';
import { BatchResultSchema, type BatchResult } from '@crawlmouse/types/v2';
import { z } from 'zod';
import type { BatchAt, CheckSteps, PostOutput, RunSoFar } from '../../../../../../inngest/check';
import { CheckFailure, type CheckRequested } from '../../../../../../inngest/check-events';
import {
  WorkerError,
  batchIdOf,
  type BatchPost,
  type WorkerClient,
  type WorkerErrorKind,
} from '../../../worker-client/types';
import { putJson } from '../evidence';
import { ACCESS_BATCH_BUDGET, CRAWL_BATCH_BUDGET } from '../limits';
import type { StepDeps } from './deps';
import { phaseOf, progressOf } from './progress';
import { batchSeconds, phaseEndsAt } from './time';
import { assembledSoFar, isCrawl, iso, loadResults, loadSeeds, pathOf, releaseOf } from './stored';

/** A post's summary until the batch is read: what was asked and how long it was given. */
const PlannedSchema = z.object({ urls: z.int().min(1), max_seconds: z.int().min(1) });

/** A read batch's summary, as `read` writes it on the row. */
const ReadSummarySchema = z.strictObject({
  pages: z.int().min(0),
  links: z.int().min(0),
  access_tests: z.int().min(0),
  partial: z.boolean(),
  release: z.string().nullable(),
});

/** The worker did not answer; asking it again may. */
const TRANSIENT: ReadonlySet<WorkerErrorKind> = new Set(['timeout', 'network', 'server']);

type Planned =
  | { kind: 'crawl'; urls: string[] }
  | { kind: 'access'; pages: { url: string; template_key: string }[] }
  | { none: Extract<PostOutput, { status: 'none' }>['why'] };

/** An access stage's pages from the sample. */
export function stagePages(s: Sample, stage: 1 | 2): Planned {
  if (stage === 2 && s.stage2_needed !== true) return { none: 'not_needed' };
  const picked = stage === 1 ? s.stage1 : s.stage2;
  if (picked.length === 0) return { none: 'done' };
  return {
    kind: 'access',
    pages: picked.map((p) => ({ url: p.url, template_key: p.template_key })),
  };
}

/** What a batch result adds to the run. */
export function countsOf(result: BatchResult) {
  return {
    pages: isCrawl(result) ? result.pages.filter((p) => p.outcome === 'fetched').length : 0,
    links: isCrawl(result) ? result.link_edges.length : 0,
    access_tests: isCrawl(result) ? 0 : result.access_tests.length,
    partial: result.partial !== null,
  };
}

export function batchSteps(
  deps: StepDeps,
): Pick<CheckSteps, 'post' | 'poll' | 'read' | 'failBatch'> {
  /** The worker client; a missing or unbuildable one fails the check, non-retriably. */
  const workerOf = (): WorkerClient => {
    let worker: WorkerClient | null;
    try {
      worker = deps.worker();
    } catch (e) {
      // The client's construction errors name the variable, never its value.
      throw new CheckFailure('worker_unavailable', { cause: e });
    }
    if (worker === null) throw new CheckFailure('worker_unavailable');
    return worker;
  };
  const found = (s: string) => s === 'running' || s === 'done' || s === 'failed';

  async function plan(event: CheckRequested, at: BatchAt): Promise<Planned> {
    const [seeds, results] = await Promise.all([loadSeeds(deps, event), loadResults(deps, event)]);
    if (at.kind === 'crawl') {
      const urls = nextCrawlBatch(seeds, results.filter(isCrawl), event.pageCap);
      return urls === null ? { none: 'done' } : { kind: 'crawl', urls };
    }
    const { assembled } = await assembledSoFar(deps, event, seeds, results);
    return stagePages(sample(assembled), at.stage ?? 1);
  }

  /** True when the worker took the batch; otherwise the output the orchestration acts on. */
  async function send(
    worker: WorkerClient,
    body: BatchPost,
    id: string,
  ): Promise<true | Extract<PostOutput, { status: 'busy' | 'paused' }>> {
    try {
      await worker.postBatch(body);
      return true;
    } catch (e) {
      if (!(e instanceof WorkerError)) throw e;
      if (e.kind === 'batch_exists') return true;
      if (e.kind === 'busy') return { status: 'busy', at: deps.now() };
      if (e.kind === 'paused') return { status: 'paused' };
      if (TRANSIENT.has(e.kind)) {
        if (found((await worker.pollBatch(id)).status)) return true;
        throw e;
      }
      if (e.kind === 'unauthorized' || e.kind === 'forbidden') {
        throw new CheckFailure('worker_unavailable', { cause: e });
      }
      if (e.kind === 'invalid' || e.kind === 'too_large') {
        throw new CheckFailure('internal', { cause: e });
      }
      // nonce_replayed: the step's retry draws a fresh nonce.
      throw e;
    }
  }

  const progress = (event: CheckRequested, at: BatchAt, so: RunSoFar, now: number) =>
    deps.store.progress(event.checkId, progressOf(phaseOf(at), so, now - so.startedAt), iso(now));

  /** One post attempt: the batch the worker holds already, or one planned and posted now. */
  async function attempt(event: CheckRequested, at: BatchAt, so: RunSoFar): Promise<PostOutput> {
    const worker = workerOf();
    const id = batchIdOf(event.checkId, at.batch);
    const row = await deps.store.batch(event.checkId, at.batch);
    if (row?.status === 'posted' && found((await worker.pollBatch(id)).status)) {
      const planned = PlannedSchema.parse(row.summary);
      return {
        status: 'posted',
        urls: planned.urls,
        at: Date.parse(row.posted_at),
        max_seconds: planned.max_seconds,
      };
    }

    const planned = await plan(event, at);
    if ('none' in planned) return { status: 'none', why: planned.none };
    const now = deps.now();
    const budget = at.kind === 'crawl' ? CRAWL_BATCH_BUDGET : ACCESS_BATCH_BUDGET;
    const seconds = batchSeconds(phaseEndsAt(at, so), now, budget.max_seconds);
    if (seconds === null) return { status: 'none', why: 'no_time' };

    const nonce = deps.nonce();
    const urls = planned.kind === 'crawl' ? planned.urls.length : planned.pages.length;
    await deps.store.upsertBatch({
      check_id: event.checkId,
      batch: at.batch,
      kind: at.kind,
      nonce,
      posted_at: iso(now),
      summary: { urls, max_seconds: seconds },
    });
    const common = {
      check_id: event.checkId,
      site_id: event.siteId,
      site_host: new URL(event.homepageUrl).hostname,
      batch: at.batch,
      nonce,
      budget: { ...budget, max_seconds: seconds },
    };
    const body: BatchPost =
      planned.kind === 'crawl'
        ? { ...common, kind: 'crawl', urls: planned.urls }
        : { ...common, kind: 'access', pages: planned.pages };
    const sent = await send(worker, body, id);
    if (sent !== true) return sent;
    return { status: 'posted', urls, at: now, max_seconds: seconds };
  }

  return {
    async post(event, at, so) {
      const out = await attempt(event, at, so);
      // An attempt that returns writes the heartbeat (one that throws writes none): a worker
      // answering busy for minutes keeps a check waiting between posts, and the reaper reads a check
      // without one as stalled (correctness 10).
      await progress(event, at, so, deps.now());
      return out;
    },

    async poll(event, at, so) {
      const worker = workerOf();
      let status: Awaited<ReturnType<CheckSteps['poll']>>['status'];
      try {
        status = (await worker.pollBatch(batchIdOf(event.checkId, at.batch))).status;
      } catch (e) {
        if (!(e instanceof WorkerError && TRANSIENT.has(e.kind))) throw e;
        status = 'unreachable';
      }
      const now = deps.now();
      await progress(event, at, so, now);
      return { status, at: now };
    },

    async read(event, at, so) {
      // A read retried after it stored the result and marked the row done: the worker may no longer
      // hold the batch (restarted on the same release), so the row's summary is the answer.
      const row = await deps.store.batch(event.checkId, at.batch);
      if (row?.status === 'done' && row.result_path !== null) {
        return { status: 'read', ...ReadSummarySchema.parse(row.summary) };
      }
      const worker = workerOf();
      const id = batchIdOf(event.checkId, at.batch);
      const got = await worker.pollBatch(id);
      if (got.status === 'not_found') return { status: 'not_found' };
      if (got.status !== 'done') throw new Error(`batch ${at.batch} is ${got.status} at read`);
      const parsed = BatchResultSchema.safeParse(got.result);
      if (!parsed.success) throw new CheckFailure('internal', { cause: parsed.error });
      const result = parsed.data;
      if (
        result.kind !== at.kind ||
        result.batch_id !== id ||
        result.check_id !== event.checkId ||
        result.site_id !== event.siteId
      ) {
        throw new CheckFailure('internal');
      }

      const path = pathOf(event, `batch-${at.batch}`);
      await putJson(deps.evidence, path, result);
      const counts = countsOf(result);
      const release = releaseOf(result);
      const now = deps.now();
      await deps.store.endBatch(event.checkId, at.batch, {
        status: 'done',
        finished_at: iso(now),
        summary: { ...counts, release },
        result_path: path,
      });
      await progress(
        event,
        at,
        {
          ...so,
          pagesCrawled: so.pagesCrawled + counts.pages,
          linksFound: so.linksFound + counts.links,
        },
        now,
      );
      return { status: 'read', ...counts, release };
    },

    async failBatch(event, at) {
      await deps.store.endBatch(event.checkId, at.batch, {
        status: 'failed',
        finished_at: iso(deps.now()),
      });
      return {};
    },
  };
}
