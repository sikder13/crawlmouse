import { describe, it, expect } from 'vitest';
import {
  homepageFetchTimeoutMs,
  DEFAULT_HOMEPAGE_FETCH_TIMEOUT_MS,
  MIN_HOMEPAGE_FETCH_TIMEOUT_MS,
  MAX_HOMEPAGE_FETCH_TIMEOUT_MS,
  crawlWallClockMs,
  DEFAULT_CRAWL_WALL_CLOCK_MS,
  MIN_CRAWL_WALL_CLOCK_MS,
  MAX_CRAWL_WALL_CLOCK_MS,
} from './audit-config.js';

const env = (v?: string) => ({ HOMEPAGE_FETCH_TIMEOUT_MS: v }) as Record<string, string | undefined>;
const cenv = (v?: string) => ({ CRAWL_WALL_CLOCK_MS: v }) as Record<string, string | undefined>;

describe('homepageFetchTimeoutMs', () => {
  it('defaults to 15s when the env var is unset', () => {
    expect(homepageFetchTimeoutMs(env(undefined))).toBe(DEFAULT_HOMEPAGE_FETCH_TIMEOUT_MS);
    expect(DEFAULT_HOMEPAGE_FETCH_TIMEOUT_MS).toBe(15_000);
  });

  it('uses a valid positive override', () => {
    expect(homepageFetchTimeoutMs(env('20000'))).toBe(20_000);
  });

  it('tolerates surrounding whitespace (Number-coercion)', () => {
    expect(homepageFetchTimeoutMs(env('  18000  '))).toBe(18_000);
  });

  it('clamps an override above the ceiling down to the max', () => {
    expect(homepageFetchTimeoutMs(env('999999'))).toBe(MAX_HOMEPAGE_FETCH_TIMEOUT_MS);
  });

  it('clamps a too-small positive override up to the floor (anti-footgun)', () => {
    expect(homepageFetchTimeoutMs(env('100'))).toBe(MIN_HOMEPAGE_FETCH_TIMEOUT_MS);
  });

  it('falls back to the default for zero / negative / non-numeric / empty', () => {
    for (const bad of ['0', '-5000', 'abc', '', '   ', 'NaN']) {
      expect(homepageFetchTimeoutMs(env(bad))).toBe(DEFAULT_HOMEPAGE_FETCH_TIMEOUT_MS);
    }
  });

  it('gives the homepage MORE headroom than a single deep page (per-page budget is 10s)', () => {
    // The Issue-2 invariant: the homepage — the first, often-heaviest fetch that gates the whole
    // run — must get a longer budget than one deep page (Crawlee pageTimeoutMs = 10s). If someone
    // lowers the homepage default to/below the per-page budget, this fails loudly.
    expect(DEFAULT_HOMEPAGE_FETCH_TIMEOUT_MS).toBeGreaterThan(10_000);
  });
});

describe('crawlWallClockMs', () => {
  it('defaults to 240s when the env var is unset', () => {
    expect(crawlWallClockMs(cenv(undefined))).toBe(DEFAULT_CRAWL_WALL_CLOCK_MS);
    expect(DEFAULT_CRAWL_WALL_CLOCK_MS).toBe(240_000);
  });

  it('uses a valid positive override', () => {
    expect(crawlWallClockMs(cenv('180000'))).toBe(180_000);
  });

  it('clamps an override above the ceiling down to the max', () => {
    expect(crawlWallClockMs(cenv('999999'))).toBe(MAX_CRAWL_WALL_CLOCK_MS);
  });

  it('clamps a too-small positive override up to the floor', () => {
    expect(crawlWallClockMs(cenv('1000'))).toBe(MIN_CRAWL_WALL_CLOCK_MS);
  });

  it('falls back to the default for zero / negative / non-numeric / empty', () => {
    for (const bad of ['0', '-1', 'abc', '', '   ']) {
      expect(crawlWallClockMs(cenv(bad))).toBe(DEFAULT_CRAWL_WALL_CLOCK_MS);
    }
  });

  it('stays comfortably under the 300s Vercel function ceiling (maxDuration)', () => {
    // The whole point of the budget: bound the crawl so a pathological site fails as a clean
    // classified timeout BEFORE the function is killed at 300s. Both the default and the ceiling
    // must leave headroom for the homepage fetch + persist + overhead.
    expect(MAX_CRAWL_WALL_CLOCK_MS).toBeLessThan(300_000);
    expect(DEFAULT_CRAWL_WALL_CLOCK_MS).toBeLessThanOrEqual(MAX_CRAWL_WALL_CLOCK_MS);
  });
});
