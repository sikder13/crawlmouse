/**
 * checkFn, `crawlmouse.check.run` (CC-20b D1, D3): the order of a check's steps, the polling of the
 * worker's batches, and the deadlines. What each step does is injected (`CheckSteps`, built in
 * apps/web/lib/v2/pipeline/steps), the pattern setAuditFailureReporter uses, so this package imports
 * nothing from the app.
 *
 * Replays. Inngest runs the function again from the top for each new step, returning the recorded
 * output of the steps already run. So runCheck reads no clock, no random value and no environment:
 * the times it compares come out of steps, and it branches on step outputs (the replay test in
 * check.test.ts moves the system clock between invocations).
 *
 * Step order: claim (with `claim-wait-{i}` / `claim-{i}` while the site is busy) → discover → crawl
 * batches `crawl-{n}` → access batches `access-{stage}` → render → build → persist → emit →
 * finalize. A batch is `{p}-post` (busy: `{p}-post-busy-{k}`, `{p}-post-{k}`), then `{p}-wait-{i}` and
 * `{p}-poll-{i}` until the batch is done, failed or past its deadline, then `{p}-read`. A batch the
 * worker lost is posted once more (`{p}-repost`), read as `{p}-read-2`; a second loss or the deadline
 * is `{p}-fail`, and the phase ends there. Batch numbers are one sequence over the check.
 */
import { NonRetriableError } from 'inngest';
import { inngest } from './client';
import { checkConcurrencyLimit } from './concurrency';
import {
  CheckFailure,
  checkFailedEventId,
  checkFinishedEventId,
  failureReasonOf,
  type CheckFailed,
  type CheckFinished,
  type CheckRequested,
  type FailureReason,
} from './check-events';

export const CHECK_FN_ID = 'crawlmouse.check.run';
export const CHECK_CANCELLED_FN_ID = 'crawlmouse.check.cancelled';

/** The orchestration's waits and bounds, in seconds unless named otherwise. */
export const PACE = {
  /** The first wait before a batch is polled: a small batch is often done within seconds. */
  pollStartS: 5,
  /** The wait doubles up to this and stays there: a long batch costs one poll per 30 s. */
  pollMaxS: 30,
  /**
   * A batch is lost once it is past its max_seconds by this much: the worker starts no request after
   * max_seconds, the one in flight has up to its 30 s ceiling (worker MAX_REQUEST_MS), and the
   * result is then stored.
   */
  pollGraceS: 60,
  /** The wait after the worker answered busy (it runs two batches at once). */
  busyWaitS: 30,
  /** Busy answers to one post before the batch is given up: ten minutes of waiting. */
  busyRetries: 20,
  /** The wait for the site's running check to end before claiming again, and how many times. */
  claimWaitS: 60,
  claimWaits: 5,
  /** The run's finish timeout: 20 minutes (ARCH-2 §4.2). */
  finishS: 1200,
  /** Crawl batches per check: 40 × 50 URLs is 2,000, the largest page cap in FACTS. */
  maxCrawlBatches: 40,
} as const;

/** runCheck's steps return under this many bytes as JSON (`sized`, ARCH-2 §4.2); bulk data is stored. */
export const STEP_OUTPUT_BYTES = 4096;

export type BatchKind = 'crawl' | 'access';

/** Which batch a step is about: its worker batch number, and the access stage (null for crawl). */
export interface BatchAt {
  kind: BatchKind;
  batch: number;
  stage: 1 | 2 | null;
}

/** What the steps after claim are told of the run: plain values out of earlier steps. */
export interface RunSoFar {
  /** The first claim attempt's time, ms since the epoch: the time plan's zero. */
  startedAt: number;
  /** When discovery ended and the crawl phase began; null until then. */
  crawlFrom: number | null;
  pagesCrawled: number;
  linksFound: number;
  /** The worker release of the check's first batch read; null before one is read. */
  release: string | null;
}

export type ClaimOutput = { outcome: 'claimed' | 'site_busy' | 'gone' | 'paused'; at: number };
export type DiscoverOutput = { seeds: number; sitemap_urls: number; at: number };
export type PostOutput =
  | { status: 'posted'; urls: number; at: number; max_seconds: number }
  | { status: 'busy'; at: number }
  | { status: 'paused' }
  /** Nothing to post: the crawl is done, stage 2 is not needed, or too little time is left. */
  | { status: 'none'; why: 'done' | 'not_needed' | 'no_time' };
