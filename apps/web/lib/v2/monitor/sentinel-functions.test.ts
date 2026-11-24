/**
 * Row 23: what production wires into the daily sentinel (sentinel-functions.ts). The work's rules are
 * tested with fakes in sentinel-work.test.ts; these pin the four that are decided here, at the wiring:
 * the hide switch, the crawl pause, the day's ceiling on starts, and the full check's day key.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const checkRateLimit = vi.fn(async (..._a: unknown[]) => ({ allowed: true, resetAt: new Date() }));
vi.mock('../../rate-limit', () => ({
  checkRateLimit: (...a: unknown[]) => checkRateLimit(...a),
}));

const requestCheck = vi.fn(async (..._a: unknown[]) => ({ checkId: 'check-1', created: true }));
vi.mock('../pipeline/request', () => ({
  requestCheck: (...a: unknown[]) => requestCheck(...a),
}));

const { sentinelDeps } = await import('./sentinel-functions');

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'placeholder',
};

beforeEach(() => {
  checkRateLimit.mockClear();
  requestCheck.mockClear();
});

describe('sentinelDeps', () => {
  it("is hidden exactly when V2_HIDE_FEATURES names 'sentinel'", () => {
    expect(sentinelDeps(ENV).shown()).toBe(true);
    expect(sentinelDeps({ ...ENV, V2_HIDE_FEATURES: 'sentinel' }).shown()).toBe(false);
    expect(sentinelDeps({ ...ENV, V2_HIDE_FEATURES: 'competitors' }).shown()).toBe(true);
  });

  it('is paused exactly when CRAWL_PAUSED is set', () => {
    expect(sentinelDeps(ENV).paused()).toBe(false);
    expect(sentinelDeps({ ...ENV, CRAWL_PAUSED: '1' }).paused()).toBe(true);
  });

  it("counts a full check against the day's ceiling on starts, which fails closed", async () => {
    const deps = sentinelDeps(ENV);
    expect(await deps.global()).toBe(true);
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    const [key, , , opts] = checkRateLimit.mock.calls[0]!;
    expect(key).toBe('global:audits:day');
    expect(opts).toEqual({ failClosed: true });
    checkRateLimit.mockResolvedValueOnce({ allowed: false, resetAt: new Date() });
    expect(await deps.global()).toBe(false);
  });

  it("requests the full check as scheduled, keyed on the watch's day", async () => {
    expect(await sentinelDeps(ENV).request('site-1', '2026-11-24')).toBe('check-1');
    expect(requestCheck).toHaveBeenCalledTimes(1);
    expect(requestCheck.mock.calls[0]![1]).toEqual({
      siteId: 'site-1',
      trigger: 'scheduled',
      sentinelDay: '2026-11-24',
    });
  });
});
