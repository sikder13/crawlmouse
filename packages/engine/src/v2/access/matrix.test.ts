import { describe, expect, it } from 'vitest';
import {
  every,
  grid,
  row,
  searchRobots,
  SEARCH,
  TESTABLE,
  u,
} from '../../../fixtures/v2/access/builders.js';
import { CRAWLER_REGISTRY_V2 } from '../crawler-registry.js';
import { detectAccess } from './index.js';

const crawler = (out: ReturnType<typeof detectAccess>, ua: string) =>
  out.crawlers.find((c) => c.ua === ua)!;

describe('the matrix', () => {
  it('has one row per registry crawler, in registry order, with the registry’s group and scoring', () => {
    const out = detectAccess(grid({ pages: ['/'] }));
    expect(out.crawlers.map((c) => [c.ua, c.group, c.scored])).toEqual(
      CRAWLER_REGISTRY_V2.map((e) => [e.token, e.group, e.scored]),
    );
  });

  it('reads the search engines from robots.txt alone, the disallowed URLs included', () => {
    const out = detectAccess(
      grid({
        pages: ['/', '/blog/a'],
        search: [searchRobots('allowed'), searchRobots('disallowed_by_robots')],
        disallowed: [{ url: u('/cart'), robots_search: searchRobots('disallowed_by_robots') }],
      }),
    );
    for (const ua of SEARCH) {
      // Disallowed on two of three, allowed on the homepage: allowed for the site, never blocked.
      expect(crawler(out, ua)).toMatchObject({
        verdict: 'allowed',
        evidence_class: 'declared',
        status: null,
        confidence: 'likely',
        pages_measured: 3,
        counts: { allowed: 1, disallowed_by_robots: 2 },
        supporting: { access_test_ids: [], pages: [u('/')] },
        by_template: [
          { template_key: '/', verdict: 'allowed', status: null },
          { template_key: '/blog/{slug}', verdict: 'disallowed_by_robots', status: null },
        ],
      });
      expect(out.detections.find((d) => d.key === `robots:${ua.toLowerCase()}`)).toMatchObject({
        state: 'detected',
        measured: 2 / 3,
        intent: 'respected',
        affected_urls: [u('/blog/a'), u('/cart')],
        evidence: { access_test_ids: [], causes: ['robots_txt_disallow'] },
      });
    }
  });

  it('a search engine disallowed everywhere is disallowed for the site, as respected intent', () => {
    const out = detectAccess(
      grid({
        pages: ['/', '/blog/a'],
        search: [searchRobots('disallowed_by_robots'), searchRobots('disallowed_by_robots')],
      }),
    );
    for (const ua of SEARCH)
      expect(crawler(out, ua)).toMatchObject({
        verdict: 'disallowed_by_robots',
        cause: 'robots_txt_disallow',
        confidence: 'confirmed',
        intent: 'respected',
      });
  });

  it('gives a search engine with no robots.txt reading no verdict', () => {
    const out = detectAccess({ ...grid({ pages: ['/'] }), pages: [] });
    for (const ua of SEARCH)
      expect(crawler(out, ua)).toMatchObject({
        verdict: 'not_measured',
        pages_measured: 0,
        confidence: 'inconclusive',
        by_template: [],
      });
  });

  it('reads a search engine robots.txt has no verdict for on a page as not measured there', () => {
    const input = grid({ pages: ['/', '/p/1'] });
    const pages = input.pages.map((p) => ({
      ...p,
      robots_search: p.robots_search.filter((r) => r.ua !== 'Googlebot'),
    }));
    const out = detectAccess({ ...input, pages });
    expect(crawler(out, 'Googlebot')).toMatchObject({ verdict: 'not_measured', pages_measured: 0 });
    expect(out.detections.find((d) => d.key === 'robots:googlebot')).toMatchObject({
      state: 'indeterminate',
      reason: 'robots_not_read',
    });
    expect(crawler(out, 'Bingbot').verdict).toBe('allowed');
  });

  it('judges each template on its own pages', () => {
    const out = detectAccess(
      grid({
        pages: ['/', '/p/1', '/p/2', '/blog/a'],
        cells: { GPTBot: ['allowed', 'blocked_by_ua_rule', 'blocked_by_ua_rule', 'challenged_ua'] },
      }),
    );
    expect(crawler(out, 'GPTBot').by_template).toEqual([
      { template_key: '/', verdict: 'allowed', status: 200 },
      { template_key: '/blog/{slug}', verdict: 'challenged_ua', status: 403 },
      { template_key: '/p/{slug}', verdict: 'blocked_by_ua_rule', status: 403 },
    ]);
  });

  it('names the supporting rows: the cells that carry the site verdict', () => {
    const input = grid({
      pages: ['/', '/p/1', '/p/2'],
      cells: { GPTBot: ['challenged_ua', 'challenged_ua', 'allowed'] },
    });
    const ids = input.access_tests
      .filter((t) => t.ua === 'GPTBot' && t.verdict === 'challenged_ua')
      .map((t) => t.id)
      .sort();
    expect(crawler(detectAccess(input), 'GPTBot').supporting).toEqual({
      access_test_ids: ids,
      pages: [u('/'), u('/p/1')],
    });
  });

  it('ignores the control’s and the canary’s rows', () => {
    const input = grid({ pages: ['/'] });
    const withCanary = {
      ...input,
      access_tests: [...input.access_tests, row(null, '/', 'refused_unverified')],
    };
    expect(detectAccess(withCanary)).toEqual(detectAccess(input));
  });
});

