import { describe, expect, it } from 'vitest';
import {
  PACE,
  runCheck,
  type CheckStepTools,
  type CheckSteps,
  type PollOutput,
  type PostOutput,
  type ReadOutput,
} from './check';

/** The run against a scripted worker on a virtual clock: what a done signal changes (PR 5a). */
const EVENT = {
  checkId: '00000000-0000-4000-8000-000000000001',
  siteId: '00000000-0000-4000-8000-000000000002',
  accountId: null,
  host: 'example.test',
  homepageUrl: 'https://example.test/',
  trigger: 'manual',
  pageCap: 500,
} as const;
const MAX_SECONDS = 240;

interface Script {
  signals?: boolean;
  /** Seconds a batch takes. */
  batchS?: number;
  /** What the worker's signal does at the batch's end. */
  signal?: 'arrives' | 'lost' | 'failed' | 'early' | 'failed-early';
  maxSeconds?: number;
  /** The batch whose read finds it failed, as after a stale note. */
  readFails?: number;
}

async function go(script: Script) {
  const { signals = true, batchS = 56, signal = 'arrives', maxSeconds = MAX_SECONDS } = script;
  let now = 0;
  let postedAt = 0;
  const ids: string[] = [];
  const waits: { id: string; timeoutS: number; if: string; event: string }[] = [];
  const done = () => now - postedAt >= batchS * 1000;
  const step: CheckStepTools = {
    run: async (id, fn) => {
      ids.push(id);
      return fn();
    },
    sleep: async (id, ms) => {
      ids.push(id);
      now += ms;
    },
    sendEvent: async (id) => {
      ids.push(id);
      return undefined;
    },
    waitForEvent: async (id, opts) => {
      ids.push(id);
      const timeoutS = Number(/^(\d+)s$/.exec(opts.timeout)![1]);
      waits.push({ id, timeoutS, if: opts.if, event: opts.event });
      const left = postedAt + batchS * 1000 - now;
      if (signal === 'failed-early') {
        now += 1000;
        return { data: { checkId: EVENT.checkId, batch: 1, status: 'failed' as const } };
      }
      if (signal === 'early') {
        now += 1000;
        return { data: { checkId: EVENT.checkId, batch: 1, status: 'done' as const } };
      }
      if (signal !== 'lost' && left <= timeoutS * 1000) {
        now += Math.max(0, left);
        const status = signal === 'failed' ? ('failed' as const) : ('done' as const);
        return { data: { checkId: EVENT.checkId, batch: 1, status } };
      }
      now += timeoutS * 1000;
      return null;
    },
  };
  const steps = {
    claim: async () => ({ outcome: 'claimed', at: now, site: { ...EVENT } }),
    discover: async () => ({ seeds: 1, sitemap_urls: 0, robots_txt: 'found', at: now }),
    post: async (_e: unknown, at: { kind: string; batch: number }): Promise<PostOutput> => {
      if (at.kind === 'crawl' && at.batch > 1) return { status: 'none', why: 'done' };
      if (at.kind === 'access' && at.batch > 2) return { status: 'none', why: 'not_needed' };
      postedAt = now;
      return {
        status: 'posted',
        urls: 50,
        at: now,
        max_seconds: maxSeconds,
        ...(signals && { signals: true as const }),
      };
    },
    poll: async (): Promise<PollOutput> => ({
      status: signal === 'failed' && done() ? 'failed' : done() ? 'done' : 'running',
      at: now,
    }),
    read: async (_e: unknown, at: { batch: number }): Promise<ReadOutput> =>
      at.batch === script.readFails
        ? { status: 'failed' }
        : done()
          ? { status: 'read', pages: 50, links: 0, access_tests: 0, partial: false, release: 'r' }
          : { status: 'running' },
    failBatch: async () => ({}),
    render: async () => ({ rendered: 0, not_rendered: 0 }),
    build: async () => ({ status: 'finished', pages: 1, fixes: 0 }),
    persist: async () => ({ written: true }),
    finalize: async () => ({}),
    fail: async () => ({ failed: true, siteId: EVENT.siteId }),
  } as unknown as CheckSteps;
  const result = await runCheck(
    { event: { data: { ...EVENT } as never }, step, runId: 'r' },
    steps,
  );
  return { result, ids, waits, seconds: now / 1000 };
}
const of = (ids: string[], part: string) => ids.filter((i) => i.includes(part));

describe('a worker that signals', () => {
  it('costs a batch a post, a wait and a read: no poll and no sleep', async () => {
    const { result, ids } = await go({ batchS: 25 });
    expect(result.status).toBe('finished');
    expect(of(ids, '-poll-')).toEqual([]);
    expect(of(ids, '-wait-')).toEqual([]);
    expect(of(ids, 'crawl-1-')).toEqual(['crawl-1-post', 'crawl-1-done-1', 'crawl-1-read']);
  });

  it('reads the batch as it ends, not at the next poll', async () => {
    const signalled = await go({ batchS: 41 });
    const polled = await go({ batchS: 41, signals: false });
    expect(signalled.seconds).toBeLessThan(polled.seconds);
    expect(signalled.seconds).toBe(2 * 41);
  });

  it('waits only for this check’s batch', async () => {
    const { waits } = await go({ batchS: 25 });
    expect(waits[0]!.event).toBe('check.batch.ended');
    expect(waits[0]!.if).toBe('event.data.checkId == async.data.checkId && async.data.batch == 1');
    expect(waits[1]!.if).toContain('async.data.batch == 2');
  });
});

