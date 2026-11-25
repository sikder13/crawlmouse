import { describe, expect, it } from 'vitest';
import {
  runCheck,
  type BatchAt,
  type CheckStepTools,
  type CheckSteps,
  type RunSoFar,
} from '../../../../../../inngest/check';
import {
  ACCESS_BATCH_BUDGET,
  ACCESS_SLICE_S,
  CRAWL_BATCH_BUDGET,
  CRAWL_CEILING_S,
  DISCOVER_S,
  MIN_BATCH_S,
  PACE,
  FIRST_ACCEPT_BY_S,
  QUEUE_WAIT_MAX_S,
  RESERVE_S,
} from '../limits';
import { addBackMs, batchSeconds, fetchEndsAt, phaseEndsAt, tailOf } from './time';

const S = 1000;
const T0 = Date.UTC(2026, 10, 8, 12, 0, 0);
const so = (over: Partial<RunSoFar> = {}): RunSoFar => ({
  startedAt: T0,
  crawlFrom: T0,
  pagesCrawled: 0,
  linksFound: 0,
  release: null,
  busyMs: 0,
  busyBeforeCrawlMs: 0,
  waitingSince: null,
  discovered: null,
  ...over,
});

describe('the time plan', () => {
  it('the finish timeout is its parts: claim waits, discovery, the wait budget, the crawl, the access slice, the reserve', () => {
    expect(PACE.finishS).toBe(
      PACE.claimWaits * PACE.claimWaitS +
        DISCOVER_S +
        QUEUE_WAIT_MAX_S +
        CRAWL_CEILING_S +
        ACCESS_SLICE_S +
        RESERVE_S,
    );
    expect(PACE.finishS).toBe(2220);
    expect(QUEUE_WAIT_MAX_S).toBe(900);
    // The latest first batch that still gets a whole window: the finish timeout less the crawl,
    // the access slice and the reserve.
    expect(FIRST_ACCEPT_BY_S).toBe(PACE.finishS - CRAWL_CEILING_S - ACCESS_SLICE_S - RESERVE_S);
  });

  it('ends the fetching phases RESERVE_S before the finish timeout', () => {
    expect(fetchEndsAt(T0)).toBe(T0 + (PACE.finishS - RESERVE_S) * S);
  });

  it('ends the crawl at its ceiling after the first accepted batch, or leaves the access slice, whichever first', () => {
    const crawl = { kind: 'crawl' } as const;
    const now = T0 + 500 * S;
    expect(phaseEndsAt(crawl, so({ crawlFrom: T0 + 10 * S }), now)).toBe(
      T0 + (10 + CRAWL_CEILING_S) * S,
    );
    expect(phaseEndsAt(crawl, so({ crawlFrom: T0 + 1700 * S }), now)).toBe(
      fetchEndsAt(T0) - ACCESS_SLICE_S * S,
    );
    expect(phaseEndsAt({ kind: 'access' }, so(), now)).toBe(fetchEndsAt(T0));
  });

  it('before any crawl batch is accepted, the crawl clock has not started: the window is measured from now', () => {
    const crawl = { kind: 'crawl' } as const;
    // Discovery ended at T0 + 60 s; the check then waited 600 s on busy answers.
    const now = T0 + 660 * S;
    const plan = so({ crawlFrom: null, busyMs: 600 * S });
    expect(phaseEndsAt(crawl, plan, now)).toBe(now + CRAWL_CEILING_S * S);
    // So the first batch the worker takes is given its full budget, however long it waited.
    expect(batchSeconds(phaseEndsAt(crawl, plan, now), now, CRAWL_BATCH_BUDGET.max_seconds)).toBe(
      CRAWL_BATCH_BUDGET.max_seconds,
    );
  });

  it('busy time after the first accepted batch is added back to the crawl end (the fetch end holds the whole budget already)', () => {
    const crawlFrom = T0 + 400 * S;
    const plan = so({ crawlFrom, busyMs: 300 * S, busyBeforeCrawlMs: 100 * S });
    expect(addBackMs(plan)).toBe(200 * S);
    expect(phaseEndsAt({ kind: 'crawl' }, plan, crawlFrom)).toBe(
      crawlFrom + (CRAWL_CEILING_S + 200) * S,
    );
  });

  it('the add-back is what is left of ONE budget per check: the first wait counts against it', () => {
    // 700 s before the first batch, 400 s after: only 200 s of the later wait is added back.
    expect(addBackMs(so({ crawlFrom: T0, busyMs: 1100 * S, busyBeforeCrawlMs: 700 * S }))).toBe(
      (QUEUE_WAIT_MAX_S - 700) * S,
    );
    // A budget spent before the first batch leaves nothing to add back.
    expect(addBackMs(so({ crawlFrom: T0, busyMs: 1000 * S, busyBeforeCrawlMs: 900 * S }))).toBe(0);
    // Nothing is added back before the crawl clock starts.
    expect(addBackMs(so({ crawlFrom: null, busyMs: 300 * S }))).toBe(0);
  });

  it('gives a batch its budget, or what the phase leaves after the grace and one poll wait', () => {
    const end = T0 + 1000 * S;
    expect(batchSeconds(end, T0, 240)).toBe(240);
    expect(batchSeconds(end, end - 300 * S, 240)).toBe(300 - 60 - 30);
    // Under MIN_BATCH_S nothing is posted.
    expect(batchSeconds(end, end - (MIN_BATCH_S + 90) * S, 240)).toBe(MIN_BATCH_S);
    expect(batchSeconds(end, end - (MIN_BATCH_S + 89) * S, 240)).toBeNull();
  });

  it('F-247: a crawl of 50-second batches uses its ceiling, not stopping ~115 s short', () => {
    // QA's real sites: 50 pages a batch at ~1 s a page, about 1 s between batches.
    const crawlSeconds = (tail: 'kept_inside' | 'spills_into_access') => {
      const plan = so();
      let t = 0;
      let used = 0;
      for (;;) {
        const s = batchSeconds(
          phaseEndsAt({ kind: 'crawl' }, plan, T0 + t * S),
          T0 + t * S,
          CRAWL_BATCH_BUDGET.max_seconds,
          tail,
        );
        if (s === null) return used;
        const ran = Math.min(s, 50);
        used += ran;
        t += ran + 1;
      }
    };
    // As it was: the last batch had to fit a 60 s grace and a 30 s poll before the ceiling.
    expect(crawlSeconds('kept_inside')).toBeLessThanOrEqual(CRAWL_CEILING_S - 90);
    expect(crawlSeconds('spills_into_access')).toBeGreaterThan(CRAWL_CEILING_S - MIN_BATCH_S);
    expect(tailOf('crawl')).toBe('spills_into_access');
    expect(tailOf('access')).toBe('kept_inside');
  });

  it('worst case from limits.ts: every claim wait, the whole wait budget, every batch at its deadline plus a poll wait, then the reserve, fit the finish timeout', () => {
    // Zero is the first claim attempt; the claim waits are inside the run. The whole budget is
    // spent waiting before the first batch, so none is added back after it.
    let t = PACE.claimWaits * PACE.claimWaitS + DISCOVER_S + QUEUE_WAIT_MAX_S;
    const plan = so({
      startedAt: 0,
      crawlFrom: t * S,
      busyMs: QUEUE_WAIT_MAX_S * S,
      busyBeforeCrawlMs: QUEUE_WAIT_MAX_S * S,
    });
    const phase = (kind: BatchAt['kind'], most: number, batches: number) => {
      for (let n = 0; n < batches; n++) {
        const s = batchSeconds(phaseEndsAt({ kind }, plan, t * S), t * S, most, tailOf(kind));
        if (s === null) return;
        // The batch reaches its deadline, and the poll that sees it comes one poll wait later.
        t += s + PACE.pollGraceS + PACE.pollMaxS;
      }
    };
    phase('crawl', CRAWL_BATCH_BUDGET.max_seconds, PACE.maxCrawlBatches);
    // The crawl's tail may fall in the access slice here (F-247 review): the first access batch still
    // gets the slice less two graces and polls, the crawl's and its own.
    const firstAccess = batchSeconds(
      phaseEndsAt({ kind: 'access' }, plan, t * S),
      t * S,
      ACCESS_BATCH_BUDGET.max_seconds,
      tailOf('access'),
    );
    expect(firstAccess).toBeGreaterThanOrEqual(
      Math.min(
        ACCESS_BATCH_BUDGET.max_seconds,
        ACCESS_SLICE_S - 2 * (PACE.pollGraceS + PACE.pollMaxS),
      ),
    );
    phase('access', ACCESS_BATCH_BUDGET.max_seconds, 2);
    const fetching = t;
    t += RESERVE_S;
    expect(fetching).toBeLessThanOrEqual(PACE.finishS - RESERVE_S);
    expect(t).toBeLessThanOrEqual(PACE.finishS);
  });

  it('the same worst case with the budget spent AFTER the first batch fits too', () => {
    let t = PACE.claimWaits * PACE.claimWaitS + DISCOVER_S;
    const plan = so({
      startedAt: 0,
      crawlFrom: t * S,
      busyMs: QUEUE_WAIT_MAX_S * S,
      busyBeforeCrawlMs: 0,
    });
    t += QUEUE_WAIT_MAX_S;
    const phase = (kind: BatchAt['kind'], most: number, batches: number) => {
      for (let n = 0; n < batches; n++) {
        const s = batchSeconds(phaseEndsAt({ kind }, plan, t * S), t * S, most, tailOf(kind));
        if (s === null) return;
        t += s + PACE.pollGraceS + PACE.pollMaxS;
      }
    };
    phase('crawl', CRAWL_BATCH_BUDGET.max_seconds, PACE.maxCrawlBatches);
    phase('access', ACCESS_BATCH_BUDGET.max_seconds, 2);
    expect(t).toBeLessThanOrEqual(PACE.finishS - RESERVE_S);
  });
});