export type PollOutput = {
  /** `unreachable`: the worker did not answer this time; the batch is polled on until its deadline. */
  status: 'running' | 'done' | 'failed' | 'not_found' | 'unreachable';
  at: number;
};
export type ReadOutput =
  | {
      status: 'read';
      pages: number;
      links: number;
      access_tests: number;
      partial: boolean;
      /** The worker release the batch's rows name; null when it holds none. */
      release: string | null;
    }
  /** The worker no longer holds the batch (restarted, or its 60-minute TTL passed). */
  | { status: 'not_found' };
export type RenderOutput = { rendered: number; not_rendered: number };
export type BuildOutput = { status: 'finished' | 'partial'; pages: number; fixes: number };
export type PersistOutput = { written: boolean };
/** Whether the call failed the check, and if so the site the database holds it under. */
export type FailOutput = { failed: false } | { failed: true; siteId: string };
type Empty = Record<string, never>;

/**
 * The step bodies. Each takes the event's data and plain values, does its work against the database,
 * Storage, the worker or the engine, and returns a small JSON summary.
 */
export interface CheckSteps {
  claim(
    event: CheckRequested,
    run: { runId: string; startedAt: number | null },
  ): Promise<ClaimOutput>;
  discover(event: CheckRequested, so: RunSoFar): Promise<DiscoverOutput>;
  /** Also a re-post: a batch whose row exists is asked for first, then posted with a fresh nonce. */
  post(event: CheckRequested, at: BatchAt, so: RunSoFar): Promise<PostOutput>;
  poll(event: CheckRequested, at: BatchAt, so: RunSoFar): Promise<PollOutput>;
  read(event: CheckRequested, at: BatchAt, so: RunSoFar): Promise<ReadOutput>;
  failBatch(event: CheckRequested, at: BatchAt): Promise<Empty>;
  render(event: CheckRequested, so: RunSoFar): Promise<RenderOutput>;
  build(event: CheckRequested, so: RunSoFar): Promise<BuildOutput>;
  persist(event: CheckRequested): Promise<PersistOutput>;
  finalize(event: CheckRequested): Promise<Empty>;
  /** Marks the check failed unless it has ended; `failed` says whether it is failed with `reason`. */
  fail(event: CheckRequested, reason: FailureReason): Promise<FailOutput>;
}

/** The part of Inngest's `step` the orchestration uses. */
export interface CheckStepTools {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
  /** `ms` milliseconds. */
  sleep(id: string, ms: number): Promise<void>;
  sendEvent(
    id: string,
    payload:
      | { id: string; name: 'check.finished'; data: CheckFinished }
      | { id: string; name: 'check.failed'; data: CheckFailed },
  ): Promise<unknown>;
}

export type CheckRunResult =
  | { status: 'finished' | 'partial' }
  | { status: 'failed'; reason: FailureReason }
  /** The claim found the check gone: cancelled, already ended, or another run's. */
  | { status: 'gone' };

/** Throws, naming the step, when its output is not under STEP_OUTPUT_BYTES as JSON. */
export function sized<T>(id: string, output: T): T {
  const bytes = Buffer.byteLength(JSON.stringify(output) ?? '');
  if (bytes >= STEP_OUTPUT_BYTES) {
    throw new NonRetriableError(
      `step ${id} returned ${bytes} bytes as JSON; a step returns under ${STEP_OUTPUT_BYTES}`,
    );
  }
  return output;
}

type BatchEnd =
  | { end: 'read'; out: Extract<ReadOutput, { status: 'read' }> }
  | { end: 'none' }
  | { end: 'paused' }
  | { end: 'failed' };

