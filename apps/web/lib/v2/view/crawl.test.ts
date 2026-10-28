import { describe, expect, it } from 'vitest';
import { LOG_PATH_MAX, shortPath } from './crawl';

describe('a log line’s path', () => {
  it('is shown whole up to the limit', () => {
    const p = '/products/ridge-2p';
    expect(shortPath(p)).toBe(p);
    const exact = `/${'a'.repeat(LOG_PATH_MAX - 1)}`;
    expect(shortPath(exact)).toBe(exact);
  });

  it('keeps the start and end of a longer one, the cut marked, within the limit', () => {
    const s = shortPath('/journal/layering-for-shoulder-season');
    expect(s).toBe('/journal/lay…lder-season');
    expect(s.length).toBe(LOG_PATH_MAX);
    expect(s.startsWith('/journal/')).toBe(true);
    expect(s.endsWith('-season')).toBe(true);
  });
});