/**
 * The orchestration driven to its worst cases with step bodies that use the real time plan: each
 * step costs `latencyS` of queue and run time, a sleep costs its length, and the worker finishes a
 * batch only at its last poll before the deadline.
 */
const SITE = {
  siteId: 's',
  accountId: null,
  host: 'example.com',
  homepageUrl: 'https://example.com',
};

function simulate(opts: {
  latencyS: number;
  busyClaims: number;
  slowBatches: boolean;
  /** The worker answers busy to this many posts before it takes the first crawl batch. */
  busyFirst?: number;
  /** ...and to this many posts of each later batch. */
  busyLater?: number;
  /** A batch is done this long after its post; unset, `slowBatches` decides. */
  doneAfterS?: number;
}) {
  const clock = { now: T0 };
  const ids: string[] = [];
  const stepsAt = new Map<string, number>();
  const tools: CheckStepTools = {
    run: async (id, fn) => {
      clock.now += opts.latencyS * S;
      ids.push(id);
      stepsAt.set(id, clock.now);
      return fn();
    },
    sleep: async (id, ms) => {
      ids.push(id);
      clock.now += ms;
    },
    sendEvent: async (id) => {
      ids.push(id);
      stepsAt.set(id, clock.now);
    },
  };
  const posted = new Map<number, { at: number; seconds: number }>();
  const busyAnswers = new Map<number, number>();
  let claims = 0;
  const steps: CheckSteps = {
    claim: async () =>
      claims++ < opts.busyClaims
        ? { outcome: 'site_busy', at: clock.now }
        : { outcome: 'claimed', at: clock.now, site: SITE },
    discover: async () => {
      clock.now += DISCOVER_S * S;
      return { seeds: 1, sitemap_urls: 0, robots_txt: 'found', at: clock.now };
    },
    post: async (_e, at, soFar) => {
      // As the real post step: the time left is read before the worker is asked, so a phase that
      // has ended answers `none` whether or not the worker would have been busy.
      const most =
        at.kind === 'crawl' ? CRAWL_BATCH_BUDGET.max_seconds : ACCESS_BATCH_BUDGET.max_seconds;
      const seconds = batchSeconds(
        phaseEndsAt(at, soFar, clock.now),
        clock.now,
        most,
        tailOf(at.kind),
      );
      if (seconds === null) return { status: 'none', why: 'no_time' };
      const busyFor = at.batch === 1 ? (opts.busyFirst ?? 0) : (opts.busyLater ?? 0);
      if ((busyAnswers.get(at.batch) ?? 0) < busyFor) {
        busyAnswers.set(at.batch, (busyAnswers.get(at.batch) ?? 0) + 1);
        return { status: 'busy', at: clock.now };
      }
      posted.set(at.batch, { at: clock.now, seconds });
      return { status: 'posted', urls: 50, at: clock.now, max_seconds: seconds };
    },
    poll: async (_e, at) => {
      const p = posted.get(at.batch)!;
      const deadline = p.at + (p.seconds + PACE.pollGraceS) * S;
      const done =
        opts.doneAfterS !== undefined
          ? clock.now >= p.at + opts.doneAfterS * S
          : !opts.slowBatches || clock.now >= deadline - PACE.pollMaxS * S;
      return { status: done ? 'done' : 'running', at: clock.now };
    },
    read: async () => ({
      status: 'read',
      pages: 50,
      links: 100,
      access_tests: 0,
      partial: false,
      release: 'abcdef012345',
    }),
    failBatch: async () => ({}),
    render: async () => ({ rendered: 0, not_rendered: 0 }),
    build: async () => ({ status: 'partial', pages: 50, fixes: 0 }),
    persist: async () => ({ written: true }),
    finalize: async () => ({}),
    fail: async () => ({ failed: true, siteId: 's' }),
    requeue: async () => ({ requeued: false }),
  };
  const event = {
    ...SITE,
    checkId: 'c',
    trigger: 'manual' as const,
    pageCap: 100_000,
  };
  return runCheck({ event: { data: event }, step: tools, runId: 'r' }, steps).then((result) => ({
    result,
    ids,
    stepsAt,
    elapsedS: (clock.now - T0) / S,
  }));
}

