import { afterEach, describe, expect, it, vi } from 'vitest';
import { NonRetriableError } from 'inngest';
import { inngest } from './client';
import { CheckFailure, failureReasonOf, type CheckRequested } from './check-events';
import {
  CHECK_FN_ID,
  PACE,
  STEP_OUTPUT_BYTES,
  createCheckCancelledFn,
  createCheckFn,
  runCheck,
  type BatchAt,
  type CancelledRun,
  type ClaimedSite,
  type CheckStepTools,
  type CheckSteps,
  type PollOutput,
  type PostOutput,
  type ReadOutput,
} from './check';

const EVENT: CheckRequested = {
  checkId: '11111111-1111-4111-8111-111111111111',
  siteId: '22222222-2222-4222-8222-222222222222',
  accountId: null,
  host: 'example.com',
  homepageUrl: 'https://example.com/',
  trigger: 'manual',
  pageCap: 500,
};
const RELEASE = 'abcdef012345';
/** A site id other than the event's, as the database might hold it. */
const DB_SITE = '33333333-3333-4333-8333-333333333333';
/** The event's site, as a claim reads it back when the database agrees with the event. */
const SITE_OF_EVENT: ClaimedSite = {
  siteId: EVENT.siteId,
  accountId: EVENT.accountId,
  host: EVENT.host,
  homepageUrl: EVENT.homepageUrl,
};
const T0 = Date.UTC(2026, 10, 8, 12, 0, 0);

/** A fake `step`: records every id, `sleep` advances the clock and returns at once. */
function fakeStep(clock: { now: number }) {
  const ids: string[] = [];
  const sleeps: [string, number][] = [];
  const outputs = new Map<string, unknown>();
  const events: { id: string; payload: unknown }[] = [];
  const tools: CheckStepTools = {
    run: async (id, fn) => {
      ids.push(id);
      const out = await fn();
      outputs.set(id, out);
      return out;
    },
    sleep: async (id, ms) => {
      ids.push(id);
      sleeps.push([id, ms]);
      clock.now += ms;
    },
    sendEvent: async (id, payload) => {
      ids.push(id);
      events.push({ id, payload });
    },
  };
  return { ids, sleeps, outputs, events, tools };
}

interface Script {
  crawlBatches?: number;
  stage2?: boolean;
  claims?: ('claimed' | 'site_busy' | 'gone' | 'paused')[];
  /** The site the claim reads from the database; the event's when unset. */
  site?: ClaimedSite;
  poll?: (at: BatchAt, n: number) => PollOutput['status'] | PollOutput;
  post?: (at: BatchAt, n: number) => PostOutput | undefined;
  read?: (at: BatchAt) => ReadOutput | undefined;
}

/** Fake step bodies; each returns the clock's time where the real one returns its own. */
function fakeSteps(clock: { now: number }, script: Script = {}) {
  const posts: { at: BatchAt }[] = [];
  const failed: string[] = [];
  let claimN = 0;
  let pollN = 0;
  let postN = 0;
  const crawlBatches = script.crawlBatches ?? 2;
  const steps: CheckSteps = {
    claim: async () => {
      const outcome = script.claims?.[claimN++] ?? 'claimed';
      return outcome === 'claimed'
        ? { outcome, at: clock.now, site: script.site ?? SITE_OF_EVENT }
        : { outcome, at: clock.now };
    },
    discover: async () => ({ seeds: 3, sitemap_urls: 2, at: clock.now }),
    post: async (_e, at) => {
      posts.push({ at });
      const scripted = script.post?.(at, postN++);
      if (scripted) return scripted;
      const crawlPosted = new Set(posts.filter((p) => p.at.kind === 'crawl').map((p) => p.at.batch))
        .size;
      if (at.kind === 'crawl' && crawlPosted > crawlBatches) return { status: 'none', why: 'done' };
      if (at.stage === 2 && !script.stage2) return { status: 'none', why: 'not_needed' };
      return { status: 'posted', urls: 50, at: clock.now, max_seconds: 240 };
    },
    poll: async (_e, at) => {
      const scripted = script.poll?.(at, pollN++) ?? 'done';
      return typeof scripted === 'string' ? { status: scripted, at: clock.now } : scripted;
    },
    read: async (_e, at) =>
      script.read?.(at) ?? {
        status: 'read',
        pages: at.kind === 'crawl' ? 50 : 0,
        links: at.kind === 'crawl' ? 120 : 0,
        access_tests: at.kind === 'access' ? 200 : 0,
        partial: false,
        release: RELEASE,
      },
    failBatch: async (_e, at) => {
      failed.push(`${at.kind}:${at.batch}`);
      return {};
    },
    render: async () => ({ rendered: 0, not_rendered: 0 }),
    build: async () => ({ status: 'finished', pages: 100, fixes: 3 }),
    persist: async () => ({ written: true }),
    finalize: async () => ({}),
    fail: async () => ({ failed: true, siteId: EVENT.siteId }),
  };
  return { steps, posts, failed };
}

