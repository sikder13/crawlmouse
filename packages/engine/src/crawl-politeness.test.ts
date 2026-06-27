import { describe, it, expect } from 'vitest';
import {
  parseRetryAfter,
  fullJitterBackoffMs,
  capDelayMs,
  isThrottleStatus,
  AimdController,
  type ConcurrencyPool,
} from './crawl-politeness.js';
import { BACKOFF_BASE_MS, MAX_BACKOFF_MS, BACKOFF_BUDGET_SLACK_MS } from './constants.js';

describe('parseRetryAfter (§5 — honor Retry-After as a minimum)', () => {
  it('parses delta-seconds into milliseconds', () => {
    expect(parseRetryAfter('1')).toBe(1000);
    expect(parseRetryAfter('0')).toBe(0);
    expect(parseRetryAfter('120')).toBe(120_000);
  });

  it('parses the HTTP-date form into a future delta (approx)', () => {
    const tenSecondsOut = new Date(Date.now() + 10_000).toUTCString();
    const ms = parseRetryAfter(tenSecondsOut);
    // allow scheduling slop; HTTP-date has 1s resolution
    expect(ms).toBeGreaterThan(8_000);
    expect(ms).toBeLessThan(12_000);
  });

  it('takes the first value when handed an array of headers', () => {
    expect(parseRetryAfter(['2', '99'])).toBe(2000);
  });

  it('returns 0 for missing / empty / garbage / past-date / negative', () => {
    expect(parseRetryAfter(undefined)).toBe(0);
    expect(parseRetryAfter('')).toBe(0);
    expect(parseRetryAfter('   ')).toBe(0);
    expect(parseRetryAfter('soon')).toBe(0);
    expect(parseRetryAfter('-5')).toBe(0);
    expect(parseRetryAfter(new Date(Date.now() - 60_000).toUTCString())).toBe(0);
  });
});

describe('fullJitterBackoffMs (§5 — exponential full jitter)', () => {
  it('stays within [0, base * 2^attempt]', () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const ceil = BACKOFF_BASE_MS * 2 ** attempt;
      for (let i = 0; i < 50; i++) {
        const d = fullJitterBackoffMs(attempt, BACKOFF_BASE_MS);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(ceil);
      }
    }
  });

  it('is deterministic with an injected rng', () => {
    // full jitter = rand() * base * 2^attempt
    expect(fullJitterBackoffMs(2, 750, () => 0.5)).toBe(0.5 * 750 * 4);
    expect(fullJitterBackoffMs(3, 750, () => 0)).toBe(0);
  });
});

describe('capDelayMs (§5 — never delay past the wall-clock budget)', () => {
  it('caps at MAX_BACKOFF_MS regardless of want', () => {
    expect(capDelayMs(50_000, Infinity, 0)).toBe(MAX_BACKOFF_MS);
  });

  it('passes a small want through when budget is ample', () => {
    expect(capDelayMs(1_000, Infinity, 0)).toBe(1_000);
  });

  it('clamps to the remaining budget minus slack', () => {
    // deadline 10s out, now 0 → remaining 10s − slack
    expect(capDelayMs(1_000, 10_000, 0)).toBe(1_000);
    expect(capDelayMs(50_000, 10_000, 0)).toBe(10_000 - BACKOFF_BUDGET_SLACK_MS);
  });

  it('returns 0 when the deadline is within the slack window (never hang past budget)', () => {
    expect(capDelayMs(1_000, 5_000, 4_500)).toBe(0);
    expect(capDelayMs(1_000, 1_000, 5_000)).toBe(0);
  });
});

describe('isThrottleStatus (§5 — block vs dead)', () => {
  it.each([0, 403, 429, 500, 502, 503, 504])('treats %i as a throttle (back off + halve)', (s) => {
    expect(isThrottleStatus(s)).toBe(true);
  });

  it.each([200, 301, 404, 410, 418])('does not treat %i as a throttle (dead/other → no backoff)', (s) => {
    expect(isThrottleStatus(s)).toBe(false);
  });
});

describe('AimdController (§5 — adaptive concurrency, T7)', () => {
  const OPTS = { start: 2, ceiling: 5, floor: 1, successStep: 5 } as const;
  const pool = (): ConcurrencyPool => ({ maxConcurrency: 99, desiredConcurrency: 99 });

  it('pins the pool to the start concurrency on construction', () => {
    const p = pool();
    const c = new AimdController(p, OPTS);
    expect(p.maxConcurrency).toBe(2);
    expect(p.desiredConcurrency).toBe(2);
    expect(c.telemetry).toEqual({ minConcurrency: 2, maxConcurrency: 2, halvings: 0, increases: 0 });
  });

  it('raises by 1 only after successStep consecutive successes', () => {
    const p = pool();
    const c = new AimdController(p, OPTS);
    for (let i = 0; i < 4; i++) c.onSuccess();
    expect(p.maxConcurrency).toBe(2); // not yet
    c.onSuccess(); // 5th
    expect(p.maxConcurrency).toBe(3);
    expect(p.desiredConcurrency).toBe(3);
    expect(c.telemetry.increases).toBe(1);
  });

  it('ramps to the ceiling and stops there', () => {
    const p = pool();
    const c = new AimdController(p, OPTS);
    for (let i = 0; i < 5 * 10; i++) c.onSuccess(); // far more than enough
    expect(p.maxConcurrency).toBe(5);
    expect(c.telemetry.maxConcurrency).toBe(5);
    expect(c.telemetry.increases).toBe(3); // 2→3→4→5
  });

  it('halves both max and desired on a throttle, flooring at floor', () => {
    const p = pool();
    const c = new AimdController(p, { start: 4, ceiling: 5, floor: 1, successStep: 5 });
    c.onThrottle();
    expect(p.maxConcurrency).toBe(2); // ceil(4/2)
    expect(p.desiredConcurrency).toBe(2);
    c.onThrottle();
    expect(p.maxConcurrency).toBe(1); // ceil(2/2)
    c.onThrottle();
    expect(p.maxConcurrency).toBe(1); // floored, no change
    expect(c.telemetry.minConcurrency).toBe(1);
    expect(c.telemetry.halvings).toBe(2); // the floored no-op is not counted
  });

  it('resets the success streak on a throttle', () => {
    const p = pool();
    const c = new AimdController(p, OPTS);
    for (let i = 0; i < 4; i++) c.onSuccess();
    c.onThrottle(); // 2→1, streak reset
    for (let i = 0; i < 4; i++) c.onSuccess();
    expect(p.maxConcurrency).toBe(1); // streak was reset, only 4 since → no raise
    c.onSuccess(); // 5th since reset
    expect(p.maxConcurrency).toBe(2);
  });
});
