import { describe, expect, it } from 'vitest';
import { CRAWLER_REGISTRY_V2 } from '../crawler-registry.js';
import { userAgentOf, verifyCrawler } from './crawler.js';

const TESTABLE = CRAWLER_REGISTRY_V2.filter((e) => e.testable).map((e) => e.token);
const crawlers = (served: readonly string[]) =>
  CRAWLER_REGISTRY_V2.map((e) => ({
    ua: e.token,
    verdict: served.includes(e.token) ? ('allowed' as const) : ('blocked_by_ua_rule' as const),
  }));

describe('verifyCrawler', () => {
  it('requests as the first testable crawler the site serves today, in registry order', () => {
    const [first, second] = TESTABLE;
    expect(verifyCrawler({ crawlers: crawlers([second!, first!]) })?.token).toBe(first);
    expect(verifyCrawler({ crawlers: crawlers([second!]) })?.token).toBe(second);
  });

  it('counts a thin answer as served', () => {
    const rows = crawlers([]).map((c) =>
      c.ua === TESTABLE[1] ? { ...c, verdict: 'allowed_thin' as const } : c,
    );
    expect(verifyCrawler({ crawlers: rows })?.token).toBe(TESTABLE[1]);
  });

  it('prefers the crawler the fix itself lets in, though it is blocked today', () => {
    const blocked = TESTABLE.at(-1)!;
    expect(verifyCrawler({ crawlers: crawlers([TESTABLE[0]!]) }, blocked)?.token).toBe(blocked);
  });

  it('is null when the site serves no testable crawler', () => {
    expect(verifyCrawler({ crawlers: crawlers([]) })).toBe(null);
    expect(verifyCrawler({ crawlers: [] })).toBe(null);
  });

  it('never requests as a crawler we cannot test as', () => {
    const untestable = CRAWLER_REGISTRY_V2.filter((e) => !e.testable).map((e) => e.token);
    expect(untestable.length).toBeGreaterThan(0);
    expect(verifyCrawler({ crawlers: crawlers(untestable) })).toBe(null);
    expect(verifyCrawler({ crawlers: crawlers([]) }, untestable[0]!)).toBe(null);
  });
});

describe('userAgentOf', () => {
  it('is the operator’s string, or the token where the operator prints none', () => {
    for (const e of CRAWLER_REGISTRY_V2) {
      expect(userAgentOf(e)).toBe(e.ua_string ?? e.token);
    }
    expect(CRAWLER_REGISTRY_V2.some((e) => e.ua_string === null)).toBe(true);
  });
});
