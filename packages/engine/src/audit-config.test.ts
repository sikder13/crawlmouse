import { describe, it, expect } from 'vitest';
import {
  homepageFetchTimeoutMs,
  DEFAULT_HOMEPAGE_FETCH_TIMEOUT_MS,
  MIN_HOMEPAGE_FETCH_TIMEOUT_MS,
  MAX_HOMEPAGE_FETCH_TIMEOUT_MS,
} from './audit-config.js';

const env = (v?: string) => ({ HOMEPAGE_FETCH_TIMEOUT_MS: v }) as Record<string, string | undefined>;

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
