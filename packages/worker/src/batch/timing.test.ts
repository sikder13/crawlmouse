import { describe, expect, it } from 'vitest';
import type { FetchOutcome } from '../fetch/fetcher.js';
import { InstantClock } from '../test-support/clock.js';
import { RequestTiming } from './timing.js';

/** A fetcher on `clock` whose answers take `ms[i]` each; `gaps[i]` is waited before request i. */
async function run(ms: number[], gaps: number[]) {
  const clock = new InstantClock(1_000_000);
  const timing = new RequestTiming(clock);
  let i = 0;
  const fetcher = timing.wrap(async () => {
    clock.advance(ms[i++]!);
    return {} as FetchOutcome;
  });
  for (let n = 0; n < ms.length; n++) {
    clock.advance(gaps[n] ?? 0);
    await fetcher('https://example.com/', {} as never, {} as never);
  }
  return timing.summary();
}

describe('RequestTiming', () => {
  it('tells a slow site from a site held back between requests', async () => {
    // Ten requests of 1,000 ms back to back: slow to answer, no idle time.
    expect(await run(Array(10).fill(1000), Array(10).fill(0))).toEqual({
      requests: 10,
      fetch_ms_p50: 1000,
      fetch_ms_p90: 1000,
      fetch_ms_max: 1000,
      fetch_ms_total: 10_000,
      idle_ms_total: 0,
    });
    // Ten requests of 200 ms, 800 ms apart: quick to answer, held back. The first gap is before the
    // first request, so it is not in the span.
    expect(await run(Array(10).fill(200), Array(10).fill(800))).toMatchObject({
      fetch_ms_p50: 200,
      fetch_ms_total: 2_000,
      idle_ms_total: 9 * 800,
    });
  });

  it('reads the percentiles from the sorted times, and counts an answer that threw', async () => {
    const t = await run([100, 900, 300, 500, 700, 200, 800, 400, 600, 1000], Array(10).fill(0));
    // Nearest rank, worked by hand: of ten sorted times 100..1000, the 5th (500) and the 9th (900).
    expect(t).toMatchObject({ fetch_ms_p50: 500, fetch_ms_p90: 900, fetch_ms_max: 1000 });
    const clock = new InstantClock(0);
    const timing = new RequestTiming(clock);
    const failing = timing.wrap(async () => {
      clock.advance(50);
      throw new Error('reset');
    });
    await expect(failing('https://example.com/', {} as never, {} as never)).rejects.toThrow();
    expect(timing.summary()).toMatchObject({ requests: 1, fetch_ms_max: 50 });
  });

  it('counts overlapping requests once as busy time', async () => {
    // a: 0 to 500 ms, b: 100 to 300 ms inside it, then c: 1,000 to 1,100 ms. Busy is 500 + 100 (b
    // adds nothing), so idle is 1,100 - 600 = 500; adding the durations instead would give 300.
    const clock = new InstantClock(0);
    const timing = new RequestTiming(clock);
    let releaseA!: () => void;
    let releaseB!: () => void;
    const held = (set: (r: () => void) => void) =>
      timing.wrap(() => new Promise<FetchOutcome>((r) => set(() => r({} as FetchOutcome))));
    const a = held((r) => (releaseA = r))('https://example.com/a', {} as never, {} as never);
    clock.advance(100);
    const b = held((r) => (releaseB = r))('https://example.com/b', {} as never, {} as never);
    clock.advance(200);
    releaseB();
    await b;
    clock.advance(200);
    releaseA();
    await a;
    clock.advance(500);
    const quick = timing.wrap(async () => {
      clock.advance(100);
      return {} as FetchOutcome;
    });
    await quick('https://example.com/c', {} as never, {} as never);
    expect(timing.summary()).toMatchObject({
      requests: 3,
      fetch_ms_total: 800,
      idle_ms_total: 500,
    });
  });

  it('records no negative time when the clock is stepped back during a request', async () => {
    const clock = new InstantClock(10_000);
    const timing = new RequestTiming(clock);
    const back = timing.wrap(async () => {
      clock.advance(-1_000);
      return {} as FetchOutcome;
    });
    await back('https://example.com/', {} as never, {} as never);
    expect(timing.summary()).toMatchObject({ requests: 1, fetch_ms_max: 0, fetch_ms_total: 0 });
  });

  it('is all zero for a batch that asked nothing', () => {
    expect(new RequestTiming(new InstantClock(0)).summary()).toEqual({
      requests: 0,
      fetch_ms_p50: 0,
      fetch_ms_p90: 0,
      fetch_ms_max: 0,
      fetch_ms_total: 0,
      idle_ms_total: 0,
    });
  });
});