async function drive(script: Script = {}, start = T0) {
  const clock = { now: start };
  const step = fakeStep(clock);
  const fake = fakeSteps(clock, script);
  const result = await runCheck(
    { event: { data: EVENT }, step: step.tools, runId: 'run-1' },
    fake.steps,
  );
  return { result, ...step, ...fake, clock };
}

describe('runCheck: the step order', () => {
  it('two crawl batches and one access batch', async () => {
    const { ids, result, posts } = await drive();
    expect(ids).toEqual([
      'claim',
      'discover',
      'crawl-1-post',
      'crawl-1-wait-1',
      'crawl-1-poll-1',
      'crawl-1-read',
      'crawl-2-post',
      'crawl-2-wait-1',
      'crawl-2-poll-1',
      'crawl-2-read',
      'crawl-3-post',
      'access-1-post',
      'access-1-wait-1',
      'access-1-poll-1',
      'access-1-read',
      'access-2-post',
      'render',
      'build',
      'persist',
      'emit',
      'finalize',
    ]);
    expect(result).toEqual({ status: 'finished' });
    // One batch-number sequence per check: access continues after the crawl.
    expect(posts.map((p) => [p.at.kind, p.at.batch, p.at.stage])).toEqual([
      ['crawl', 1, null],
      ['crawl', 2, null],
      ['crawl', 3, null],
      ['access', 3, 1],
      ['access', 4, 2],
    ]);
  });

  it('gives the same ids on a second run', async () => {
    const first = await drive();
    const second = await drive({}, T0 + 3_600_000);
    expect(second.ids).toEqual(first.ids);
  });

  it('emits check.finished with the built status, under an event id of its own (correctness 5)', async () => {
    const { events } = await drive();
    expect(events).toEqual([
      {
        id: 'emit',
        payload: {
          id: `check-finished:${EVENT.checkId}`,
          name: 'check.finished',
          data: {
            checkId: EVENT.checkId,
            siteId: EVENT.siteId,
            accountId: null,
            status: 'finished',
          },
        },
      },
    ]);
  });

  it('posts stage 2 only when its post step finds it needed', async () => {
    const needed = await drive({ stage2: true });
    expect(needed.ids).toContain('access-2-read');
    const notNeeded = await drive({ stage2: false });
    expect(notNeeded.ids.filter((id) => id.startsWith('access-2'))).toEqual(['access-2-post']);
  });
});

