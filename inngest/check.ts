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
 * batches `crawl-{n}` → access batches `access-{stage}` → render → build → persist (and
 * `persist-{k}` while rows are left to write) → emit → finalize. A batch is `{p}-post` (busy: `{p}-post-busy-{k}`, `{p}-post-{k}`), then `{p}-wait-{i}` and
 * `{p}-poll-{i}` until the batch is done, failed or past its deadline, then `{p}-read`. A worker
 * that signals a batch's end replaces the wait with `{p}-done-{i}`, and a poll follows only a wait
 * that timed out. A batch the worker lost is posted once more (`{p}-repost`), and a later read is
 * `{p}-read-{n}`; a second loss or the deadline is `{p}-fail`, and the phase ends there. Batch numbers are one sequence over the check.
 */
import { NonRetriableError } from 'inngest';
import { inngest } from './client';
import { checkConcurrencyLimit } from './concurrency';
import {
  CheckFailure,
  checkFailedEventId,
  checkFinishedEventId,
  checkRetryEventId,
  failureReasonOf,
  type CheckFailed,
  type CheckBatchEnded,
  type CheckFinished,
  type CheckRequested,
  type FailureReason,
} from './check-events';

export const CHECK_FN_ID = 'crawlmouse.check.run';
export const CHECK_CANCELLED_FN_ID = 'crawlmouse.check.cancelled';

/**
 * The wait budget (CC-42A, rulings-1 §2): the most of a check's waiting on the worker's `busy`
 * answers that the time plan makes up for, the wait for its first crawl batch and the waits between
 * later batches together. Waiting for the first batch does not run the crawl clock, which starts
 * when the worker accepts that batch; a check whose next wait for it would pass the budget fails
 * `capacity_wait_exceeded`. A wait between later batches is added back to the crawl's end while the
 * budget lasts. Once it is spent a check may still wait on busy answers, uncredited, until its
 * window closes (steps/time.ts); the budget bounds what is added back, not what is waited.
 */
export const QUEUE_WAIT_MAX_S = 900;
/**
 * The most further persist steps a check takes (F-330). At 50 pieces a step of at most 2,000 rows,
 * 40 steps are 4,000,000 rows past the first step's, far past any check the build's bound lets
 * through; a run past it is a fault, and fails persist_failed rather than loop.
 */
export const PERSIST_STEPS_MAX = 40;

/** The orchestration's waits and bounds, in seconds unless named otherwise. */
export const PACE = {
  /** The first wait before a batch is polled: a small batch is often done within seconds. */
  pollStartS: 5,
  /** The wait doubles up to this and stays there: a long batch costs one poll per 30 s. */
  pollMaxS: 30,
  /** The longest a run waits on a worker's done signal before it polls once (PR 5a). */
  signalWaitS: 60,
  /**
   * A batch is lost once it is past its max_seconds by this much: the worker starts no request after
   * max_seconds, the one in flight has up to its 30 s ceiling (worker MAX_REQUEST_MS), and the
   * result is then stored.
   */
  pollGraceS: 60,
  /**
   * The wait after the worker answered busy (it runs BATCH_CONCURRENCY batches at once). What bounds
   * the waiting is time (QUEUE_WAIT_MAX_S, and each phase's end), not a count of these.
   */
  busyWaitS: 30,
  /** The wait for the site's running check to end before claiming again, and how many times. */
  claimWaitS: 60,
  claimWaits: 5,
  /** Discovery's bound on reading robots.txt and the sitemaps (DISCOVER_S in the app's limits). */
  discoverS: 60,
  /**
   * The run's finish timeout: 88 minutes (5,260 s), the plan of the largest page cap (2,000 pages,
   * inbox 079). Its parts: every claim wait (300 s), discovery (60 s), the wait budget
   * (QUEUE_WAIT_MAX_S, 900 s), the crawl (3,400 s), the access slice (300 s) and the reserve (300 s). It is one setting on the
   * function, so it is the largest cap's; a smaller check keeps its own plan inside it
   * (`finishSFor` in the app's limits). steps/time.test.ts recomputes it from those constants.
   */
  finishS: 5260,
  /**
   * Crawl batches per check: 44, so a check reaches the largest page cap (2,000, FACTS) with up to
   * four batches short of 50 URLs. The first batch of a site with no sitemap is its home page alone,
   * and a batch can find fewer new links than it has room for. The worst-case steps
   * (steps/time.test.ts, finding 18) stay under Inngest's 1,000 a run at 44; at 46 they would not.
   */
  maxCrawlBatches: 44,
} as const;

