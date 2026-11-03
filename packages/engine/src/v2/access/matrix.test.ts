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
import { CAUSES, EVIDENCE } from './cells.js';
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

  it('reads the search engines from robots.txt on the crawled pages', () => {
    const out = detectAccess(
      grid({
        pages: ['/', '/blog/a', '/blog/b'],
        search: [
          searchRobots('allowed'),
          searchRobots('disallowed_by_robots'),
          searchRobots('disallowed_by_robots'),
        ],
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
      // A partial disallow does not block the crawler from the site; the extent is kept.
      expect(out.detections.find((d) => d.key === `robots:${ua.toLowerCase()}`)).toMatchObject({
        state: 'not_detected',
        measured: 2 / 3,
        intent: null,
        affected_urls: [],
        evidence: { access_test_ids: [], pages: [u('/blog/a'), u('/blog/b')] },
      });
    }
  });

  it('a template robots.txt disallows a requested crawler on has no status: the 200 is robots.txt’s', () => {
    const out = detectAccess(
      grid({
        pages: ['/', '/p/1', '/p/2'],
        cells: { GPTBot: ['allowed', 'disallowed_by_robots', 'disallowed_by_robots'] },
      }),
    );
    expect(crawler(out, 'GPTBot').by_template).toEqual([
      { template_key: '/', verdict: 'allowed', status: 200 },
      { template_key: '/p/{slug}', verdict: 'disallowed_by_robots', status: null },
    ]);
  });

  it('a crawler with no cell is read as its kind is: robots.txt for a search engine', () => {
    const out = detectAccess({ access_tests: [], pages: [] });
    expect(crawler(out, 'Googlebot').evidence_class).toBe('declared');
    expect(crawler(out, 'GPTBot').evidence_class).toBe('simulated');
  });

  it('quotes a signature header whatever case the server wrote its name in', () => {
    const headers = [{ name: 'CF-Mitigated', value: 'challenge' }];
    const out = detectAccess(
      grid({ pages: ['/'], cells: { GPTBot: [{ verdict: 'challenged_ua', headers }] } }),
    );
    const edge = out.detections.find((d) => d.key === 'edge:gptbot')!;
    expect(edge.evidence.signatures).toEqual(['cf-mitigated: challenge']);
  });

  it('a detected block cites the blocked rows only, not the challenges beside them', () => {
    const challenge = {
      verdict: 'challenged_ua' as const,
      headers: [{ name: 'cf-mitigated', value: 'challenge' }],
    };
    const blocked = { verdict: 'blocked_by_ua_rule' as const, cause: 'cloudflare_1020' as const };
    const out = detectAccess(
      grid({
        pages: ['/', '/p/1', '/p/2', '/p/3'],
        cells: { GPTBot: [blocked, blocked, blocked, challenge] },
      }),
    );
    expect(out.detections.find((d) => d.key === 'edge:gptbot')).toMatchObject({
      state: 'detected',
      affected_urls: [u('/'), u('/p/1'), u('/p/2')],
      evidence: {
        pages: [u('/'), u('/p/1'), u('/p/2')],
        causes: ['cloudflare_1020'],
        signatures: [],
      },
    });
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

  /** `base` with one more page, on which GPTBot's row is `odd` and the others are served. */
  const withRow = (odd: ReturnType<typeof row>) => ({
    ...base,
    access_tests: [
      ...base.access_tests,
      odd,
      ...TESTABLE.filter((t) => t !== 'GPTBot').map((t) => row(t, '/p/2', 'allowed')),
    ],
  });

  it.each([
    ['robots_txt_disallow', 'challenged_ua'],
    ['bot_fight_mode', 'blocked_by_ua_rule'],
    ['verified_bot_only', 'refused_unverified'],
    ['client_rendered_template', 'allowed_thin'],
    ['cloudflare_1020', 'allowed'],
    ['automation_challenge', 'blocked_by_ua_rule'],
  ] as const)('refuses %s as the cause of %s: the worker never gives it', (cause, verdict) => {
    expect(() => detectAccess(withRow(row('GPTBot', '/p/2', { verdict, cause })))).toThrow(
      new RegExp(`names ${cause} as the cause of ${verdict}`),
    );
  });

  it.each([
    ['declared', 'blocked_by_ua_rule'],
    ['simulated', 'disallowed_by_robots'],
    ['declared', 'challenged_ua'],
  ] as const)('refuses %s evidence for %s', (evidence, verdict) => {
    expect(() => detectAccess(withRow(row('GPTBot', '/p/2', { verdict, evidence })))).toThrow(
      new RegExp(`rests ${verdict} on ${evidence} evidence`),
    );
  });

  it('refuses a page listed twice, whatever the registry holds', () => {
    const pages = [...base.pages, base.pages[0]!];
    expect(() => detectAccess({ ...base, pages })).toThrow(/pages list .* twice/);
    // With no search engine in the registry, the pages carry no robots.txt readings.
    const testable = CRAWLER_REGISTRY_V2.filter((e) => e.testable);
    const bare = pages.map((p) => ({ ...p, robots_search: [] }));
    expect(() => detectAccess({ ...base, pages: bare, registry: testable })).toThrow(
      /pages list .* twice/,
    );
  });

  it('refuses a robots.txt reading for a token that is not a search engine, a spelling included', () => {
    for (const ua of ['bingbot', 'GPTBot', 'Yandex']) {
      const pages = [{ ...base.pages[0]!, robots_search: [{ ua, verdict: 'allowed' as const }] }];
      expect(() => detectAccess({ ...base, pages })).toThrow(/not a search engine/);
    }
  });

  it('refuses a registry entry nothing measures, and two tokens that differ only in case', () => {
    const untested = CRAWLER_REGISTRY_V2.map((e) =>
      e.token === 'PerplexityBot' ? { ...e, testable: false } : e,
    );
    expect(() => detectAccess({ ...base, registry: untested })).toThrow(/nothing measures it/);
    const clash = [...CRAWLER_REGISTRY_V2, { ...CRAWLER_REGISTRY_V2[0]!, token: 'GOOGLEBOT' }];
    expect(() => detectAccess({ ...base, registry: clash })).toThrow(
      /spell googlebot in lower case/,
    );
  });

  it('refuses a sampled page that lacks a crawler’s row', () => {
    const missing = base.access_tests.filter(
      (t) => !(t.ua === 'ClaudeBot' && t.page_url === u('/p/1')),
    );
    expect(() => detectAccess({ ...base, access_tests: missing })).toThrow(/no row for ClaudeBot/);
  });
});

describe('the worker’s causes and evidence classes, by verdict', () => {
  it('are pinned in full: the input refused is exactly what the worker never writes', () => {
    expect(CAUSES).toEqual({
      allowed: [null],
      allowed_thin: [null],
      disallowed_by_robots: ['robots_txt_disallow'],
      blocked_by_ua_rule: [null, 'cloudflare_1020'],
      refused_unverified: [null, 'cloudflare_1020'],
      challenged_ua: ['automation_challenge'],
      rate_limited: ['rate_limit_429'],
      payment_required: ['pay_per_crawl_402'],
      redirected_away: ['cross_host_redirect'],
      edge_blocks_automation: [null, 'cloudflare_1020', 'automation_challenge'],
      not_measured: [null],
    });
    expect(EVIDENCE).toEqual({
      allowed: ['simulated'],
      allowed_thin: ['simulated'],
      disallowed_by_robots: ['declared'],
      blocked_by_ua_rule: ['simulated'],
      refused_unverified: ['simulated'],
      challenged_ua: ['simulated'],
      rate_limited: ['simulated'],
      payment_required: ['simulated'],
      redirected_away: ['simulated'],
      edge_blocks_automation: ['simulated'],
      not_measured: ['declared', 'simulated'],
    });
  });
});

describe('a detection record', () => {
  it('names affected pages only when detected', async () => {
    const { record } = await import('./record.js');
    const entry = CRAWLER_REGISTRY_V2.find((e) => e.token === 'GPTBot')!;
    const cell = {
      id: null,
      page_url: u('/'),
      template_key: '/',
      verdict: 'challenged_ua' as const,
      cause: 'automation_challenge' as const,
      status: 403,
      evidence_class: 'simulated' as const,
      headers: [],
    };
    expect(() =>
      record('edge_rule_blocks_crawler', entry, {
        state: 'indeterminate',
        reason: 'challenge_real_crawler_may_pass',
        measured: 0,
        confidence: 'inconclusive',
        affected: [cell],
        evidence: [cell],
      }),
    ).toThrow(/names affected pages/);
  });
});