describe('runCheck: claim', () => {
  it('ends after claim when the claim finds the check gone', async () => {
    const { ids, result } = await drive({ claims: ['gone'] });
    expect(ids).toEqual(['claim']);
    expect(result).toEqual({ status: 'gone' });
  });

  it('waits 60 s and claims again while the site is busy, then goes on', async () => {
    const { ids, sleeps } = await drive({ claims: ['site_busy', 'site_busy', 'claimed'] });
    expect(ids.slice(0, 6)).toEqual([
      'claim',
      'claim-wait-1',
      'claim-1',
      'claim-wait-2',
      'claim-2',
      'discover',
    ]);
    expect(sleeps.slice(0, 2)).toEqual([
      ['claim-wait-1', 60_000],
      ['claim-wait-2', 60_000],
    ]);
  });

  it('fails the check site_busy after five waits', async () => {
    const { ids, result, events } = await drive({ claims: Array(6).fill('site_busy') });
    expect(ids).toEqual([
      'claim',
      ...[1, 2, 3, 4, 5].flatMap((i) => [`claim-wait-${i}`, `claim-${i}`]),
      'fail',
      'emit-failed',
    ]);
    expect(result).toEqual({ status: 'failed', reason: 'site_busy' });
    expect(events[0]!.payload).toEqual({
      id: `check-failed:${EVENT.checkId}`,
      name: 'check.failed',
      data: { checkId: EVENT.checkId, siteId: EVENT.siteId, reason: 'site_busy' },
    });
  });

  it('names in check.failed the site the fail step read from the database', async () => {
    const clock = { now: T0 };
    const step = fakeStep(clock);
    const fake = fakeSteps(clock, { claims: ['paused'] });
    fake.steps.fail = async () => ({ failed: true, siteId: DB_SITE });
    await runCheck({ event: { data: EVENT }, step: step.tools, runId: 'r' }, fake.steps);
    expect(step.events.map((e) => e.payload)).toEqual([
      {
        id: `check-failed:${EVENT.checkId}`,
        name: 'check.failed',
        data: { checkId: EVENT.checkId, siteId: DB_SITE, reason: 'paused' },
      },
    ]);
  });

  it('fails the check internal, running nothing else, when its row names another site than the event (security 6)', async () => {
    const clock = { now: T0 };
    const step = fakeStep(clock);
    const fake = fakeSteps(clock, { site: { ...SITE_OF_EVENT, siteId: DB_SITE } });
    fake.steps.fail = async () => ({ failed: true, siteId: DB_SITE });
    const result = await runCheck(
      { event: { data: EVENT }, step: step.tools, runId: 'r' },
      fake.steps,
    );
    expect(step.ids).toEqual(['claim', 'fail', 'emit-failed']);
    expect(result).toEqual({ status: 'failed', reason: 'internal' });
    expect(step.events[0]!.payload).toMatchObject({ data: { siteId: DB_SITE } });
  });

  it('gives the steps after the claim the host, account and homepage the database holds (security 6)', async () => {
    const site: ClaimedSite = {
      siteId: EVENT.siteId,
      accountId: '44444444-4444-4444-8444-444444444444',
      host: 'kept.example',
      homepageUrl: 'https://kept.example',
    };
    const clock = { now: T0 };
    const step = fakeStep(clock);
    const fake = fakeSteps(clock, { site });
    const seen: CheckRequested[] = [];
    for (const name of ['discover', 'post', 'poll', 'read', 'render', 'build'] as const) {
      const inner = fake.steps[name] as (e: CheckRequested, ...rest: never[]) => Promise<never>;
      fake.steps[name] = (async (e: CheckRequested, ...rest: never[]) => {
        seen.push(e);
        return inner(e, ...rest);
      }) as never;
    }
    await runCheck({ event: { data: EVENT }, step: step.tools, runId: 'r' }, fake.steps);
    expect(seen.length).toBeGreaterThan(6);
    for (const e of seen) expect(e).toEqual({ ...EVENT, ...site });
    expect(step.events.at(-1)!.payload).toMatchObject({
      name: 'check.finished',
      data: { siteId: EVENT.siteId, accountId: site.accountId },
    });
  });

  it('fails the check paused when the claim reads CRAWL_PAUSED', async () => {
    const { ids, result } = await drive({ claims: ['paused'] });
    expect(ids).toEqual(['claim', 'fail', 'emit-failed']);
    expect(result).toEqual({ status: 'failed', reason: 'paused' });
  });

  it('sends no check.failed when fail finds the check already ended', async () => {
    const clock = { now: T0 };
    const step = fakeStep(clock);
    const fake = fakeSteps(clock, { claims: ['paused'] });
    fake.steps.fail = async () => ({ failed: false });
    await runCheck({ event: { data: EVENT }, step: step.tools, runId: 'r' }, fake.steps);
    expect(step.ids).toEqual(['claim', 'fail']);
  });
});