/** A check above this many pages is large: its crawl and reserve grow, and it waits longer (inbox 079). */
export const LARGE_CHECK_ABOVE = 500;

/**
 * The waits a check's run uses, by its page cap. A large check's run lasts up to PACE.finishS, and at
 * 30-second waits its steps could pass Inngest's 1,000 a run (steps/time.test.ts, finding 18), so it
 * polls from 10 s up to 60 s and waits 60 s on a busy worker: three short polls a posting and half
 * the long ones. A batch's done signal still wakes the run at once (PR 5a). A check of 500 pages or
 * fewer keeps PACE's waits.
 */
export function cadenceFor(pageCap: number): {
  pollStartS: number;
  pollMaxS: number;
  busyWaitS: number;
} {
  return pageCap > LARGE_CHECK_ABOVE
    ? { pollStartS: 10, pollMaxS: 60, busyWaitS: 60 }
    : { pollStartS: PACE.pollStartS, pollMaxS: PACE.pollMaxS, busyWaitS: PACE.busyWaitS };
}

/**
 * The latest a check's first crawl batch is taken, in seconds from its first claim attempt, for the
 * finish timeout still to give it a whole crawl window: every claim wait, discovery, then the wait
 * budget. PACE.finishS is this plus the crawl, the access slice and the reserve (steps/time.test.ts).
 */
export const FIRST_ACCEPT_BY_S =
  PACE.claimWaits * PACE.claimWaitS + PACE.discoverS + QUEUE_WAIT_MAX_S;

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
  /** The check's page cap (`CheckRequested.pageCap`): its time plan and waits follow it. */
  pageCap: number;
  /**
   * When the worker accepted the check's first crawl batch: the crawl clock's zero. Null until then;
   * waiting for that batch does not run the clock.
   */
  crawlFrom: number | null;
  pagesCrawled: number;
  linksFound: number;
  /** The worker release of the check's first batch read; null before one is read. */
  release: string | null;
  /** Milliseconds spent on the worker's busy answers so far, before and after `crawlFrom`. */
  busyMs: number;
  /** `busyMs` when the first crawl batch was accepted; what the wait before it cost the budget. */
  busyBeforeCrawlMs: number;
  /** The first busy answer of the current run of them; null while no post is waiting. */
  waitingSince: number | null;
  /** What discovery found that a visitor can read; null until discovery has ended. */
  discovered: { sitemap_urls: number; robots_txt: RobotsStatus | null } | null;
}

/** What discovery's robots.txt request answered (the engine's RobotsStatus, RobotsTxtState). */
export type RobotsStatus = 'found' | 'not_found' | 'unreadable';

/**
 * The claimed check's site as the database holds it: its row's site, and that site's account, host
 * and homepage. The steps after the claim are given these in place of the event's (security 6).
 */
export type ClaimedSite = Pick<CheckRequested, 'siteId' | 'accountId' | 'host' | 'homepageUrl'>;
export type ClaimOutput =
  | { outcome: 'claimed'; at: number; site: ClaimedSite }
  | { outcome: 'site_busy' | 'gone' | 'paused'; at: number };
export type DiscoverOutput = {
  seeds: number;
  sitemap_urls: number;
  robots_txt: RobotsStatus;
  at: number;
};
export type PostOutput =
  /** `signals`: the worker said it will signal this batch's end, so the run can wait for that. */
  | { status: 'posted'; urls: number; at: number; max_seconds: number; signals?: true }
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
  | { status: 'not_found' }
  /** Read on a signal while the worker still runs the batch: nothing is lost, and nothing is read. */
  | { status: 'running' }
  /** Read on a stale signal, and the worker says this batch failed: as a failed poll. */
  | { status: 'failed' };