describe('the time plan through the orchestration (finding 8)', () => {
  it('slow batches and every claim wait: the fetching ends in time to leave RESERVE_S', async () => {
    const run = await simulate({ latencyS: 1, busyClaims: PACE.claimWaits, slowBatches: true });
    expect(run.result.status).toBe('partial');
    const fetchingEndedS = (run.stepsAt.get('render')! - T0) / S;
    // One step's latency is the render step's own start.
    expect(fetchingEndedS).toBeLessThanOrEqual(PACE.finishS - RESERVE_S + 1);
    expect(run.ids).toContain('access-1-read');
  });

  it('fast batches: the crawl stops at PACE.maxCrawlBatches and the run stays under the step limit', async () => {
    const run = await simulate({ latencyS: 1, busyClaims: 0, slowBatches: false });
    expect(run.ids.filter((id) => /^crawl-\d+-read$/.test(id))).toHaveLength(PACE.maxCrawlBatches);
    expect(run.ids.length).toBeLessThan(STEP_LIMIT);
    expect(run.ids.length).toBeLessThanOrEqual(worstCaseSteps());
  });
});

describe('waiting on the worker (CC-42A decisions 1 and 2)', () => {
  const crawlReads = (ids: string[]) => ids.filter((id) => /^crawl-\d+-read$/.test(id)).length;

  it('a check answered busy for 600 s before its first batch gets the same crawl as one that was not', async () => {
    const alone = await simulate({ latencyS: 1, busyClaims: 0, slowBatches: true });
    const waited = await simulate({
      latencyS: 1,
      busyClaims: 0,
      slowBatches: true,
      busyFirst: 600 / PACE.busyWaitS,
    });
    expect(waited.result).toEqual(alone.result);
    expect(crawlReads(waited.ids)).toBe(crawlReads(alone.ids));
    expect(crawlReads(alone.ids)).toBeGreaterThan(1);
  });

  it('busy answers between batches are added back: the crawl reads as many batches', async () => {
    const alone = await simulate({ latencyS: 1, busyClaims: 0, slowBatches: true });
    const waited = await simulate({ latencyS: 1, busyClaims: 0, slowBatches: true, busyLater: 2 });
    expect(crawlReads(waited.ids)).toBe(crawlReads(alone.ids));
  });

  it('a check that never wins a slot within QUEUE_WAIT_MAX_S fails capacity_wait_exceeded, not worker_unavailable', async () => {
    const run = await simulate({
      latencyS: 1,
      busyClaims: 0,
      slowBatches: true,
      busyFirst: 10_000,
    });
    expect(run.result).toEqual({ status: 'failed', reason: 'capacity_wait_exceeded' });
    // It gave up once the budget was spent, not before and not long after.
    const waitedS = run.elapsedS - DISCOVER_S;
    expect(waitedS).toBeGreaterThanOrEqual(QUEUE_WAIT_MAX_S);
    expect(waitedS).toBeLessThan(QUEUE_WAIT_MAX_S + 2 * PACE.busyWaitS);
  });

  /** The most busy answers to its first batch after which `shape` is still graded, not failed. */
  const mostGraded = async (shape: Parameters<typeof simulate>[0]) => {
    for (let n = QUEUE_WAIT_MAX_S / PACE.busyWaitS; n >= 0; n--) {
      if ((await simulate({ ...shape, busyFirst: n })).result.status !== 'failed') return n;
    }
    return -1;
  };

  it('every claim wait, then as long a wait as is still graded: the crawl reads as many batches as without the wait (review rounds 1 and 2, correctness N1)', async () => {
    const shape = { latencyS: 1, busyClaims: PACE.claimWaits, slowBatches: false, doneAfterS: 20 };
    const alone = await simulate(shape);
    const n = await mostGraded(shape);
    // At 1 s a step, with every claim wait, the deadline (FIRST_ACCEPT_BY_S) costs two of the
    // budget's 30 waits: measured 28 (review round 3). Pinned, so giving up one wait early fails.
    expect(n).toBe(28);
    const waited = await simulate({ ...shape, busyFirst: n });
    expect(waited.result).toEqual(alone.result);
    expect(crawlReads(waited.ids)).toBe(crawlReads(alone.ids));
    expect(crawlReads(alone.ids)).toBeGreaterThan(5);
  });

  it.each([1, 2, 3, 5])(
    'at %i s a step, every claim wait: a check is never graded on a shorter crawl for having waited; it fails capacity_wait_exceeded instead (review rounds 1 and 2, correctness N1)',
    async (latencyS) => {
      const shape = { latencyS, busyClaims: PACE.claimWaits, slowBatches: false, doneAfterS: 20 };
      const alone = await simulate(shape);
      for (let busyFirst = 24; busyFirst <= 31; busyFirst++) {
        const waited = await simulate({ ...shape, busyFirst });
        if (waited.result.status === 'failed') {
          expect(waited.result, String(busyFirst)).toEqual({
            status: 'failed',
            reason: 'capacity_wait_exceeded',
          });
        } else {
          expect(crawlReads(waited.ids), String(busyFirst)).toBe(crawlReads(alone.ids));
        }
      }
    },
  );

  it('every claim wait, then as long a wait as is still graded, slow batches: still ends within the finish timeout, under the step limit', async () => {
    const shape = { latencyS: 1, busyClaims: PACE.claimWaits, slowBatches: true };
    const run = await simulate({ ...shape, busyFirst: await mostGraded(shape) });
    expect(run.result.status).toBe('partial');
    expect((run.stepsAt.get('render')! - T0) / S).toBeLessThanOrEqual(PACE.finishS - RESERVE_S + 1);
    expect(run.ids.length).toBeLessThanOrEqual(worstCaseSteps());
  });
});

