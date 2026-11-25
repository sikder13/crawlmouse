import { describe, expect, it } from 'vitest';
import {
  cadenceFor,
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
  RENDER_SHARE_S,
  RESERVE_S,
  MAX_PAGE_CAP,
  crawlCeilingS,
  finishSFor,
  reserveS,
} from '../limits';
import { addBackMs, batchSeconds, fetchEndsAt, phaseEndsAt, renderEndsAt, tailOf } from './time';

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
  pageCap: 500,
  ...over,
});

// Inbox 079: Pro and Agency read 2,000 pages. A site answering a paced request in 1.0 s or less is
// read to 2,000 pages, so a large check's crawl and reserve grow with its cap; a check of 500 pages
// keeps today's windows. The run's finish timeout is one setting on the function, the largest cap's.
describe('the time plan by page cap (2,000 pages)', () => {
  it('a check of 500 pages or fewer keeps today’s windows and waits', () => {
    for (const cap of [1, 100, 500]) {
      expect([crawlCeilingS(cap), reserveS(cap), finishSFor(cap)]).toEqual([480, 180, 2220]);
      expect(cadenceFor(cap)).toEqual({
        pollStartS: PACE.pollStartS,
        pollMaxS: PACE.pollMaxS,
        busyWaitS: PACE.busyWaitS,
      });
    }
  });

  it('gives 2,000 pages 1.7 s a page: 1.0 s a page, and the polls of a run that hears no signal', () => {
    expect(MAX_PAGE_CAP).toBe(2000);
    expect(crawlCeilingS(MAX_PAGE_CAP)).toBeGreaterThanOrEqual(MAX_PAGE_CAP * 1.0);
    expect(crawlCeilingS(MAX_PAGE_CAP)).toBe(3400);
    expect(reserveS(MAX_PAGE_CAP)).toBe(300);
    expect(finishSFor(MAX_PAGE_CAP)).toBe(FIRST_ACCEPT_BY_S + 3400 + ACCESS_SLICE_S + 300);
    expect(finishSFor(MAX_PAGE_CAP)).toBe(5260);
  });

  // Review of 16009429: a site with no sitemap reads its home page alone in the first batch, so at 40
  // batches of 50 it could never reach 2,000 pages, and its crawl ended on the batch count.
  it('allows enough crawl batches to reach 2,000 pages with four batches short of full', () => {
    expect((PACE.maxCrawlBatches - 4) * 50).toBeGreaterThanOrEqual(MAX_PAGE_CAP);
  });

  it('the run’s finish timeout is the largest cap’s, so no check is cut short by it', () => {
    expect(PACE.finishS).toBe(finishSFor(MAX_PAGE_CAP));
    // A cap past MAX_PAGE_CAP reads no more pages (PACE.maxCrawlBatches) and plans no longer.
    for (const cap of [500, 1000, 2000, 2001, 100_000])
      expect(finishSFor(cap)).toBeLessThanOrEqual(PACE.finishS);
  });

  it('ends a check’s fetching and its crawl by its own cap’s plan', () => {
    expect(fetchEndsAt(so({ pageCap: 500 }))).toBe(T0 + (2220 - 180) * S);
    expect(fetchEndsAt(so({ pageCap: 2000 }))).toBe(T0 + (finishSFor(2000) - 300) * S);
    const at = T0 + 400 * S;
    const large = so({ pageCap: 2000, crawlFrom: at });
    expect(phaseEndsAt({ kind: 'crawl' }, large, at)).toBe(at + 3400 * S);
    expect(phaseEndsAt({ kind: 'crawl' }, so({ crawlFrom: at }), at)).toBe(at + 480 * S);
  });

  it('a large check polls from 10 s up to 60 s and waits 60 s on a busy worker', () => {
    expect(cadenceFor(2000)).toEqual({ pollStartS: 10, pollMaxS: 60, busyWaitS: 60 });
    // An access batch keeps its grace and one poll inside its phase, at its own poll wait.
    const end = T0 + 600 * S;
    expect(batchSeconds(end, T0, 240, 'kept_inside', 2000)).toBe(240);
    expect(batchSeconds(end, end - 300 * S, 240, 'kept_inside', 2000)).toBe(300 - 60 - 60);
  });
});

