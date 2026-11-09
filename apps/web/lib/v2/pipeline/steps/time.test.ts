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
  RESERVE_S,
} from '../limits';
import { batchSeconds, fetchEndsAt, phaseEndsAt } from './time';

const S = 1000;
const T0 = Date.UTC(2026, 10, 8, 12, 0, 0);
const so = (over: Partial<RunSoFar> = {}): RunSoFar => ({
  startedAt: T0,
  crawlFrom: T0,
  pagesCrawled: 0,
  linksFound: 0,
  release: null,
  ...over,
});

describe('the time plan', () => {
  it('ends the fetching phases RESERVE_S before the finish timeout', () => {
    expect(fetchEndsAt(T0)).toBe(T0 + (1200 - 180) * S);
  });

  it('ends the crawl at its ceiling after discovery, or leaves the access slice, whichever first', () => {
    const crawl = { kind: 'crawl' } as const;
    expect(phaseEndsAt(crawl, so({ crawlFrom: T0 + 10 * S }))).toBe(
      T0 + (10 + CRAWL_CEILING_S) * S,
    );
    expect(phaseEndsAt(crawl, so({ crawlFrom: T0 + 400 * S }))).toBe(
      fetchEndsAt(T0) - ACCESS_SLICE_S * S,
    );
    expect(phaseEndsAt({ kind: 'access' }, so())).toBe(fetchEndsAt(T0));
  });

  it('gives a batch its budget, or what the phase leaves after the grace and one poll wait', () => {
    const end = T0 + 1000 * S;
    expect(batchSeconds(end, T0, 240)).toBe(240);
    expect(batchSeconds(end, end - 300 * S, 240)).toBe(300 - 60 - 30);
    // Under MIN_BATCH_S nothing is posted.
    expect(batchSeconds(end, end - (MIN_BATCH_S + 90) * S, 240)).toBe(MIN_BATCH_S);
    expect(batchSeconds(end, end - (MIN_BATCH_S + 89) * S, 240)).toBeNull();
  });

  it('worst case from limits.ts: every claim wait, every batch at its deadline plus a poll wait, then the reserve, fit 1,200 s', () => {
    // Zero is the first claim attempt; the claim waits are inside the run.
    let t = PACE.claimWaits * PACE.claimWaitS + DISCOVER_S;
    const plan = so({ startedAt: 0, crawlFrom: t * S });
    const phase = (kind: BatchAt['kind'], most: number, batches: number) => {
      for (let n = 0; n < batches; n++) {
        const s = batchSeconds(phaseEndsAt({ kind }, plan), t * S, most);
        if (s === null) return;
        // The batch reaches its deadline, and the poll that sees it comes one poll wait later.
        t += s + PACE.pollGraceS + PACE.pollMaxS;
      }
    };
    phase('crawl', CRAWL_BATCH_BUDGET.max_seconds, PACE.maxCrawlBatches);
    phase('access', ACCESS_BATCH_BUDGET.max_seconds, 2);
    const fetching = t;
    t += RESERVE_S;
    expect(fetching).toBeLessThanOrEqual(PACE.finishS - RESERVE_S);
    expect(t).toBeLessThanOrEqual(PACE.finishS);
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

function simulate(opts: { latencyS: number; busyClaims: number; slowBatches: boolean }) {
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
  let claims = 0;
  const steps: CheckSteps = {
    claim: async () =>
      claims++ < opts.busyClaims
        ? { outcome: 'site_busy', at: clock.now }
        : { outcome: 'claimed', at: clock.now, site: SITE },
    discover: async () => {
      clock.now += DISCOVER_S * S;
      return { seeds: 1, sitemap_urls: 0, at: clock.now };
    },
    post: async (_e, at, soFar) => {
      const most =
        at.kind === 'crawl' ? CRAWL_BATCH_BUDGET.max_seconds : ACCESS_BATCH_BUDGET.max_seconds;
      const seconds = batchSeconds(phaseEndsAt(at, soFar), clock.now, most);
      if (seconds === null) return { status: 'none', why: 'no_time' };
      posted.set(at.batch, { at: clock.now, seconds });
      return { status: 'posted', urls: 50, at: clock.now, max_seconds: seconds };
    },
    poll: async (_e, at) => {
      const p = posted.get(at.batch)!;
      const deadline = p.at + (p.seconds + PACE.pollGraceS) * S;
      const done = !opts.slowBatches || clock.now >= deadline - PACE.pollMaxS * S;
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

/**
 * Inngest's limit on steps per function run: "1,000 steps" (Usage limits,
 * https://www.inngest.com/docs/usage-limits/inngest, read 2026-11-08). A sleep is a step.
 */
const STEP_LIMIT = 1000;

/**
 * An upper bound on a run's steps, from PACE and the finish timeout. Every sleep is at least
 * pollStartS long and a run lasts at most finishS, so a run sleeps at most finishS / pollStartS
 * times, and each sleep is followed by at most one step (a poll, a post or a claim). Each batch adds
 * at most its first post, two reads, its re-post and its fail; the crawl adds one post that plans
 * nothing; the claim, discover, render, build, persist, finalize, emit, fail and emit-failed are one
 * each.
 */
function worstCaseSteps(): number {
  const sleeps = Math.floor(PACE.finishS / PACE.pollStartS);
  const batches = PACE.maxCrawlBatches + 2;
  return 2 * sleeps + 5 * batches + 1 + 9;
}

describe('the step count (finding 18)', () => {
  it('the worst case from PACE is under Inngest’s per-run step limit', () => {
    expect(worstCaseSteps()).toBeLessThan(STEP_LIMIT);
  });

  it('every wait between steps is at least pollStartS, which the bound assumes', () => {
    expect(Math.min(PACE.pollStartS, PACE.busyWaitS, PACE.claimWaitS)).toBe(PACE.pollStartS);
  });
});
