import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Check, CrawlBatchResult } from '@crawlmouse/types/v2';
import { ledgerDraft, LedgerDraftSchema, robotsRule, statusShares, type DraftInput } from './draft';

type Page = Pick<CrawlBatchResult['pages'][number], 'url' | 'status_code'>;
const batch = (pages: Page[]) => ({ pages }) as unknown as Pick<CrawlBatchResult, 'pages'>;
const page = (n: number, status_code: number | null): Page => ({
  url: `https://site.example/p${n}`,
  status_code,
});

describe('robotsRule', () => {
  it.each([
    [null, 'GPTBot', 'not_read'],
    ['', 'GPTBot', 'no_group'],
    ['User-agent: Googlebot\nDisallow: /', 'GPTBot', 'no_group'],
    ['User-agent: GPTBot\nDisallow:', 'GPTBot', 'named_allow_all'],
    ['User-agent: gptbot\nAllow: /', 'GPTBot', 'named_allow_all'],
    ['User-agent: GPTBot\nDisallow: /', 'GPTBot', 'named_disallow_all'],
    ['User-agent: GPTBot\nDisallow: /*', 'GPTBot', 'named_disallow_all'],
    ['User-agent: GPTBot\nDisallow: /\nAllow: /blog', 'GPTBot', 'named_partial'],
    ['User-agent: GPTBot\nDisallow: /private', 'GPTBot', 'named_partial'],
    ['User-agent: *\nDisallow:', 'GPTBot', 'wildcard_allow_all'],
    ['User-agent: *\nDisallow: /', 'GPTBot', 'wildcard_disallow_all'],
    ['User-agent: *\nDisallow: /admin', 'GPTBot', 'wildcard_partial'],
    // The crawler's own group wins over the wildcard, whichever comes first.
    ['User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /', 'GPTBot', 'named_allow_all'],
  ])('%j for %s is %s', (txt, token, expected) => {
    expect(robotsRule(txt, token)).toBe(expected);
  });

  it('reads a group named __proto__ as a name, not as the object prototype', () => {
    expect(robotsRule('User-agent: __proto__\nDisallow: /', 'GPTBot')).toBe('no_group');
    expect(robotsRule('User-agent: *\nDisallow: /', '__proto__')).toBe('wildcard_disallow_all');
  });
});

describe('statusShares', () => {
  it('is all 0 for no pages', () => {
    expect(statusShares([])).toEqual({
      share_2xx: 0,
      share_3xx: 0,
      share_4xx: 0,
      share_5xx: 0,
      share_unanswered: 0,
    });
  });

  it('counts an unanswered page, and a page fetched twice once, as its last fetch', () => {
    expect(
      statusShares([batch([page(1, 500), page(2, 200)]), batch([page(1, 200), page(3, null)])]),
    ).toEqual({
      share_2xx: 0.67,
      share_3xx: 0,
      share_4xx: 0,
      share_5xx: 0,
      share_unanswered: 0.33,
    });
  });

  it('thirds round to exactly 1 by largest remainder', () => {
    const s = statusShares([batch([page(1, 200), page(2, 301), page(3, 404)])]);
    expect(s).toEqual({
      share_2xx: 0.34,
      share_3xx: 0.33,
      share_4xx: 0.33,
      share_5xx: 0,
      share_unanswered: 0,
    });
  });

  it('property: each share is in 0..1 to two decimals, and they sum to 0 or exactly 1', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.constant(null), fc.integer({ min: 100, max: 599 })), {
          maxLength: 600,
        }),
        (statuses) => {
          const s = statusShares([batch(statuses.map((st, i) => page(i, st)))]);
          const values = Object.values(s);
          for (const v of values) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
            expect(Number(v.toFixed(2))).toBe(v);
          }
          const hundredths = values.reduce((a, v) => a + Math.round(v * 100), 0);
          const counted = statuses.filter((st) => st === null || st >= 200).length;
          expect(hundredths).toBe(counted === 0 ? 0 : 100);
        },
      ),
      { numRuns: 300 },
    );
  });
});

const REGISTRY = [
  { token: 'GPTBot', robots_token: 'GPTBot' },
  { token: 'ClaudeBot', robots_token: 'ClaudeBot' },
];

const crawler = (ua: string, verdict = 'allowed', cause: string | null = null) =>
  ({ ua, verdict, cause }) as unknown as Check['crawlers'][number];

const input = (check: Partial<DraftInput['check']> = {}): DraftInput => ({
  check: {
    crawlers: [crawler('GPTBot'), crawler('ClaudeBot', 'disallowed_by_robots')],
    stack: {
      frontend: {
        name: 'WordPress',
        framework: 'wordpress',
        version: null,
        router: null,
        detected_from: 'x',
      },
      backend: { cms: 'wordpress', detected_from: 'x' },
      edge: { vendor: 'Cloudflare', detected_from: 'x' },
    },
    signals: [
      { signal: 'schema_org', state: 'detected' },
      { signal: 'llms_txt', state: 'not_detected' },
      { signal: 'content_signals', state: 'indeterminate' },
    ] as unknown as Check['signals'],
    without_js: { site_text_share: 0.95 },
    ...check,
  },
  crawl: [batch([page(1, 200)])],
  robotsTxt: 'User-agent: ClaudeBot\nDisallow: /',
  registry: REGISTRY,
});

describe('ledgerDraft', () => {
  it('holds the ledger fields from the check and the crawl', () => {
    expect(ledgerDraft(input())).toEqual({
      cms: 'wordpress',
      frontend_framework: 'wordpress',
      edge_vendor: 'cloudflare',
      without_js_state: 'readable',
      share_2xx: 1,
      share_3xx: 0,
      share_4xx: 0,
      share_5xx: 0,
      share_unanswered: 0,
      signals_detected: ['schema_org'],
      signals_indeterminate: ['content_signals'],
      observations: [
        { crawler: 'GPTBot', verdict: 'allowed', cause: null, robots_rule: 'no_group' },
        {
          crawler: 'ClaudeBot',
          verdict: 'disallowed_by_robots',
          cause: null,
          robots_rule: 'named_disallow_all',
        },
      ],
    });
  });

  it('leaves out a crawler the registry does not hold, and records a repeated token once', () => {
    const d = ledgerDraft(
      input({
        crawlers: [crawler('GPTBot'), crawler('Unknown-Bot'), crawler('GPTBot', 'rate_limited')],
      }),
    );
    expect(d.observations.map((o) => [o.crawler, o.verdict])).toEqual([['GPTBot', 'allowed']]);
  });

  it('records no edge vendor that does not fit the short-name rule', () => {
    const d = ledgerDraft(
      input({
        stack: {
          frontend: null,
          backend: null,
          edge: { vendor: 'https://cdn.example', detected_from: 'x' },
        },
      }),
    );
    expect(d).toMatchObject({ cms: null, frontend_framework: null, edge_vendor: null });
  });

  it('is null for the without-JS state when the check measured none', () => {
    expect(ledgerDraft(input({ without_js: null })).without_js_state).toBeNull();
  });

  it('the schema refuses any field it does not list', () => {
    expect(() =>
      LedgerDraftSchema.parse({ ...ledgerDraft(input()), host: 'site.example' }),
    ).toThrow();
  });
});