describe('the time plan', () => {
  it('a 500-page check’s finish is its parts: claim waits, discovery, the wait budget, the crawl, the access slice, the reserve', () => {
    expect(finishSFor(500)).toBe(
      PACE.claimWaits * PACE.claimWaitS +
        DISCOVER_S +
        QUEUE_WAIT_MAX_S +
        CRAWL_CEILING_S +
        ACCESS_SLICE_S +
        RESERVE_S,
    );
    expect(finishSFor(500)).toBe(2220);
    expect(QUEUE_WAIT_MAX_S).toBe(900);
    // The latest first batch that still gets a whole window: the finish less the crawl, the access
    // slice and the reserve, at every cap.
    expect(FIRST_ACCEPT_BY_S).toBe(finishSFor(500) - CRAWL_CEILING_S - ACCESS_SLICE_S - RESERVE_S);
    expect(FIRST_ACCEPT_BY_S).toBe(
      finishSFor(2000) - crawlCeilingS(2000) - ACCESS_SLICE_S - reserveS(2000),
    );
  });

  it('ends the fetching phases RESERVE_S before the finish timeout', () => {
    expect(fetchEndsAt(so())).toBe(T0 + (finishSFor(500) - RESERVE_S) * S);
  });

  it('ends the crawl at its ceiling after the first accepted batch, or leaves the access slice, whichever first', () => {
    const crawl = { kind: 'crawl' } as const;
    const now = T0 + 500 * S;
    expect(phaseEndsAt(crawl, so({ crawlFrom: T0 + 10 * S }), now)).toBe(
      T0 + (10 + CRAWL_CEILING_S) * S,
    );
    expect(phaseEndsAt(crawl, so({ crawlFrom: T0 + 1700 * S }), now)).toBe(
      fetchEndsAt(so()) - ACCESS_SLICE_S * S,
    );
    expect(phaseEndsAt({ kind: 'access' }, so(), now)).toBe(fetchEndsAt(so()));
  });

  it('before any crawl batch is accepted, the crawl clock has not started: the window is measured from now', () => {
    const crawl = { kind: 'crawl' } as const;
    // Discovery ended at T0 + 60 s; the check then waited 600 s on busy answers.
    const now = T0 + 660 * S;
    const plan = so({ crawlFrom: null, busyMs: 600 * S });
    expect(phaseEndsAt(crawl, plan, now)).toBe(now + CRAWL_CEILING_S * S);
    // So the first batch the worker takes is given its full budget, however long it waited.
    expect(
      batchSeconds(
        phaseEndsAt(crawl, plan, now),
        now,
        CRAWL_BATCH_BUDGET.max_seconds,
        'kept_inside',
        500,
      ),
    ).toBe(CRAWL_BATCH_BUDGET.max_seconds);
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
    expect(batchSeconds(end, T0, 240, 'kept_inside', 500)).toBe(240);
    expect(batchSeconds(end, end - 300 * S, 240, 'kept_inside', 500)).toBe(300 - 60 - 30);
    // Under MIN_BATCH_S nothing is posted.
    expect(batchSeconds(end, end - (MIN_BATCH_S + 90) * S, 240, 'kept_inside', 500)).toBe(
      MIN_BATCH_S,
    );
    expect(batchSeconds(end, end - (MIN_BATCH_S + 89) * S, 240, 'kept_inside', 500)).toBeNull();
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
          plan.pageCap,
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
        const s = batchSeconds(phaseEndsAt({ kind }, plan, t * S), t * S, most, tailOf(kind), 500);
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
      plan.pageCap,
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
    expect(fetching).toBeLessThanOrEqual(finishSFor(500) - RESERVE_S);
    expect(t).toBeLessThanOrEqual(finishSFor(500));
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
        const s = batchSeconds(phaseEndsAt({ kind }, plan, t * S), t * S, most, tailOf(kind), 500);
        if (s === null) return;
        t += s + PACE.pollGraceS + PACE.pollMaxS;
      }
    };
    phase('crawl', CRAWL_BATCH_BUDGET.max_seconds, PACE.maxCrawlBatches);
    phase('access', ACCESS_BATCH_BUDGET.max_seconds, 2);
    expect(t).toBeLessThanOrEqual(finishSFor(500) - RESERVE_S);
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
  /** The check's page cap: 500 unless set, the plan these tests were written for. */
  pageCap?: number;
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
        soFar.pageCap,
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
    pageCap: opts.pageCap ?? 500,
  };
  return runCheck({ event: { data: event }, step: tools, runId: 'r' }, steps).then((result) => ({
    result,
    ids,
    stepsAt,
    elapsedS: (clock.now - T0) / S,
  }));
}

// Review of the render budget: each retry of the render step read a new start, so two failed attempts
// of 90 s each ran the check past the reserve. The render's end is counted from the earlier of the
// step's start and the end of the fetching phases.
describe('the render step’s end (RENDER_SHARE_S of the reserve)', () => {
  const fetchEnd = fetchEndsAt(so());
  it('gives a step that starts before the fetching phases end its whole share', () => {
    const start = fetchEnd - 600 * S;
    expect(renderEndsAt(start, so())).toBe(start + RENDER_SHARE_S * S);
  });

  it('gives a step that starts after them, a retry or a late start, only what the share has left', () => {
    expect(renderEndsAt(fetchEnd + 60 * S, so())).toBe(fetchEnd + RENDER_SHARE_S * S);
    // However many attempts, rendering never runs past the share, so the steps after it keep the rest.
    for (const late of [0, 30, 90, 200]) {
      const end = renderEndsAt(fetchEnd + late * S, so());
      expect(end).toBeLessThanOrEqual(T0 + (PACE.finishS - (RESERVE_S - RENDER_SHARE_S)) * S);
    }
  });
});