describe('runCheck: polling (D1)', () => {
  it('waits 5 s, doubling to 30 s, between polls', async () => {
    let n = 0;
    const { sleeps } = await drive({
      crawlBatches: 1,
      poll: (at) => (at.kind === 'crawl' && n++ < 7 ? 'running' : 'done'),
    });
    expect(sleeps.filter(([id]) => id.startsWith('crawl-1-wait')).map(([, ms]) => ms)).toEqual([
      5_000, 10_000, 20_000, 30_000, 30_000, 30_000, 30_000, 30_000,
    ]);
  });

  /** A crawl batch posted at T0 with max_seconds 240, whose polls report the given times. */
  async function deadlineCase(pollAts: number[]) {
    let i = 0;
    return drive({
      crawlBatches: 1,
      post: (at) =>
        at.kind === 'crawl' && at.batch === 1
          ? { status: 'posted', urls: 50, at: T0, max_seconds: 240 }
          : undefined,
      poll: (at) =>
        at.kind === 'crawl' && i < pollAts.length
          ? { status: 'running', at: pollAts[i++]! }
          : 'done',
    });
  }
  const DEADLINE = T0 + (240 + 60) * 1000;

  it('polls on while the poll reports a time before max_seconds + 60 s', async () => {
    const { ids, failed } = await deadlineCase([T0 + 1_000, DEADLINE - 1]);
    expect(failed).toEqual([]);
    expect(ids).toContain('crawl-1-poll-3');
    expect(ids).toContain('crawl-1-read');
  });

  it('fails the batch at the deadline, by the poll step’s own time', async () => {
    const { ids, failed } = await deadlineCase([T0 + 1_000, DEADLINE]);
    expect(failed).toEqual(['crawl:1']);
    expect(ids).toContain('crawl-1-fail');
    expect(ids).not.toContain('crawl-1-poll-3');
    // The crawl phase ends with the lost batch; the check goes on with what it read.
    expect(ids).not.toContain('crawl-2-post');
  });

  it('re-posts once when the worker lost the batch', async () => {
    let lost = 0;
    const { ids } = await drive({
      crawlBatches: 1,
      poll: (at) => (at.kind === 'crawl' && lost++ === 0 ? 'not_found' : 'done'),
    });
    expect(ids.slice(2, 8)).toEqual([
      'crawl-1-post',
      'crawl-1-wait-1',
      'crawl-1-poll-1',
      'crawl-1-repost',
      'crawl-1-wait-2',
      'crawl-1-poll-2',
    ]);
    expect(ids).toContain('crawl-1-read-2');
    expect(ids.filter((id) => id.includes('repost'))).toEqual(['crawl-1-repost']);
  });

  it('fails the batch on a second loss', async () => {
    const { ids, failed, result } = await drive({
      poll: (at) => (at.kind === 'crawl' ? 'not_found' : 'done'),
    });
    expect(ids.slice(2, 9)).toEqual([
      'crawl-1-post',
      'crawl-1-wait-1',
      'crawl-1-poll-1',
      'crawl-1-repost',
      'crawl-1-wait-2',
      'crawl-1-poll-2',
      'crawl-1-fail',
    ]);
    expect(failed).toEqual(['crawl:1']);
    // Nothing was crawled: the check fails rather than build from no batch.
    expect(result).toEqual({ status: 'failed', reason: 'worker_unavailable' });
  });

  it('takes a 404 at read as a loss, and re-posts', async () => {
    let reads = 0;
    const { ids } = await drive({
      crawlBatches: 1,
      read: (at) => (at.kind === 'crawl' && reads++ === 0 ? { status: 'not_found' } : undefined),
    });
    expect(ids).toContain('crawl-1-repost');
    expect(ids).toContain('crawl-1-read-2');
  });

  it('fails the batch when the worker reports it failed, without a re-post', async () => {
    const { ids } = await drive({ poll: (at) => (at.batch === 2 ? 'failed' : 'done') });
    expect(ids).toContain('crawl-2-fail');
    expect(ids).not.toContain('crawl-2-repost');
    expect(ids).toContain('access-1-post');
  });

  it('sleeps 30 s and posts again under a new id when the worker is busy', async () => {
    let busy = 0;
    const { ids, sleeps } = await drive({
      crawlBatches: 1,
      post: (at) => (at.kind === 'crawl' && busy++ < 2 ? { status: 'busy', at: T0 } : undefined),
    });
    expect(ids.slice(2, 7)).toEqual([
      'crawl-1-post',
      'crawl-1-post-busy-1',
      'crawl-1-post-1',
      'crawl-1-post-busy-2',
      'crawl-1-post-2',
    ]);
    expect(sleeps[0]).toEqual(['crawl-1-post-busy-1', 30_000]);
  });

  it('fails the check paused when the worker answers paused', async () => {
    const { ids, result } = await drive({
      post: (at) => (at.batch === 2 ? { status: 'paused' } : undefined),
    });
    expect(ids.slice(-3)).toEqual(['crawl-2-post', 'fail', 'emit-failed']);
    expect(result).toEqual({ status: 'failed', reason: 'paused' });
  });

  it('fails the check worker_redeployed when a batch comes from another release', async () => {
    const { result, ids } = await drive({
      read: (at) =>
        at.batch === 2
          ? {
              status: 'read',
              pages: 50,
              links: 0,
              access_tests: 0,
              partial: false,
              release: '0123456789ab',
            }
          : undefined,
    });
    expect(result).toEqual({ status: 'failed', reason: 'worker_redeployed' });
    expect(ids.slice(-3)).toEqual(['crawl-2-read', 'fail', 'emit-failed']);
  });
});