/**
 * Inngest's limit on steps per function run: "1,000 steps" (Usage limits,
 * https://www.inngest.com/docs/usage-limits/inngest, read 2026-11-08). A sleep is a step.
 */
const STEP_LIMIT = 1000;

/**
 * An upper bound on a run's steps, from PACE and the finish timeout. A sleep shorter than
 * `LONG_SLEEP_S` is one of a posting's first polls, whose wait doubles from pollStartS to pollMaxS:
 * `shortPolls` per posting, and a batch is posted at most twice (its post and its re-post). Every
 * other sleep (a later poll, a busy wait, a claim wait) is at least LONG_SLEEP_S, and the run lasts
 * at most finishS, so there are at most finishS / LONG_SLEEP_S of them. Each sleep is followed by at
 * most one step (a poll, a post or a claim). Each batch adds at most its first post, two reads, its
 * re-post and its fail; the crawl adds one post that plans nothing; the claim, discover, render,
 * build, persist, finalize, emit, fail and emit-failed are one each.
 */
const LONG_SLEEP_S = Math.min(PACE.pollMaxS, PACE.busyWaitS, PACE.claimWaitS);
function shortPolls(): number {
  let n = 0;
  for (let w = PACE.pollStartS; w < LONG_SLEEP_S; w *= 2) n++;
  return n;
}
function worstCaseSteps(): number {
  const batches = PACE.maxCrawlBatches + 2;
  const sleeps = 2 * batches * shortPolls() + Math.floor(PACE.finishS / LONG_SLEEP_S);
  return 2 * sleeps + 5 * batches + 1 + 9;
}

describe('the step count (finding 18)', () => {
  it('the worst case from PACE is under Inngest’s per-run step limit', () => {
    expect(worstCaseSteps()).toBeLessThan(STEP_LIMIT);
  });

  it('the sleeps the bound counts as short are exactly a posting’s doubling polls: 5, 10 and 20 s', () => {
    expect(LONG_SLEEP_S).toBe(30);
    expect(shortPolls()).toBe(3);
    // Every wait the orchestration sleeps that is not a doubling poll is at least LONG_SLEEP_S.
    expect(Math.min(PACE.busyWaitS, PACE.claimWaitS, PACE.pollMaxS)).toBe(LONG_SLEEP_S);
  });
});
