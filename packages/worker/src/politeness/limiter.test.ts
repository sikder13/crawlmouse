import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { systemClock } from '../clock.js';
import { FLOOR_GAP_MS, SLOW_MEDIAN_MS, SLOW_WINDOW, SiteLimiter, medianOf } from './limiter.js';

// Fake timers drive the production clock (Date.now and setTimeout), so the limiter under test is
// the one that ships, with no test-only setting.

beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => vi.useRealTimers());

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Schedules `n` tasks that each take `durationMs`, runs the clock out, returns the start times. */
async function runTasks(
  limiter: SiteLimiter,
  n: number,
  durationMs: number | ((i: number) => number),
) {
  const starts: number[] = [];
  const done = Array.from({ length: n }, (_, i) =>
    limiter.schedule(async () => {
      starts.push(Date.now());
      await wait(typeof durationMs === 'number' ? durationMs : durationMs(i));
    }),
  );
  await vi.runAllTimersAsync();
  await Promise.all(done);
  return starts;
}

const gaps = (starts: number[]) => starts.slice(1).map((t, i) => t - starts[i]!);

describe('medianOf', () => {
  it('takes the middle, and the mean of the middle two for an even count', () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 3, 2])).toBe(2.5);
    expect(medianOf([])).toBe(0);
  });
});

describe('SiteLimiter: 2 requests per second, measured between starts', () => {
  it('starts requests at least 500 ms apart when responses are instant', async () => {
    const starts = await runTasks(new SiteLimiter(systemClock), 10, 0);
    expect(Math.min(...gaps(starts))).toBe(FLOOR_GAP_MS);
  });

  it('spaces starts from the previous start, not from the previous response', async () => {
    // Each response takes 300 ms. Measured from the response the next start would be 800 ms later.
    const starts = await runTasks(new SiteLimiter(systemClock), 5, 300);
    expect(gaps(starts)).toEqual([500, 500, 500, 500]);
  });

  it('never starts more than 2 in any 1000 ms window, for any task durations (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 2000 }), { minLength: 2, maxLength: 40 }),
        async (durations) => {
          const starts = await runTasks(
            new SiteLimiter(systemClock),
            durations.length,
            (i) => durations[i]!,
          );
          for (const g of gaps(starts)) expect(g).toBeGreaterThanOrEqual(FLOOR_GAP_MS);
          for (let i = 2; i < starts.length; i++)
            expect(starts[i]! - starts[i - 2]!).toBeGreaterThanOrEqual(1000);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('keeps one request in flight on a fast host', async () => {
    const limiter = new SiteLimiter(systemClock);
    await runTasks(limiter, 30, 100);
    expect(limiter.maxInFlight).toBe(1);
  });

  it('drops a queued task whose signal aborts, without using a start', async () => {
    const limiter = new SiteLimiter(systemClock);
    const controller = new AbortController();
    const ran: number[] = [];
    const a = limiter.schedule(async () => ran.push(1));
    const b = limiter.schedule(async () => ran.push(2), controller.signal);
    const c = limiter.schedule(async () => ran.push(3));
    controller.abort();
    await vi.runAllTimersAsync();
    expect(await b).toEqual({ ran: false });
    await Promise.all([a, c]);
    expect(ran).toEqual([1, 3]);
    expect(limiter.started).toBe(2);
  });
});

describe('SiteLimiter: Crawl-delay', () => {
  it('uses a raised gap between starts', async () => {
    const limiter = new SiteLimiter(systemClock);
    limiter.raiseGapMs(3000);
    expect(gaps(await runTasks(limiter, 4, 0))).toEqual([3000, 3000, 3000]);
  });

  it('never lowers the gap: 10 s stays 10 s after a smaller delay is applied', async () => {
    const limiter = new SiteLimiter(systemClock);
    limiter.raiseGapMs(10_000);
    limiter.raiseGapMs(1_000);
    limiter.raiseGapMs(Number.NaN);
    expect(limiter.gapMs()).toBe(10_000);
    expect(gaps(await runTasks(limiter, 3, 0))).toEqual([10_000, 10_000]);
  });

  it('a delay learned after the first start spaces the next start from that first start', async () => {
    const limiter = new SiteLimiter(systemClock);
    const starts: number[] = [];
    const first = limiter.schedule(async () => {
      starts.push(Date.now());
      limiter.raiseGapMs(5000);
    });
    const second = limiter.schedule(async () => void starts.push(Date.now()));
    await vi.runAllTimersAsync();
    await Promise.all([first, second]);
    expect(gaps(starts)).toEqual([5000]);
  });

  it('keeps one in flight whenever the gap is above the floor, even on a slow host', async () => {
    const limiter = new SiteLimiter(systemClock);
    limiter.raiseGapMs(600);
    await runTasks(limiter, SLOW_WINDOW + 10, 2000);
    expect(limiter.maxInFlight).toBe(1);
  });
});

describe('SiteLimiter: slow-host rule', () => {
  it('allows a second request in flight once the median of the last 20 exceeds 500 ms', async () => {
    const limiter = new SiteLimiter(systemClock);
    const starts = await runTasks(limiter, SLOW_WINDOW + 10, 2000);
    expect(limiter.maxInFlight).toBe(2);
    expect(Math.min(...gaps(starts))).toBeGreaterThanOrEqual(FLOOR_GAP_MS);
  });

  it('does not fire on a median of exactly 500 ms', async () => {
    const limiter = new SiteLimiter(systemClock);
    await runTasks(limiter, SLOW_WINDOW + 10, SLOW_MEDIAN_MS);
    expect(limiter.maxInFlight).toBe(1);
  });

  it('does not fire on fewer than 20 samples', async () => {
    const limiter = new SiteLimiter(systemClock);
    await runTasks(limiter, SLOW_WINDOW - 1, 5000);
    expect(limiter.maxInFlight).toBe(1);
  });
});

describe('SiteLimiter: idleness', () => {
  it('is idle only with nothing queued or running and no activity for the given time', async () => {
    const limiter = new SiteLimiter(systemClock);
    await runTasks(limiter, 1, 0);
    expect(limiter.idleFor(60_000)).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(limiter.idleFor(60_000)).toBe(true);
  });
});