describe('runCheck: step outputs', () => {
  it('every output of a whole run is under 4 KB as JSON', async () => {
    const { outputs } = await drive({ stage2: true });
    for (const [id, out] of outputs) {
      expect(Buffer.byteLength(JSON.stringify(out)), id).toBeLessThan(STEP_OUTPUT_BYTES);
    }
  });

  it('throws inside the step, naming it, when an output is 4 KB or more', async () => {
    const clock = { now: T0 };
    const step = fakeStep(clock);
    const fake = fakeSteps(clock);
    fake.steps.discover = async () =>
      ({ seeds: 1, sitemap_urls: 1, at: 0, junk: 'x'.repeat(STEP_OUTPUT_BYTES) }) as never;
    await expect(
      runCheck({ event: { data: EVENT }, step: step.tools, runId: 'r' }, fake.steps),
    ).rejects.toThrow(/step discover returned \d+ bytes/);
  });
});

describe('runCheck: failures in build and persist', () => {
  it('a build step that fails is the check’s build_failed, non-retriably', async () => {
    const clock = { now: T0 };
    const step = fakeStep(clock);
    const fake = fakeSteps(clock);
    fake.steps.build = async () => {
      throw new Error('boom');
    };
    const run = runCheck({ event: { data: EVENT }, step: step.tools, runId: 'r' }, fake.steps);
    await expect(run).rejects.toBeInstanceOf(NonRetriableError);
    await expect(run).rejects.toThrow('check failed: build_failed');
  });

  it('a persist step that fails is persist_failed', async () => {
    const clock = { now: T0 };
    const step = fakeStep(clock);
    const fake = fakeSteps(clock);
    fake.steps.persist = async () => {
      throw new Error('boom');
    };
    await expect(
      runCheck({ event: { data: EVENT }, step: step.tools, runId: 'r' }, fake.steps),
    ).rejects.toThrow('check failed: persist_failed');
  });

  it('a CheckFailure keeps its own reason', async () => {
    const clock = { now: T0 };
    const step = fakeStep(clock);
    const fake = fakeSteps(clock);
    fake.steps.build = async () => {
      throw new CheckFailure('worker_redeployed');
    };
    await expect(
      runCheck({ event: { data: EVENT }, step: step.tools, runId: 'r' }, fake.steps),
    ).rejects.toThrow('check failed: worker_redeployed');
  });
});

describe('runCheck: replays (Inngest re-runs the function for every step)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Inngest's model: each invocation runs the function from the top; a step already run returns its
   * recorded output without running, and the first new step runs, is recorded, and ends the
   * invocation. The SDK ends it by never settling that step's promise, not by throwing, so code
   * around a step (a try/catch) sees nothing. Between invocations the system clock moves by `move`
   * ms: code that read it outside a step would branch differently from one invocation to the next.
   * The fakes keep their own clock, moved only by a sleep the first time it runs, so their outputs
   * are the same in every case.
   */
  async function replayed(move: number) {
    vi.useFakeTimers({ toFake: ['Date'] });
    const clock = { now: T0 };
    const memo = new Map<string, unknown>();
    const order: string[] = [];
    let i = 0;
    const fake = fakeSteps(clock, {
      stage2: true,
      // Two batches run past their first polls, so the deadline is compared on every replay.
      poll: (at) => (at.batch <= 2 && i++ % 3 < 2 ? 'running' : 'done'),
    });
    for (let invocation = 0; invocation < 500; invocation++) {
      vi.setSystemTime(T0 + invocation * move);
      let ended!: () => void;
      const newStep = new Promise<'new step'>((resolve) => (ended = () => resolve('new step')));
      const record = (id: string, value: unknown) => {
        memo.set(id, value);
        order.push(id);
        ended();
        return new Promise<never>(() => {});
      };
      const tools: CheckStepTools = {
        run: async (id, fn) =>
          memo.has(id)
            ? (memo.get(id) as never)
            : record(id, JSON.parse(JSON.stringify(await fn()))),
        sleep: async (id, ms) => {
          if (memo.has(id)) return;
          clock.now += ms;
          return record(id, null);
        },
        sendEvent: async (id) => (memo.has(id) ? undefined : record(id, null)),
      };
      const outcome = await Promise.race([
        runCheck({ event: { data: EVENT }, step: tools, runId: 'r' }, fake.steps),
        newStep,
      ]);
      if (outcome !== 'new step') return { order, result: outcome };
    }
    throw new Error('the run did not end');
  }

  it('gives the same step ids whatever the system clock reads between invocations', async () => {
    const still = await replayed(0);
    const moving = await replayed(3_600_000);
    expect(still.order).toContain('crawl-1-poll-3');
    expect(moving.order).toEqual(still.order);
    expect(moving.result).toEqual({ status: 'finished' });
  });
});