describe('withholding the access score', () => {
  const scored = CRAWLER_REGISTRY_V2.filter((e) => e.scored).map((e) => e.token);
  const others = (verdict: 'not_measured' | 'edge_blocks_automation') =>
    Object.fromEntries(TESTABLE.map((t) => [t, every(2, verdict)]));

  it.each([
    [0, true],
    [1, true],
    [2, false],
    [4, false],
  ])('%i scored crawlers measured: withheld %s', (k, withheld) => {
    const cells = { ...others('not_measured') };
    for (const t of scored.slice(0, k)) cells[t] = every(2, 'allowed');
    const out = detectAccess(grid({ pages: ['/', '/p/1'], cells }));
    expect({ scored: out.scored_measured, withheld: out.access_withheld }).toEqual({
      scored: k,
      withheld,
    });
  });

  it('an edge that blocks our requests leaves the crawler unmeasured', () => {
    const out = detectAccess(grid({ pages: ['/'], cells: others('edge_blocks_automation') }));
    expect(out.access_withheld).toBe(true);
  });

  it('the unscored crawlers do not count', () => {
    const cells = {
      ...others('not_measured'),
      GPTBot: ['allowed' as const],
      ClaudeBot: ['allowed' as const],
    };
    const out = detectAccess(grid({ pages: ['/'], cells }));
    expect(out.scored_measured).toBe(0);
  });
});

describe('input the contract does not allow', () => {
  const base = grid({ pages: ['/', '/p/1'] });

  it('refuses a row for a crawler the registry does not list, a spelling of its token included', () => {
    for (const ua of ['NotABot', 'gptbot', 'GPTBOT', ' GPTBot'])
      expect(() =>
        detectAccess({ ...base, access_tests: [...base.access_tests, row(ua, '/p/2', 'allowed')] }),
      ).toThrow(/not a crawler the worker requests as/);
  });

  it('refuses a row for a crawler the worker never requests as', () => {
    expect(() =>
      detectAccess({
        ...base,
        access_tests: [...base.access_tests, row('Googlebot', '/', 'allowed')],
      }),
    ).toThrow(/not a crawler the worker requests as/);
  });

  it('refuses two rows for one crawler on one page', () => {
    const dup = base.access_tests.find((t) => t.ua === 'GPTBot')!;
    expect(() => detectAccess({ ...base, access_tests: [...base.access_tests, dup] })).toThrow(
      /twice/,
    );
  });

  it('refuses a robots.txt cause on a row whose verdict is not a robots.txt disallow', () => {
    const odd = row('GPTBot', '/p/2', { verdict: 'challenged_ua', cause: 'robots_txt_disallow' });
    const rest = TESTABLE.filter((t) => t !== 'GPTBot').map((t) => row(t, '/p/2', 'allowed'));
    expect(() =>
      detectAccess({ ...base, access_tests: [...base.access_tests, odd, ...rest] }),
    ).toThrow(/names robots.txt as the cause of challenged_ua/);
  });

  it('refuses a sampled page that lacks a crawler’s row', () => {
    const missing = base.access_tests.filter(
      (t) => !(t.ua === 'ClaudeBot' && t.page_url === u('/p/1')),
    );
    expect(() => detectAccess({ ...base, access_tests: missing })).toThrow(/no row for ClaudeBot/);
  });
});