describe('a signal that does not arrive costs time, never the check', () => {
  it('falls back to one poll per wait and finishes', async () => {
    const { result, ids } = await go({ signal: 'lost', batchS: 56 });
    expect(result.status).toBe('finished');
    expect(of(ids, 'crawl-1-poll-').length).toBeGreaterThan(0);
    expect(ids).toContain('crawl-1-read');
  });

  it('never waits past the batch’s deadline', async () => {
    const { waits } = await go({ signal: 'lost', batchS: MAX_SECONDS });
    expect(Math.max(...waits.map((w) => w.timeoutS))).toBeLessThanOrEqual(PACE.signalWaitS);
    let left = MAX_SECONDS + PACE.pollGraceS;
    for (const w of waits.filter((x) => x.id.startsWith('crawl-1-'))) {
      expect(w.timeoutS).toBeLessThanOrEqual(left);
      left -= w.timeoutS;
    }
  });
});

describe('a signal is a hint', () => {
  it('a batch that ended failed is decided by the poll, as today', async () => {
    const { ids } = await go({ signal: 'failed' });
    expect(of(ids, 'crawl-1-poll-').length).toBeGreaterThan(0);
    expect(ids).not.toContain('crawl-1-read');
    expect(ids).toContain('crawl-1-fail');
  });

  it('a signal for a batch still running is not a lost batch: the run goes back to polling', async () => {
    const { result, ids } = await go({ signal: 'early', batchS: 56 });
    expect(result.status).toBe('finished');
    expect(ids).not.toContain('crawl-1-repost');
    expect(of(ids, 'crawl-1-done-')).toHaveLength(1);
    expect(of(ids, 'crawl-1-poll-').length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('a worker that does not signal', () => {
  it('is polled exactly as before, with no wait', async () => {
    const { result, ids, waits } = await go({ signals: false });
    expect(result.status).toBe('finished');
    expect(waits).toEqual([]);
    expect(of(ids, 'crawl-1-wait-').length).toBeGreaterThan(0);
    expect(of(ids, 'crawl-1-poll-').length).toBeGreaterThan(0);
  });
});

describe('a signal that cannot arrive costs one wait, not one per batch', () => {
  it('puts the rest of the run back on polling after the first miss', async () => {
    const { result, ids } = await go({ signal: 'lost', batchS: 10 });
    expect(result.status).toBe('finished');
    expect(of(ids, 'crawl-1-done-')).toHaveLength(1);
    expect(of(ids, 'access-1-done-')).toEqual([]);
    expect(of(ids, 'access-1-wait-').length).toBeGreaterThan(0);
  });

  it('keeps listening when a long batch is simply still running at the timeout', async () => {
    const { ids } = await go({ batchS: 56 });
    expect(of(ids, 'access-1-done-').length).toBeGreaterThan(0);
  });

  it('until a signal has arrived, waits no longer than a poll would', async () => {
    const { waits } = await go({ signal: 'lost', batchS: 200 });
    expect(Math.max(...waits.map((w) => w.timeoutS))).toBe(PACE.pollMaxS);
  });

  it('once one has arrived, may wait the longer time', async () => {
    const { waits } = await go({ batchS: 56 });
    const second = waits.find((w) => w.id.startsWith('access-1-'))!;
    expect(second.timeoutS).toBe(PACE.signalWaitS);
  });

  it('cuts the wait at the batch’s deadline', async () => {
    const maxSeconds = 70;
    const { waits } = await go({ signal: 'lost', batchS: 500, maxSeconds });
    const own = waits.filter((w) => w.id.startsWith('crawl-1-'));
    expect(own.reduce((n, w) => n + w.timeoutS, 0)).toBe(maxSeconds + PACE.pollGraceS);
    expect(own.at(-1)!.timeoutS).toBeLessThan(PACE.pollMaxS);
  });
});

describe('a stale or repeated note', () => {
  it('a read that finds the batch failed fails that batch, and the check finishes', async () => {
    const { result, ids } = await go({ readFails: 2 });
    expect(result.status).toBe('finished');
    expect(ids).toContain('access-1-fail');
    // A batch the worker says failed is not a lost one, so it is not posted again.
    expect(ids).not.toContain('access-1-repost');
  });

  it('a `failed` note on a running batch is heard once', async () => {
    const { ids } = await go({ signal: 'failed-early', batchS: 56 });
    expect(of(ids, 'crawl-1-done-')).toHaveLength(1);
    expect(ids).toContain('crawl-1-read');
    expect(new Set(ids).size).toBe(ids.length);
  });
});