describe('failureReasonOf', () => {
  it('reads a CheckFailure’s reason from its message, as a step error carries it', () => {
    const thrown = new CheckFailure('worker_redeployed');
    const serialised = Object.assign(new Error(thrown.message), { name: thrown.name });
    expect(failureReasonOf(thrown)).toBe('worker_redeployed');
    expect(failureReasonOf(serialised)).toBe('worker_redeployed');
  });

  it('reads a worker request failure as worker_unavailable, anything else as internal', () => {
    expect(failureReasonOf(Object.assign(new Error('x'), { name: 'WorkerError' }))).toBe(
      'worker_unavailable',
    );
    expect(failureReasonOf(new Error('check failed: not a reason'))).toBe('internal');
    expect(failureReasonOf(new Error('https://example.com/secret broke'))).toBe('internal');
    expect(failureReasonOf('string')).toBe('internal');
  });

  it('a CheckFailure is not retried by Inngest', () => {
    const e = new CheckFailure('paused');
    expect(e).toBeInstanceOf(NonRetriableError);
    expect(e.name).toBe('NonRetriableError');
  });
});

/** What the serve route sends Inngest at sync for a function: the SDK's own config. */
function configOf(fn: unknown) {
  return (
    fn as {
      getConfig(o: { baseUrl: URL; appPrefix: string }): Record<string, unknown>[];
    }
  ).getConfig({
    baseUrl: new URL('https://example.com/api/webhooks/inngest'),
    appPrefix: inngest.id,
  });
}

describe('createCheckFn (D3)', () => {
  const noSteps = () => fakeSteps({ now: T0 }).steps;
  const noFail = async () => ({ failed: false }) as const;

  it('declares the D3 options', () => {
    const [main] = configOf(createCheckFn(noSteps, noFail, {}));
    expect(main).toMatchObject({
      id: `${inngest.id}-${CHECK_FN_ID}`,
      triggers: [{ event: 'check.requested' }],
      concurrency: [{ key: 'event.data.siteId', limit: 1 }, { limit: 2 }],
      idempotency: 'event.data.checkId',
      timeouts: { finish: '20m' },
      cancel: [{ event: 'check.cancel.requested', if: 'event.data.checkId == async.data.checkId' }],
    });
    expect(PACE.finishS).toBe(20 * 60);
    expect((main!.steps as Record<string, { retries: unknown }>).step!.retries).toEqual({
      attempts: 2,
    });
  });

  it('reads the account-wide limit from INNGEST_CHECK_CONCURRENCY under the plan cap', () => {
    const limitOf = (v: string) =>
      (
        configOf(createCheckFn(noSteps, noFail, { INNGEST_CHECK_CONCURRENCY: v }))[0]!
          .concurrency as {
          limit: number;
        }[]
      )[1]!.limit;
    expect(limitOf('1')).toBe(1);
    expect(limitOf('50')).toBe(5);
  });

  it('onFailure fails the check with the error’s reason through `fail` alone, and sends check.failed', async () => {
    const calls: unknown[] = [];
    // onFailure builds no step bodies (correctness 1): `steps` throws if it is called.
    const fn = createCheckFn(
      () => {
        throw new Error('onFailure built the step bodies');
      },
      async (checkId, reason) => {
        calls.push([checkId, reason]);
        return { failed: true, siteId: DB_SITE };
      },
      {},
    ) as unknown as {
      onFailureFn: (ctx: unknown) => Promise<void>;
    };
    const step = fakeStep({ now: T0 });
    await fn.onFailureFn({
      event: { data: { event: { data: EVENT } } },
      error: Object.assign(new Error('check failed: worker_redeployed'), {
        name: 'NonRetriableError',
      }),
      step: step.tools,
    });
    expect(calls).toEqual([[EVENT.checkId, 'worker_redeployed']]);
    expect(step.events).toEqual([
      {
        id: 'emit-failed',
        payload: {
          id: `check-failed:${EVENT.checkId}`,
          name: 'check.failed',
          data: { checkId: EVENT.checkId, siteId: DB_SITE, reason: 'worker_redeployed' },
        },
      },
    ]);
  });
});

