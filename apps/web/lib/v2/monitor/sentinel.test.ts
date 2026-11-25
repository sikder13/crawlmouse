/**
 * Row 23, the daily sentinel's pure half: which hour a site is watched, which pages are looked at,
 * and what counts as a move worth a second look. The function's steps are tested in
 * inngest/sentinel.test.ts.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Verdict } from '@crawlmouse/types/v2';
import {
  SENTINEL_MAX_TEMPLATES,
  movements,
  pickPages,
  sentinelHour,
  verdictClass,
  type Look,
} from './sentinel';

const look = (over: Partial<Look> = {}): Look => ({
  identity_role: 'crawler',
  ua: 'GPTBot',
  template_key: '/products/{slug}',
  verdict: 'allowed',
  word_count: 400,
  ...over,
});

describe('sentinelHour', () => {
  it('gives each site one hour of the day, the same every day', () => {
    fc.assert(
      fc.property(fc.uuid(), (id) => {
        const h = sentinelHour(id);
        expect(Number.isInteger(h) && h >= 0 && h < 24).toBe(true);
        expect(sentinelHour(id)).toBe(h);
      }),
    );
  });

  it('spreads sites over every hour', () => {
    const ids = Array.from(
      { length: 2400 },
      (_, i) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`,
    );
    const hours = new Set(ids.map(sentinelHour));
    expect(hours.size).toBe(24);
  });
});

describe('pickPages', () => {
  const t = (template_key: string, page_url: string, ua: string | null = 'GPTBot') => ({
    template_key,
    page_url,
    ua,
  });

  it('takes one page per template: the one the full check tested first by address', () => {
    expect(
      pickPages([
        t('/products/{slug}', 'https://s.test/products/b'),
        t('/', 'https://s.test/'),
        t('/products/{slug}', 'https://s.test/products/a'),
        t('/products/{slug}', 'https://s.test/products/a', null),
      ]),
    ).toEqual([
      { template_key: '/', url: 'https://s.test/' },
      { template_key: '/products/{slug}', url: 'https://s.test/products/a' },
    ]);
  });

  it(`looks at ${SENTINEL_MAX_TEMPLATES} templates at most, the home template among them`, () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      t(`/t${String(i).padStart(2, '0')}/{slug}`, `https://s.test/t${i}/x`),
    );
    const picked = pickPages([...many, t('/', 'https://s.test/')]);
    expect(picked).toHaveLength(SENTINEL_MAX_TEMPLATES);
    expect(picked[0]).toEqual({ template_key: '/', url: 'https://s.test/' });
  });

  it('picks nothing from a check that tested nothing', () => {
    expect(pickPages([])).toEqual([]);
  });
});

describe('verdictClass', () => {
  it.each<[Verdict, string]>([
    ['allowed', 'allowed'],
    ['allowed_thin', 'allowed'],
    ['disallowed_by_robots', 'blocked'],
    ['blocked_by_ua_rule', 'blocked'],
    ['challenged_ua', 'challenged'],
    ['refused_unverified', 'challenged'],
    ['rate_limited', 'refused'],
    ['payment_required', 'refused'],
    ['edge_blocks_automation', 'refused'],
    ['redirected_away', 'refused'],
    ['not_measured', 'unknown'],
  ])('%s is %s', (v, c) => expect(verdictClass(v)).toBe(c));
});

describe('movements', () => {
  it('names a crawler whose verdict changed class on a template', () => {
    expect(movements([look()], [look({ verdict: 'disallowed_by_robots' })])).toEqual([
      {
        identity_role: 'crawler',
        ua: 'GPTBot',
        template_key: '/products/{slug}',
        from: 'allowed',
        to: 'disallowed_by_robots',
      },
    ]);
  });

  it('ignores a change inside a class', () => {
    expect(movements([look()], [look({ verdict: 'allowed_thin' })])).toEqual([]);
  });

  it('ignores a side that was not measured: there is nothing to compare', () => {
    expect(
      movements([look({ verdict: 'not_measured' })], [look({ verdict: 'disallowed_by_robots' })]),
    ).toEqual([]);
    expect(movements([look()], [look({ verdict: 'not_measured' })])).toEqual([]);
  });

  it('names a template whose text fell under a fifth of what the full check read', () => {
    expect(movements([look({ word_count: 400 })], [look({ word_count: 79 })])).toEqual([
      {
        identity_role: 'crawler',
        ua: 'GPTBot',
        template_key: '/products/{slug}',
        from_words: 400,
        to_words: 79,
      },
    ]);
    expect(movements([look({ word_count: 400 })], [look({ word_count: 80 })])).toEqual([]);
  });

  it('compares a crawler only with itself, on the same template', () => {
    expect(
      movements(
        [look({ ua: 'GPTBot' }), look({ ua: 'ClaudeBot', verdict: 'disallowed_by_robots' })],
        [look({ ua: 'ClaudeBot', verdict: 'disallowed_by_robots' }), look({ ua: 'GPTBot' })],
      ),
    ).toEqual([]);
  });

  it('tells the control from the canary, though neither has a user agent', () => {
    // A review's vector: the control was allowed and the canary challenged; the control is now
    // challenged too, which a key on the user agent alone merges with the canary and misses.
    const control = look({
      identity_role: 'control',
      ua: null,
      verdict: 'allowed',
      word_count: 500,
    });
    const canary = look({
      identity_role: 'canary',
      ua: null,
      verdict: 'challenged_ua',
      word_count: 0,
    });
    const moved = movements(
      [control, canary, look({ verdict: 'blocked_by_ua_rule' })],
      [{ ...control, verdict: 'challenged_ua' }, look({ verdict: 'not_measured' })],
    );
    expect(moved).toEqual([
      {
        identity_role: 'control',
        ua: null,
        template_key: '/products/{slug}',
        from: 'allowed',
        to: 'challenged_ua',
      },
    ]);
    expect(movements([control, canary], [{ ...control, word_count: 3 }])).toHaveLength(1);
  });

  it('names nothing for a crawler or template the full check did not test', () => {
    expect(movements([], [look({ verdict: 'disallowed_by_robots' })])).toEqual([]);
  });

  it('finds no move when the look equals the baseline, whatever the looks are', () => {
    const verdicts: Verdict[] = [
      'allowed',
      'disallowed_by_robots',
      'challenged_ua',
      'rate_limited',
    ];
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            identity_role: fc.constantFrom(
              'crawler' as const,
              'control' as const,
              'canary' as const,
            ),
            ua: fc.constantFrom('GPTBot', 'ClaudeBot', null),
            template_key: fc.constantFrom('/', '/a/{slug}'),
            verdict: fc.constantFrom(...verdicts),
            word_count: fc.option(fc.nat(5000), { nil: null }),
          }),
        ),
        (looks) => {
          expect(movements(looks, looks)).toEqual([]);
        },
      ),
    );
  });
});
