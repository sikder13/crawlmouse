import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { siteOrigin, siteUrl, siteHost } from './site-url';

const ORIGINAL = process.env.NEXT_PUBLIC_BASE_URL;

describe('site-url', () => {
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
    else process.env.NEXT_PUBLIC_BASE_URL = ORIGINAL;
  });

  describe('with a configured base url', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_BASE_URL = 'https://staging.crawlmouse.com/';
    });
    it('strips a trailing slash from the origin', () => {
      expect(siteOrigin()).toBe('https://staging.crawlmouse.com');
    });
    it('joins a path with exactly one slash', () => {
      expect(siteUrl('/r/abc')).toBe('https://staging.crawlmouse.com/r/abc');
      expect(siteUrl('r/abc')).toBe('https://staging.crawlmouse.com/r/abc');
    });
    it('returns the host without scheme', () => {
      expect(siteHost()).toBe('staging.crawlmouse.com');
    });
  });

  describe('without a configured base url', () => {
    beforeEach(() => {
      delete process.env.NEXT_PUBLIC_BASE_URL;
    });
    it('falls back to the prod origin', () => {
      expect(siteOrigin()).toBe('https://crawlmouse.com');
      expect(siteHost()).toBe('crawlmouse.com');
    });
  });

  it('treats an empty-string env var as unset', () => {
    process.env.NEXT_PUBLIC_BASE_URL = '   ';
    expect(siteOrigin()).toBe('https://crawlmouse.com');
  });
});