describe('createCheckCancelledFn (finding 4)', () => {
  it('triggers on the function_id the SDK gives checkFn, as its own onFailure handler does', () => {
    // The SDK builds checkFn's failure handler with a trigger on inngest/function.failed filtered to
    // checkFn's function_id; inngest/function.cancelled carries the same function_id.
    const [, failure] = configOf(
      createCheckFn(
        () => fakeSteps({ now: T0 }).steps,
        async () => ({ failed: false }) as const,
        {},
      ),
    );
    const sdkFilter = (failure!.triggers as { expression: string }[])[0]!.expression;
    const [cancelled] = configOf(createCheckCancelledFn(async () => null));
    expect(cancelled!.triggers).toEqual([
      { event: 'inngest/function.cancelled', expression: sdkFilter },
    ]);
    expect(sdkFilter).toBe(`event.data.function_id == '${inngest.id}-${CHECK_FN_ID}'`);
  });

  async function cancel(
    failed: { checkId: string; siteId: string } | null,
    data: Record<string, unknown> = { run_id: 'run-9', function_id: 'x' },
  ) {
    const runs: CancelledRun[] = [];
    const fn = createCheckCancelledFn(async (run) => {
      runs.push(run);
      return failed;
    }) as unknown as { fn: (ctx: unknown) => Promise<unknown> };
    const step = fakeStep({ now: T0 });
    const out = await fn.fn({ event: { data }, step: step.tools });
    return { runs, out, events: step.events };
  }

  it('fails the run’s check canceled and sends check.failed', async () => {
    const { events } = await cancel({ checkId: EVENT.checkId, siteId: EVENT.siteId });
    expect(events.map((e) => e.payload)).toEqual([
      {
        id: `check-failed:${EVENT.checkId}`,
        name: 'check.failed',
        data: { checkId: EVENT.checkId, siteId: EVENT.siteId, reason: 'canceled' },
      },
    ]);
  });

  it('names the check by the triggering event’s checkId when the payload carries it (correctness 2)', async () => {
    // Inngest's system-event reference documents `data.event`, the event that triggered the run; the
    // SDK's type for inngest/function.cancelled leaves it out.
    const { runs } = await cancel(null, {
      run_id: 'run-9',
      function_id: 'x',
      event: { name: 'check.requested', data: EVENT },
    });
    expect(runs).toEqual([{ checkId: EVENT.checkId, runId: 'run-9' }]);
  });

  it('falls back to the run id when the payload has no check id it can read as a uuid', async () => {
    const shapes: Record<string, unknown>[] = [
      { run_id: 'run-9', function_id: 'x' },
      { run_id: 'run-9', function_id: 'x', event: null },
      { run_id: 'run-9', function_id: 'x', event: 'check.requested' },
      { run_id: 'run-9', function_id: 'x', event: { data: null } },
      { run_id: 'run-9', function_id: 'x', event: { data: { checkId: 42 } } },
      { run_id: 'run-9', function_id: 'x', event: { data: { checkId: 'not-a-uuid' } } },
      {
        run_id: 'run-9',
        function_id: 'x',
        event: { data: { checkId: `${EVENT.checkId}' or true` } },
      },
    ];
    for (const data of shapes) {
      const { runs } = await cancel(null, data);
      expect(runs, JSON.stringify(data)).toEqual([{ checkId: null, runId: 'run-9' }]);
    }
  });

  it('sends nothing when no check moved', async () => {
    const { events, out } = await cancel(null);
    expect(events).toEqual([]);
    expect(out).toEqual({ failed: false });
  });
});