export async function runCheck(
  ctx: { event: { data: CheckRequested }; step: CheckStepTools; runId: string },
  steps: CheckSteps,
): Promise<CheckRunResult> {
  const { step, runId } = ctx;
  const data = ctx.event.data;
  const run = <T>(id: string, fn: () => Promise<T>): Promise<T> =>
    step.run(id, async () => sized(id, await fn()));

  const endFailed = async (reason: FailureReason): Promise<CheckRunResult> => {
    const out = await run('fail', () => steps.fail(data, reason));
    if (out.failed) await step.sendEvent('emit-failed', failedEvent(data.checkId, out, reason));
    return { status: 'failed', reason };
  };

  // ── claim ──
  let claim = await run('claim', () => steps.claim(data, { runId, startedAt: null }));
  const startedAt = claim.at;
  for (let i = 1; claim.outcome === 'site_busy' && i <= PACE.claimWaits; i++) {
    await step.sleep(`claim-wait-${i}`, PACE.claimWaitS * 1000);
    claim = await run(`claim-${i}`, () => steps.claim(data, { runId, startedAt }));
  }
  if (claim.outcome === 'gone') return { status: 'gone' };
  if (claim.outcome === 'paused') return endFailed('paused');
  if (claim.outcome === 'site_busy') return endFailed('site_busy');

  const so: RunSoFar = {
    startedAt,
    crawlFrom: null,
    pagesCrawled: 0,
    linksFound: 0,
    release: null,
  };
  const soFar = (): RunSoFar => ({ ...so });
  so.crawlFrom = (await run('discover', () => steps.discover(data, soFar()))).at;

  // ── one batch: post, poll to its deadline, read; one re-post when the worker lost it ──
  const post = async (prefix: string, at: BatchAt): Promise<PostOutput> => {
    for (let k = 0; ; k++) {
      const out = await run(k === 0 ? prefix : `${prefix}-${k}`, () =>
        steps.post(data, at, soFar()),
      );
      if (out.status !== 'busy') return out;
      if (k === PACE.busyRetries) return { status: 'none', why: 'no_time' };
      await step.sleep(`${prefix}-busy-${k + 1}`, PACE.busyWaitS * 1000);
    }
  };

  const fail = async (p: string, at: BatchAt): Promise<BatchEnd> => {
    await run(`${p}-fail`, () => steps.failBatch(data, at));
    return { end: 'failed' };
  };

  const runBatch = async (p: string, at: BatchAt): Promise<BatchEnd> => {
    let posted = await post(`${p}-post`, at);
    let reposted = false;
    let polls = 0;
    for (;;) {
      if (posted.status === 'paused') return { end: 'paused' };
      if (posted.status !== 'posted') return reposted ? fail(p, at) : { end: 'none' };
      const deadline = posted.at + (posted.max_seconds + PACE.pollGraceS) * 1000;
      let wait: number = PACE.pollStartS;
      let poll: PollOutput;
      do {
        polls += 1;
        await step.sleep(`${p}-wait-${polls}`, wait * 1000);
        wait = Math.min(wait * 2, PACE.pollMaxS);
        poll = await run(`${p}-poll-${polls}`, () => steps.poll(data, at, soFar()));
      } while ((poll.status === 'running' || poll.status === 'unreachable') && poll.at < deadline);

      if (poll.status === 'done') {
        const read = await run(reposted ? `${p}-read-2` : `${p}-read`, () =>
          steps.read(data, at, soFar()),
        );
        if (read.status === 'read') return { end: 'read', out: read };
      }
      const lost = poll.status === 'not_found' || poll.status === 'done';
      if (!lost || reposted) return fail(p, at);
      reposted = true;
      posted = await post(`${p}-repost`, at);
    }
  };
  /** A read batch adds to the run; a batch from another release than the first fails the check. */
  const take = (out: Extract<ReadOutput, { status: 'read' }>): boolean => {
    if (out.release !== null && so.release !== null && out.release !== so.release) return false;
    so.release ??= out.release;
    so.pagesCrawled += out.pages;
    so.linksFound += out.links;
    return true;
  };

  // ── crawl ──
  let batch = 1;
  let crawlRead = 0;
  for (let n = 1; n <= PACE.maxCrawlBatches; n++) {
    const end = await runBatch(`crawl-${n}`, { kind: 'crawl', batch, stage: null });
    if (end.end === 'none') break;
    batch += 1;
    if (end.end === 'paused') return endFailed('paused');
    if (end.end === 'failed') break;
    if (!take(end.out)) return endFailed('worker_redeployed');
    crawlRead += 1;
  }
  if (crawlRead === 0) return endFailed('worker_unavailable');

  // ── access: stage 1, then stage 2 when the post step finds it needed and time is left ──
  for (const stage of [1, 2] as const) {
    const end = await runBatch(`access-${stage}`, { kind: 'access', batch, stage });
    if (end.end === 'none') break;
    batch += 1;
    if (end.end === 'paused') return endFailed('paused');
    if (end.end === 'failed') break;
    if (!take(end.out)) return endFailed('worker_redeployed');
  }

  // ── render, build, persist, finalize, emit ──
  await run('render', () => steps.render(data, soFar()));
  const built = await failingAs('build_failed', () =>
    run('build', () => steps.build(data, soFar())),
  );
  await failingAs('persist_failed', () => run('persist', () => steps.persist(data)));
  // Before finalize: a finalize that fails after the check is persisted cannot cost its event.
  await step.sendEvent('emit', {
    id: checkFinishedEventId(data.checkId),
    name: 'check.finished',
    data: {
      checkId: data.checkId,
      siteId: data.siteId,
      accountId: data.accountId,
      status: built.status,
    },
  });
  await run('finalize', () => steps.finalize(data));
  return { status: built.status };
}