export type RenderOutput = { rendered: number; not_rendered: number };
export type BuildOutput = { status: 'finished' | 'partial'; pages: number; fixes: number };
/**
 * `next`: the first piece of rows a further persist step writes (F-330), or null when the check is
 * persisted. An output stored by a release before it has none, and reads as null.
 */
export type PersistOutput = { written: boolean; next?: number | null };
/**
 * Whether the check is failed with the reason asked for (by this call, or by an earlier one with the
 * same reason that this call retries), and if so the site the database holds it under.
 */
export type FailOutput = { failed: false } | { failed: true; siteId: string; as?: FailureReason };
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
  /** Writes rows from piece `from` (0 on the first step); the last step also finishes the check. */
  persist(event: CheckRequested, from?: number): Promise<PersistOutput>;
  finalize(event: CheckRequested): Promise<Empty>;
  /** Marks the check failed unless it has ended; `failed` says whether it is failed with `reason`. */
  fail(event: CheckRequested, reason: FailureReason): Promise<FailOutput>;
  /**
   * F-260: the check back to queued, from running under `runId`, with its stored batch results and
   * batch rows deleted; true when it is queued with no run after the call (a retried step finds it
   * so), false when the check is another run's or has ended, and then nothing is changed.
   */
  requeue(event: CheckRequested, runId: string): Promise<{ requeued: boolean }>;
}

/** The part of Inngest's `step` the orchestration uses. */
export interface CheckStepTools {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
  /** `ms` milliseconds. */
  sleep(id: string, ms: number): Promise<void>;
  /** The batch's done signal, or null at the timeout. Absent where no signal can arrive. */
  waitForEvent?(
    id: string,
    opts: { event: 'check.batch.ended'; timeout: string; if: string },
  ): Promise<{ data: CheckBatchEnded } | null>;
  sendEvent(
    id: string,
    payload:
      | { id: string; name: 'check.finished'; data: CheckFinished }
      | { id: string; name: 'check.failed'; data: CheckFailed }
      | { id: string; name: 'check.requested'; data: CheckRequested },
  ): Promise<unknown>;
}

export type CheckRunResult =
  | { status: 'finished' | 'partial' }
  | { status: 'failed'; reason: FailureReason }
  /** The claim found the check gone: cancelled, already ended, or another run's. */
  | { status: 'gone' }
  /** F-260: a worker deploy met this run; the check is queued again and its retry run requested. */
  | { status: 'retried' };

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
  /** The first crawl batch found no free slot within QUEUE_WAIT_MAX_S. */
  | { end: 'capacity' }
  | { end: 'paused' }
  | { end: 'failed' };

