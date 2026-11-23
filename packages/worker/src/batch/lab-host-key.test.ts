import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Fetcher } from '../fetch/fetcher.js';
import { FLOOR_GAP_MS } from '../politeness/limiter.js';
import { Sites } from '../politeness/sites.js';
import { outcome } from '../test-support/outcome.js';
import { VirtualClock } from '../test-support/virtual-clock.js';
import { BUDGET_CEILINGS, type BatchRequest } from './request.js';
import { runBatch } from './run.js';
import { RobotsCache } from './site-rules.js';

/** Two lab hosts through the real batch path, sharing one process's politeness state (F-018). */
const A = 'a.lab.crawlmouse.com';
const B = 'b.lab.crawlmouse.com';
const request = (host: string, i: number, pages: number): BatchRequest => ({
  kind: 'crawl',
  check_id: `00000000-0000-4000-8000-00000000000${i}`,
  site_id: '00000000-0000-4000-8000-0000000000a1',
  batch: 1,
  nonce: 'n'.repeat(16),
  jwt: 'x',
  budget: BUDGET_CEILINGS,
  urls: Array.from({ length: pages }, (_, k) => `https://${host}/p/${k}`),
});

function harness(
  perLabHost: boolean,
  answer: (host: string, path: string) => 'ok' | '429' | 'challenge',
  robots = (_host: string) => '',
) {
  const clock = new VirtualClock();
  const seen = new Map<string, number[]>();
  const fetcher: Fetcher = async (url, identity, limits) => {
    const u = new URL(url);
    if (u.pathname.startsWith('/p/'))
      seen.set(u.hostname, [...(seen.get(u.hostname) ?? []), clock.now()]);
    const common = {
      url,
      identity,
      startedAt: clock.now(),
      finalUrl: url,
      maxBytes: limits.maxBytes,
    };
    if (u.pathname === '/robots.txt')
      return outcome({
        ...common,
        status: 200,
        headers: { 'content-type': 'text/plain' },
        body: `User-agent: *\nAllow: /\n${robots(u.hostname)}`,
      });
    const a = answer(u.hostname, u.pathname);
    if (a === '429')
      return outcome({
        ...common,
        status: 429,
        headers: { 'content-type': 'text/plain' },
        body: 'slow down',
      });
    if (a === 'challenge')
      return outcome({
        ...common,
        status: 403,
        headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' },
        body: '<html><title>Just a moment...</title></html>',
      });
    return outcome({
      ...common,
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: `<!doctype html><title>${u.pathname}</title><p>page</p>`,
    });
  };
  const deps = {
    clock,
    sites: new Sites(clock, perLabHost),
    fetcher,
    robotsCache: new RobotsCache(clock),
  };
  return {
    clock,
    seen,
    run: (reqs: BatchRequest[]) => clock.run(Promise.all(reqs.map((r) => runBatch(r, deps)))),
  };
}

describe.each([
  ['three 429s', '429', 3],
  ['four challenged pages', 'challenge', 4],
] as const)('a stop from %s on one lab host', (_name, bad, stopsAfter) => {
  const go = async (perLabHost: boolean) => {
    const h = harness(perLabHost, (host) => (host === A ? bad : 'ok'));
    await h.run([request(A, 1, 6)]);
    await h.run([request(B, 2, 3)]);
    return { a: h.seen.get(A)!.length, b: h.seen.get(B)?.length ?? 0 };
  };

  it('stops that host, and not another lab host, with the setting on', async () => {
    expect(await go(true)).toEqual({ a: stopsAfter, b: 3 });
  });

  it('stops every lab host with it off, as today', async () => {
    expect(await go(false)).toEqual({ a: stopsAfter, b: 0 });
  });
});

describe('pace', () => {
  const gaps = (ts: number[]) => ts.slice(1).map((t, i) => t - ts[i]!);

  it('with the setting on, one lab host’s Crawl-delay stays its own', async () => {
    const h = harness(
      true,
      () => 'ok',
      (host) => (host === A ? 'Crawl-delay: 3\n' : ''),
    );
    await h.run([request(A, 1, 4), request(B, 2, 4)]);
    expect(Math.max(...gaps(h.seen.get(B)!))).toBe(FLOOR_GAP_MS);
    expect(Math.min(...gaps(h.seen.get(A)!))).toBeGreaterThanOrEqual(3000);
  });

  it('with it off, two lab hosts share one limiter, as today', async () => {
    const h = harness(false, () => 'ok');
    await h.run([request(A, 1, 4), request(B, 2, 4)]);
    const all = [...h.seen.get(A)!, ...h.seen.get(B)!].sort((x, y) => x - y);
    expect(Math.min(...gaps(all))).toBeGreaterThanOrEqual(FLOOR_GAP_MS);
  });
});

describe('every politeness call in batch/ goes through the Sites key', () => {
  const dir = new URL('.', import.meta.url);
  const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

  it('reads the batch sources', () => {
    expect(sources).toEqual(
      expect.arrayContaining([
        'polite-fetch.ts',
        'crawl.ts',
        'access.ts',
        'run.ts',
        'site-rules.ts',
      ]),
    );
  });

  it.each(sources)('%s passes no registrable-domain key to the limiter or the stop', (file) => {
    const text = readFileSync(new URL(file, dir), 'utf8');
    expect(text).not.toMatch(/sites\s*\.\s*(limiter|recordPage|record429|stopOf)\(\s*siteKeyOf/);
    expect(text).not.toMatch(/requested\.map\(siteKeyOf\)/);
    expect(text).not.toMatch(/const site = siteKeyOf\(/);
  });
});
