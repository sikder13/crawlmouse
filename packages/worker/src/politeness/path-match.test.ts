/**
 * PathMatch matches each robots.txt group once per path, whichever agents fall back to it: our own
 * requests and the search engines' verdicts share it. Counted by wrapping the engine's matcher.
 */
import { describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ n: 0 }));
vi.mock('@crawlmouse/engine/worker', async (importOriginal) => {
  const real = await importOriginal<typeof import('@crawlmouse/engine/worker')>();
  return {
    ...real,
    isAllowedByRobots: (...args: Parameters<typeof real.isAllowedByRobots>) => {
      calls.n++;
      return real.isAllowedByRobots(...args);
    },
  };
});

const { readRobots, oursAllow, PathMatch, searchVerdicts } = await import('./robots.js');
const { outcome } = await import('../test-support/outcome.js');

const reading = (text: string) => {
  const r = readRobots(outcome({ body: text, headers: { 'content-type': 'text/plain' } }));
  if (r.state !== 'rules') throw new Error(r.state);
  return r;
};

describe('PathMatch', () => {
  it('matches `*` once for our requests and both search engines when none has a group', () => {
    const r = reading('User-agent: *\nDisallow: /cart\n');
    calls.n = 0;
    const match = new PathMatch(r.rules, '/cart');
    expect(oursAllow(r.rules, '/cart', match)).toBe(false);
    expect(searchVerdicts(r, '/cart', match).map((v) => v.verdict)).toEqual([
      'disallowed_by_robots',
      'disallowed_by_robots',
    ]);
    expect(calls.n).toBe(1);
  });

  it('matches a group of its own separately, and gives what the engine gives', () => {
    const r = reading('User-agent: *\nDisallow: /cart\n\nUser-agent: Googlebot\nAllow: /\n');
    calls.n = 0;
    const match = new PathMatch(r.rules, '/cart');
    const verdicts = searchVerdicts(r, '/cart', match);
    expect(oursAllow(r.rules, '/cart', match)).toBe(false);
    expect(verdicts.map((v) => [v.ua, v.verdict])).toEqual([
      ['Googlebot', 'allowed'],
      ['Bingbot', 'disallowed_by_robots'],
    ]);
    expect(calls.n).toBe(2);
  });

  it('matches a group several agents name in the file once, for all of them', () => {
    const r = reading(
      'User-agent: Crawlmouse\nUser-agent: Googlebot\nUser-agent: bingbot\nDisallow: /x\n',
    );
    calls.n = 0;
    const match = new PathMatch(r.rules, '/x');
    expect(oursAllow(r.rules, '/x', match)).toBe(false);
    expect(searchVerdicts(r, '/x', match).map((v) => v.verdict)).toEqual([
      'disallowed_by_robots',
      'disallowed_by_robots',
    ]);
    expect(calls.n).toBe(1);
  });
});