export async function runCheck(
  ctx: { event: { data: CheckRequested }; step: CheckStepTools; runId: string },
  steps: CheckSteps,
): Promise<CheckRunResult> {
  const { step, runId } = ctx;
  const event = ctx.event.data;
  const run = <T>(id: string, fn: () => Promise<T>): Promise<T> =>
    step.run(id, async () => sized(id, await fn()));

  const endFailed = async (reason: FailureReason): Promise<CheckRunResult> => {
    const out = await run('fail', () => steps.fail(event, reason));
    if (out.failed) await step.sendEvent('emit-failed', failedEvent(event.checkId, out, reason));
    return { status: 'failed', reason };
  };

  // ── claim ──
  let claim = await run('claim', () => steps.claim(event, { runId, startedAt: null }));
  const startedAt = claim.at;
  for (let i = 1; claim.outcome === 'site_busy' && i <= PACE.claimWaits; i++) {
    await step.sleep(`claim-wait-${i}`, PACE.claimWaitS * 1000);
    claim = await run(`claim-${i}`, () => steps.claim(event, { runId, startedAt }));
  }
  if (claim.outcome !== 'claimed') {
    // `paused` and `site_busy` are the check's failure reasons as they are.
    return claim.outcome === 'gone' ? { status: 'gone' } : endFailed(claim.outcome);
  }
  // The event's site is trusted no further than the claim (security 6): a check whose row names
  // another site fails, and the steps after the claim run on the site the database holds.
  if (claim.site.siteId !== event.siteId) return endFailed('internal');
  const data: CheckRequested = { ...event, ...claim.site };

  const so: RunSoFar = {
    startedAt,
    pageCap: data.pageCap,
    crawlFrom: null,
    pagesCrawled: 0,
    linksFound: 0,
    release: null,
    busyMs: 0,
    busyBeforeCrawlMs: 0,
    waitingSince: null,
    discovered: null,
  };
  const soFar = (): RunSoFar => ({ ...so, discovered: so.discovered && { ...so.discovered } });
  const cadence = cadenceFor(data.pageCap);
  const found = await run('discover', () => steps.discover(data, soFar()));
  // `?? null`: a discover output recorded before robots_txt existed, replayed after the deploy.
  so.discovered = { sitemap_urls: found.sitemap_urls, robots_txt: found.robots_txt ?? null };

  // ── one batch: post, poll to its deadline, read; one re-post when the worker lost it ──
  // A busy answer is waited on and posted again. The time from a post's first busy answer to the
  // answer that ends the wait is charged to `busyMs`; the times are step outputs, so a replay
  // charges the same. The first crawl batch's acceptance starts the crawl clock.
  const post = async (
    prefix: string,
    at: BatchAt,
  ): Promise<PostOutput | { status: 'capacity' }> => {
    let lastBusy: number | null = null;
    for (let k = 0; ; k++) {
      const out = await run(k === 0 ? prefix : `${prefix}-${k}`, () =>
        steps.post(data, at, soFar()),
      );
      if (out.status === 'busy') {
        if (lastBusy !== null) so.busyMs += out.at - lastBusy;
        lastBusy = out.at;
        so.waitingSince ??= out.at;
        // Before its first batch a check gives up when the next wait would pass the budget, or
        // would bring its next post after FIRST_ACCEPT_BY_S from its start, the latest first batch
        // that the finish timeout still gives a whole crawl window. The second matters when every
        // claim wait was used: step latency there is not charged to busyMs (review rounds 1–2,
        // correctness N1). A first batch that is taken is then taken after either bound by no more
        // than the taken post's own latency and the sleep's lateness; time.test.ts checks the
        // crawl it gets at 1, 2, 3 and 5 s a step.
        const nextPost = out.at + cadence.busyWaitS * 1000;
        if (
          so.crawlFrom === null &&
          (so.busyMs + cadence.busyWaitS * 1000 > QUEUE_WAIT_MAX_S * 1000 ||
            nextPost > so.startedAt + FIRST_ACCEPT_BY_S * 1000)
        ) {
          return { status: 'capacity' };
        }
        await step.sleep(`${prefix}-busy-${k + 1}`, cadence.busyWaitS * 1000);
        continue;
      }
      if (out.status === 'posted') {
        if (lastBusy !== null) so.busyMs += out.at - lastBusy;
        if (at.kind === 'crawl' && so.crawlFrom === null) {
          so.crawlFrom = out.at;
          so.busyBeforeCrawlMs = so.busyMs;
        }
      }
      so.waitingSince = null;
      return out;
    }
  };

  const fail = async (p: string, at: BatchAt): Promise<BatchEnd> => {
    await run(`${p}-fail`, () => steps.failBatch(data, at));
    return { end: 'failed' };
  };

  // Whether this run still waits on the worker's signal, and whether one has reached it. Both come
  // from step outputs, so a replay agrees. The first batch to finish after a missed signal puts the
  // run back on polling, so a signal that cannot arrive costs that batch's waits and no later one's.
  let listening = true;
  let heard = false;

  const runBatch = async (p: string, at: BatchAt): Promise<BatchEnd> => {
    let posted = await post(`${p}-post`, at);
    let reposted = false;
    let polls = 0;
    let reads = 0;
    for (;;) {
      if (posted.status === 'capacity') return { end: 'capacity' };
      if (posted.status === 'paused') return { end: 'paused' };
      if (posted.status !== 'posted') return reposted ? fail(p, at) : { end: 'none' };
      const deadline = posted.at + (posted.max_seconds + PACE.pollGraceS) * 1000;
      let wait: number = cadence.pollStartS;
      let poll: PollOutput;
      let lastAt = posted.at;
      do {
        polls += 1;
        const listens = listening && posted.signals === true && step.waitForEvent !== undefined;
        const ended =
          listens && step.waitForEvent
            ? await step.waitForEvent(`${p}-done-${polls}`, {
                event: 'check.batch.ended',
                // Never past the deadline: the time plan allows one poll wait after it. Until a
                // signal has reached this run, no longer than a poll would have waited.
                timeout: `${Math.max(1, Math.min(heard ? PACE.signalWaitS : cadence.pollMaxS, Math.ceil((deadline - lastAt) / 1000)))}s`,
                if: `event.data.checkId == async.data.checkId && async.data.batch == ${at.batch}`,
              })
            : null;
        if (!listens) {
          await step.sleep(`${p}-wait-${polls}`, wait * 1000);
          wait = Math.min(wait * 2, cadence.pollMaxS);
        }
        // A signal of `done` goes straight to the read; anything else is the poll's to decide.
        poll =
          ended?.data.status === 'done'
            ? { status: 'done', at: lastAt }
            : await run(`${p}-poll-${polls}`, () => steps.poll(data, at, soFar()));
        lastAt = poll.at;
        if (ended !== null) heard = true;
        // A `failed` note is the poll's to confirm, once. A wait that timed out on a finished batch
        // is a signal that did not arrive. Either way the rest of the run polls.
        if (ended?.data.status === 'failed' || (listens && !ended && poll.status === 'done')) {
          listening = false;
        }
      } while ((poll.status === 'running' || poll.status === 'unreachable') && poll.at < deadline);

      if (poll.status === 'done') {
        // A read after a re-post is at least the second, whether or not the first post was read.
        reads = Math.max(reads + 1, reposted ? 2 : 1);
        const readId = reads === 1 ? `${p}-read` : `${p}-read-${reads}`;
        const read = await run(readId, () => steps.read(data, at, soFar()));
        if (read.status === 'read') return { end: 'read', out: read };
        if (read.status === 'failed') return fail(p, at);
        if (read.status === 'running') {
          // Signalled early: back to polling, which also bounds a run's steps.
          listening = false;
          continue;
        }
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

  /**
   * F-260: a batch from another worker release than the first means a deploy met this run. The first
   * run of a check is retried once, from the start: the check is queued again and the retry run
   * requested, numbered past every batch this run posted. A retry that meets one fails as before.
   */
  const redeployed = async (): Promise<CheckRunResult> => {
    if (event.retry !== undefined) return endFailed('worker_redeployed');
    const { requeued } = await run('requeue', () => steps.requeue(event, runId));
    // Another run's check, or one already ended: this run fails nothing (QA's gate on #190, F4).
    if (!requeued) return { status: 'gone' };
    await step.sendEvent('retry', {
      id: checkRetryEventId(event.checkId),
      name: 'check.requested',
      data: { ...event, retry: { firstBatch: batch } },
    });
    return { status: 'retried' };
  };

  // ── crawl ──
  let batch = event.retry?.firstBatch ?? 1;
  let crawlRead = 0;
  for (let n = 1; n <= PACE.maxCrawlBatches; n++) {
    const end = await runBatch(`crawl-${n}`, { kind: 'crawl', batch, stage: null });
    if (end.end === 'capacity') return endFailed('capacity_wait_exceeded');
    if (end.end === 'none') break;
    batch += 1;
    if (end.end === 'paused') return endFailed('paused');
    if (end.end === 'failed') break;
    if (!take(end.out)) return redeployed();
    crawlRead += 1;
  }
  if (crawlRead === 0) return endFailed('worker_unavailable');

  // ── access: stage 1, then stage 2 when the post step finds it needed and time is left ──
  for (const stage of [1, 2] as const) {
    const end = await runBatch(`access-${stage}`, { kind: 'access', batch, stage });
    // `capacity` needs a check with no crawl batch accepted, and the crawl above read one.
    if (end.end === 'none' || end.end === 'capacity') break;
    batch += 1;
    if (end.end === 'paused') return endFailed('paused');
    if (end.end === 'failed') break;
    if (!take(end.out)) return redeployed();
  }

  // ── render, build, persist, finalize, emit ──
  await run('render', () => steps.render(data, soFar()));
  const built = await failingAs('build_failed', () =>
    run('build', () => steps.build(data, soFar())),
  );
  // F-330: a step writes at most PIECES_PER_STEP pieces of rows (persist.ts); a check with more
  // takes `persist-1`, `persist-2`, … from where the last one stopped, so no invocation runs toward
  // the route's 300 s and a retry repeats one step's pieces. The first step keeps its id.
  let persisted = await failingAs('persist_failed', () =>
    run('persist', () => steps.persist(data)),
  );
  for (let k = 1; (persisted.next ?? null) !== null; k++) {
    if (k > PERSIST_STEPS_MAX) {
      throw new CheckFailure('persist_failed', {
        cause: new Error(`more than ${PERSIST_STEPS_MAX} persist steps`),
      });
    }
    const from = persisted.next!;
    persisted = await failingAs('persist_failed', () =>
      run(`persist-${k}`, () => steps.persist(data, from)),
    );
  }
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
    data: { checkId, siteId: out.siteId, reason: out.as ?? reason },
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
      timeouts: { finish: `${PACE.finishS}s` },
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
            waitForEvent: (id, opts) => step.waitForEvent(id, opts),
            sendEvent: (id, payload) => step.sendEvent(id, payload),
          },
        },
        steps(),
      ),
  );
}