/** check.failed for a check a fail step failed, naming the site the database holds it under. */
function failedEvent(
  checkId: string,
  out: Extract<FailOutput, { failed: true }>,
  reason: FailureReason,
) {
  return {
    id: checkFailedEventId(checkId),
    name: 'check.failed' as const,
    data: { checkId, siteId: out.siteId, reason },
  };
}

/**
 * A step's failure, once its retries are spent, as this phase's reason. A CheckFailure keeps its own
 * reason and is passed on as it came, which Inngest does not retry.
 */
async function failingAs<T>(reason: FailureReason, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (failureReasonOf(error) !== 'internal') throw error;
    throw new CheckFailure(reason, { cause: error });
  }
}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * checkFn. `steps` is called once per invocation, so the deps are built where the step runs.
 * onFailure calls `fail` and never `steps`: failing a check needs the database only, so a dependency
 * the steps need and cannot build does not keep a failed check from being marked failed.
 * Concurrency: one check per site at a time, and an account-wide limit under the plan cap
 * (concurrency.ts). Inngest counts executing steps, so a run asleep between polls holds no slot:
 * `claim_check` keeps one check per site running in the database (plan §10, finding 1).
 */
export function createCheckFn(
  steps: () => CheckSteps,
  fail: (checkId: string, reason: FailureReason) => Promise<FailOutput>,
  env: Env = process.env,
) {
  return inngest.createFunction(
    {
      id: CHECK_FN_ID,
      concurrency: [{ key: 'event.data.siteId', limit: 1 }, { limit: checkConcurrencyLimit(env) }],
      idempotency: 'event.data.checkId',
      timeouts: { finish: `${PACE.finishS / 60}m` },
      retries: 2,
      cancelOn: [{ event: 'check.cancel.requested', match: 'data.checkId' }],
      onFailure: async ({ event, error, step }) => {
        const { checkId } = event.data.event.data;
        const reason = failureReasonOf(error);
        const out = await step.run('fail', () => fail(checkId, reason));
        if (out.failed) await step.sendEvent('emit-failed', failedEvent(checkId, out, reason));
      },
    },
    { event: 'check.requested' },
    ({ event, step, runId }) =>
      runCheck(
        {
          event,
          runId,
          step: {
            run: <T>(id: string, fn: () => Promise<T>) => step.run(id, fn) as Promise<T>,
            sleep: (id, ms) => step.sleep(id, ms),
            sendEvent: (id, payload) => step.sendEvent(id, payload),
          },
        },
        steps(),
      ),
  );
}

/** The check a cancelled run had claimed, when `fail_check` moved it to failed. */
export type CancelledCheck = { checkId: string; siteId: string };

/**
 * `crawlmouse.check.cancelled`: a cancelled checkFn run (check.cancel.requested, or the finish
 * timeout: Inngest reports both as `inngest/function.cancelled`, whose payload names only the
 * function and the run) fails the check that run claimed, with `canceled`, and sends check.failed
 * when that moved it. onFailure does not run for a cancelled run.
 */
export function createCheckCancelledFn(
  failCancelled: (runId: string) => Promise<CancelledCheck | null>,
) {
  return inngest.createFunction(
    { id: CHECK_CANCELLED_FN_ID, retries: 2 },
    {
      event: 'inngest/function.cancelled',
      if: `event.data.function_id == '${inngest.id}-${CHECK_FN_ID}'`,
    },
    async ({ event, step }) => {
      const failed = await step.run('fail', () => failCancelled(event.data.run_id));
      if (failed) {
        await step.sendEvent(
          'emit-failed',
          failedEvent(failed.checkId, { failed: true, siteId: failed.siteId }, 'canceled'),
        );
      }
      return { failed: failed !== null };
    },
  );
}
