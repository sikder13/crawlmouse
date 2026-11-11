import { describe, expect, it } from 'vitest';
import { MAX_RATE_LIMIT_WINDOW_MS, rateLimitWindowStart } from './rate-limit-window';

describe('rateLimitWindowStart', () => {
  it('aligns a day window to UTC midnight, the same start for every moment of the day', () => {
    const day = MAX_RATE_LIMIT_WINDOW_MS;
    const start = '2026-11-10T00:00:00.000Z';
    for (const t of [
      '2026-11-10T00:00:00.000Z',
      '2026-11-10T13:45:12.345Z',
      '2026-11-10T23:59:59.999Z',
    ])
      expect(rateLimitWindowStart(Date.parse(t), day).toISOString()).toBe(start);
    expect(rateLimitWindowStart(Date.parse('2026-11-11T00:00:00.000Z'), day).toISOString()).toBe(
      '2026-11-11T00:00:00.000Z',
    );
  });
});
