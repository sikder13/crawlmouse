import { describe, it, expect } from 'vitest';
import { isCrawlPaused, CRAWL_PAUSED_MESSAGE } from './crawl-pause';

describe('isCrawlPaused', () => {
  it('is paused only for the value 1 (surrounding whitespace ignored, e.g. a value pasted as "1\\n")', () => {
    expect(isCrawlPaused({ CRAWL_PAUSED: '1' })).toBe(true);
    expect(isCrawlPaused({ CRAWL_PAUSED: ' 1\n' })).toBe(true);
  });

  it('is NOT paused when unset, empty, 0, or any other value', () => {
    for (const v of [undefined, '', '0', 'true', 'yes', '11', 'paused']) {
      expect(isCrawlPaused({ CRAWL_PAUSED: v })).toBe(false);
    }
    expect(isCrawlPaused({})).toBe(false);
  });

  it('has a short, user-readable refusal message (the client renders `error` verbatim)', () => {
    expect(CRAWL_PAUSED_MESSAGE.length).toBeGreaterThan(10);
    expect(CRAWL_PAUSED_MESSAGE.length).toBeLessThan(120);
  });
});
