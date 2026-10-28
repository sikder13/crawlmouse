import { describe, expect, it } from 'vitest';
import { MAX_ROBOTS_BYTES, readRobots } from '../politeness/robots.js';
import { InstantClock } from '../test-support/clock.js';
import { outcome } from '../test-support/outcome.js';
import { ROBOTS_CACHE_BYTES, ROBOTS_TTL_MS, RobotsCache, readingSize } from './site-rules.js';

const text = (body: string) =>
  readRobots(outcome({ body, headers: { 'content-type': 'text/plain' } }));
/** A reading of about `kib` KiB by readingSize: one group of long rules. */
const sized = (kib: number, tag: string) => {
  const rule = `/${tag}-${'r'.repeat(1000)}`;
  const lines = Array.from({ length: Math.round(kib / 2) }, (_, i) => `Disallow: ${rule}${i}`);
  return text(`User-agent: *\n${lines.join('\n')}\n`);
};

describe('RobotsCache', () => {
  it(`holds at most ${ROBOTS_CACHE_BYTES / 1048576} MiB of readings, forgetting the oldest first`, () => {
    const cache = new RobotsCache(new InstantClock());
    const one = sized(400, 'x');
    expect(readingSize(one)).toBeGreaterThan(350 * 1024);
    const n = Math.ceil((2 * ROBOTS_CACHE_BYTES) / readingSize(one));
    for (let i = 0; i < n; i++) cache.set(`https://s${i}.example.com`, sized(400, `s${i}`));
    expect(cache.size.bytes).toBeLessThanOrEqual(ROBOTS_CACHE_BYTES);
    expect(cache.size.entries).toBeLessThan(n);
    expect(cache.get('https://s0.example.com')).toBeNull();
    expect(cache.get(`https://s${n - 1}.example.com`)).not.toBeNull();
  });

  it('counts a reading it replaces only once', () => {
    const cache = new RobotsCache(new InstantClock());
    const r = sized(10, 'a');
    cache.set('https://a.example.com', r);
    cache.set('https://a.example.com', r);
    expect(cache.size).toEqual({ entries: 1, bytes: readingSize(r) });
  });

  it('keeps rules, no robots.txt and too large to evaluate; not unreachable or refused', () => {
    const cache = new RobotsCache(new InstantClock());
    const big = outcome({
      status: null,
      finalUrl: null,
      error: 'too_large',
      maxBytes: MAX_ROBOTS_BYTES,
    });
    const readings = {
      rules: text('User-agent: *\nDisallow: /x'),
      none: readRobots(outcome({ status: 404, body: '' })),
      too_large: readRobots(big),
      unreachable: readRobots(outcome({ status: 503, body: '' })),
      refused: readRobots(outcome({ status: null, finalUrl: null, error: 'ssrf_refused' })),
    };
    for (const [origin, r] of Object.entries(readings)) {
      expect(r.state).toBe(origin);
      cache.set(origin, r);
    }
    expect(Object.keys(readings).filter((o) => cache.get(o) !== null)).toEqual([
      'rules',
      'none',
      'too_large',
    ]);
  });

  it(`forgets a reading after ${ROBOTS_TTL_MS / 60_000} minutes`, () => {
    const clock = new InstantClock();
    const cache = new RobotsCache(clock);
    cache.set('o', text('User-agent: *\nDisallow: /x'));
    clock.advance(ROBOTS_TTL_MS - 1);
    expect(cache.get('o')).not.toBeNull();
    clock.advance(1);
    expect(cache.get('o')).toBeNull();
    expect(cache.size).toEqual({ entries: 0, bytes: 0 });
  });
});
