import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HostLimiter, medianOf, SLOW_MEDIAN_MS, SLOW_WINDOW } from './limiter.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

/** Run `n` tasks through the limiter; each task takes `latency` ms. Returns start times. */
async function drive(l: HostLimiter, n: number, latency: (i: number) => number) {
  const starts: number[] = [];
  const done = Array.from({ length: n }, (_, i) =>
    l.run(async () => {
      starts.push(Date.now());
      await new Promise((r) => setTimeout(r, latency(i)));
    }),
  );
  await vi.runAllTimersAsync();
  await Promise.all(done);
  return starts;
}

describe('medianOf', () => {
  it('takes the middle, and the mean of the middle two for an even count', () => {
    expect(medianOf([5, 1, 3])).toBe(3);
    expect(medianOf([1, 2, 3, 10])).toBe(2.5);
    expect(medianOf([])).toBe(0);
  });
});

describe('HostLimiter: the 2 req/s cap', () => {
  it('starts requests at least 500 ms apart and never more than 2 in any 1000 ms window', async () => {
    const l = new HostLimiter({ rps: 2 });
    const starts = await drive(l, 12, () => 10);
    expect(starts).toEqual(Array.from({ length: 12 }, (_, i) => i * 500));
    for (let i = 2; i < starts.length; i++) expect(starts[i]! - starts[i - 2]!).toBeGreaterThanOrEqual(1000);
  });

  it('sustains 2.0 req/s over 120 s, not above', async () => {
    const l = new HostLimiter({ rps: 2 });
    const starts = await drive(l, 240, () => 5);
    const elapsedS = (starts[239]! - starts[0]!) / 1000;
    expect(239 / elapsedS).toBeLessThanOrEqual(2.0);
    expect(239 / elapsedS).toBeGreaterThan(1.99);
  });

  it('keeps one request in flight when the host is fast', async () => {
    const l = new HostLimiter({ rps: 2 });
    await drive(l, 6, () => 100);
    expect(l.stats().maxInFlight).toBe(1);
  });

  it('refuses a configured rate above 2 req/s', () => {
    expect(() => new HostLimiter({ rps: 4 })).toThrow(/rps/i);
  });
});

describe('HostLimiter: Crawl-delay', () => {
  it('uses the declared delay as the gap when it exceeds 500 ms', async () => {
    const l = new HostLimiter({ rps: 2 });
    l.setCrawlDelayMs(2000);
    const starts = await drive(l, 4, () => 10);
    expect(starts).toEqual([0, 2000, 4000, 6000]);
  });

  it('never shortens a declared delay: a 10 s delay stays 10 s', async () => {
    const l = new HostLimiter({ rps: 2 });
    l.setCrawlDelayMs(10_000);
    const starts = await drive(l, 3, () => 10);
    expect(starts).toEqual([0, 10_000, 20_000]);
  });

  it('a delay learned after the first request still spaces the second one from the first', async () => {
    const l = new HostLimiter({ rps: 2 });
    const starts: number[] = [];
    const first = l.run(async () => {
      starts.push(Date.now());
    });
    await vi.advanceTimersByTimeAsync(0);
    await first;
    l.setCrawlDelayMs(3000); // robots.txt was the first request; its Crawl-delay is learned from the answer
    const second = l.run(async () => {
      starts.push(Date.now());
    });
    await vi.runAllTimersAsync();
    await second;
    expect(starts).toEqual([0, 3000]);
  });

  it('ignores a delay below 500 ms (the floor still applies)', async () => {
    const l = new HostLimiter({ rps: 2 });
    l.setCrawlDelayMs(100);
    expect(l.gapMs()).toBe(500);
  });

  it('keeps one in flight whenever the gap is above 500 ms, even on a slow host', async () => {
    const l = new HostLimiter({ rps: 2 });
    l.setCrawlDelayMs(1000);
    await drive(l, 30, () => 900);
    expect(l.stats().maxInFlight).toBe(1);
    expect(l.stats().slowRuleFiredAtMs).toBeNull();
  });
});

describe('HostLimiter: slow-host rule', () => {
  it('constants are the ENGINE-GAP 8.6 values', () => {
    expect(SLOW_MEDIAN_MS).toBe(500);
    expect(SLOW_WINDOW).toBe(20);
  });

  it('allows a second request in flight once the median of the last 20 exceeds 500 ms, still starting at most 2 per second', async () => {
    const l = new HostLimiter({ rps: 2 });
    const starts = await drive(l, 60, () => 1200);
    const stats = l.stats();
    expect(stats.slowRuleFiredAtMs).not.toBeNull();
    expect(stats.maxInFlight).toBe(2);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(500);
    // The rule needs a full window of 20 samples before it can fire.
    expect(starts.filter((s) => s < (stats.slowRuleFiredAtMs ?? 0)).length).toBeGreaterThanOrEqual(SLOW_WINDOW);
  });

  it('does not fire on a median at exactly 500 ms', async () => {
    const l = new HostLimiter({ rps: 2 });
    await drive(l, 40, () => 500);
    expect(l.stats().slowRuleFiredAtMs).toBeNull();
    expect(l.stats().maxInFlight).toBe(1);
  });

  it('does not fire on a window with fewer than 20 samples', async () => {
    const l = new HostLimiter({ rps: 2 });
    await drive(l, 19, () => 5000);
    expect(l.stats().slowRuleFiredAtMs).toBeNull();
  });

  it('raises throughput on a slow host above what one in flight allows', async () => {
    const slow = new HostLimiter({ rps: 2, slowRule: false });
    const t0 = Date.now();
    await drive(slow, 40, () => 1200);
    const withoutRule = Date.now() - t0;
    vi.setSystemTime(0);
    const withRule = new HostLimiter({ rps: 2 });
    await drive(withRule, 40, () => 1200);
    expect(Date.now()).toBeLessThan(withoutRule);
  });
});