/** The check a cancelled run was for, when `fail_check` answered that it is failed `canceled`. */
export type CancelledCheck = { checkId: string; siteId: string };

/**
 * A cancelled run: the check id of the event that triggered it, when the payload carries one that
 * reads as a uuid (null otherwise), and the run's id.
 */
export type CancelledRun = { checkId: string | null; runId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The triggering event's check id in an `inngest/function.cancelled` payload, at `data.event.data`.
 * Inngest's system-event reference documents `data.event`; the SDK's type leaves it out, so it is
 * read from `unknown`, and anything but a uuid string is null.
 */
export function cancelledCheckId(data: unknown): string | null {
  const event = isRecord(data) ? data.event : undefined;
  const eventData = isRecord(event) ? event.data : undefined;
  const checkId = isRecord(eventData) ? eventData.checkId : undefined;
  return typeof checkId === 'string' && UUID.test(checkId) ? checkId : null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * `crawlmouse.check.cancelled`: a cancelled checkFn run (check.cancel.requested, or the finish
 * timeout: Inngest reports both as `inngest/function.cancelled`) fails its check with `canceled`, and
 * sends check.failed when the check is failed `canceled` (one event id per check, so a second send,
 * from onFailure or a retry, starts nothing). The check is the triggering event's, so a cancel before the
 * claim fails it too; a payload without that id falls back to the check the run claimed (correctness
 * 2). onFailure does not run for a cancelled run.
 */
export function createCheckCancelledFn(
  failCancelled: (run: CancelledRun) => Promise<CancelledCheck | null>,
) {
  return inngest.createFunction(
    { id: CHECK_CANCELLED_FN_ID, retries: 2 },
    {
      event: 'inngest/function.cancelled',
      if: `event.data.function_id == '${inngest.id}-${CHECK_FN_ID}'`,
    },
    async ({ event, step }) => {
      const run: CancelledRun = { checkId: cancelledCheckId(event.data), runId: event.data.run_id };
      const failed = await step.run('fail', () => failCancelled(run));
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