describe('the time plan through the orchestration (finding 8)', () => {
  it('slow batches and every claim wait: the fetching ends in time to leave RESERVE_S', async () => {
    const run = await simulate({ latencyS: 1, busyClaims: PACE.claimWaits, slowBatches: true });
    expect(run.result.status).toBe('partial');
    const fetchingEndedS = (run.stepsAt.get('render')! - T0) / S;
    // One step's latency is the render step's own start.
    expect(fetchingEndedS).toBeLessThanOrEqual(finishSFor(500) - RESERVE_S + 1);
    expect(run.ids).toContain('access-1-read');
  });

  it('fast batches: the crawl stops at PACE.maxCrawlBatches and the run stays under the step limit', async () => {
    const run = await simulate({ latencyS: 1, busyClaims: 0, slowBatches: false });
    expect(run.ids.filter((id) => /^crawl-\d+-read$/.test(id))).toHaveLength(PACE.maxCrawlBatches);
    expect(run.ids.length).toBeLessThan(STEP_LIMIT);
    expect(run.ids.length).toBeLessThanOrEqual(worstCaseSteps());
  });
});

describe('a 2,000-page check through the orchestration (inbox 079)', () => {
  const crawlReads = (ids: string[]) => ids.filter((id) => /^crawl-\d+-read$/.test(id)).length;

  it.each([1, 3])(
    'at %i s a step and every claim wait, a site at 1.0 s a page is read to 2,000 pages, in time and under the step limit',
    async (latencyS) => {
      // 50 pages a batch at 1.0 s a page.
      const run = await simulate({
        latencyS,
        busyClaims: PACE.claimWaits,
        slowBatches: false,
        doneAfterS: 50,
        pageCap: 2000,
      });
      // 50 pages a batch: the cap's worth of batches, and more if the time allows.
      expect(crawlReads(run.ids)).toBeGreaterThanOrEqual(MAX_PAGE_CAP / 50);
      expect((run.stepsAt.get('render')! - T0) / S).toBeLessThanOrEqual(
        finishSFor(2000) - reserveS(2000) + 1,
      );
      expect(run.ids.length).toBeLessThanOrEqual(worstCaseSteps(2000));
      expect(run.ids.length).toBeLessThan(STEP_LIMIT);
    },
  );

  it('slow batches and as long a wait as is still graded: still ends within its finish, under the step limit', async () => {
    const shape = { latencyS: 1, busyClaims: PACE.claimWaits, slowBatches: true, pageCap: 2000 };
    let busyFirst = 0;
    for (let n = QUEUE_WAIT_MAX_S / cadenceFor(2000).busyWaitS; n >= 0; n--) {
      if ((await simulate({ ...shape, busyFirst: n })).result.status !== 'failed') {
        busyFirst = n;
        break;
      }
    }
    const run = await simulate({ ...shape, busyFirst });
    expect(run.result.status).not.toBe('failed');
    expect((run.stepsAt.get('render')! - T0) / S).toBeLessThanOrEqual(
      finishSFor(2000) - reserveS(2000) + 1,
    );
    expect(run.ids.length).toBeLessThanOrEqual(worstCaseSteps(2000));
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
    expect((run.stepsAt.get('render')! - T0) / S).toBeLessThanOrEqual(
      finishSFor(500) - RESERVE_S + 1,
    );
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
const longSleepS = (cap: number) => {
  const c = cadenceFor(cap);
  return Math.min(c.pollMaxS, c.busyWaitS, PACE.claimWaitS);
};
const LONG_SLEEP_S = longSleepS(500);
function shortPolls(cap = 500): number {
  let n = 0;
  for (let w = cadenceFor(cap).pollStartS; w < longSleepS(cap); w *= 2) n++;
  return n;
}
/** As above, for a check of `cap` pages: its sleeps all fall within its own plan, finishSFor(cap). */
function worstCaseSteps(cap = 500): number {
  const batches = PACE.maxCrawlBatches + 2;
  const sleeps = 2 * batches * shortPolls(cap) + Math.floor(finishSFor(cap) / longSleepS(cap));
  return 2 * sleeps + 5 * batches + 1 + 9;
}

describe('the step count (finding 18)', () => {
  it('the worst case from PACE is under Inngest’s per-run step limit, at every page cap', () => {
    for (const cap of [500, 1000, 1500, 2000]) expect(worstCaseSteps(cap)).toBeLessThan(STEP_LIMIT);
    // At 30 s waits a 2,000-page plan would pass the limit: why a large check waits longer.
    const at30 = (cap: number) =>
      2 * (2 * (PACE.maxCrawlBatches + 2) * 3 + Math.floor(finishSFor(cap) / 30)) +
      5 * (PACE.maxCrawlBatches + 2) +
      10;
    expect(at30(2000)).toBeGreaterThanOrEqual(STEP_LIMIT);
  });

  it('the sleeps the bound counts as short are exactly a posting’s doubling polls: 5, 10 and 20 s', () => {
    expect(LONG_SLEEP_S).toBe(30);
    expect(shortPolls()).toBe(3);
    // Every wait the orchestration sleeps that is not a doubling poll is at least LONG_SLEEP_S.
    expect(Math.min(PACE.busyWaitS, PACE.claimWaitS, PACE.pollMaxS)).toBe(LONG_SLEEP_S);
  });
});
