/**
 * Goal 1 row 16 (F-157): a check's page cap follows its account's plan. A paid tier reads the plan's
 * pages per check, 2,000, while `pages_2000` is shown; Free, a site no account keeps (a visitor's
 * audit, a competitor) and any check while the switch hides it read the default, 500.
 */
import { describe, expect, it, vi } from 'vitest';
import type { EntitlementClock } from '../../entitlement-v2';

vi.mock('server-only', () => ({}));
const { GATES, PAID_PAGES_PER_CHECK, FREE_PAGES_PER_CHECK } = await import('../../entitlement-v2');
const { DEFAULT_PAGE_CAP } = await import('./limits');
const { pageCapFor } = await import('./page-cap');

const NOW = new Date('2026-11-24T20:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const clock = (over: Partial<EntitlementClock>): EntitlementClock => ({
  state: 'free',
  tier: 'free',
  pastDueTier: null,
  pastDueSince: null,
  trialVariant: null,
  trialEndsAt: null,
  ...over,
});
const SHOWN = {};
const HIDDEN = { V2_HIDE_FEATURES: 'pages_2000' };

describe('pageCapFor', () => {
  it('reads the figures it promises: 2,000 for a paid plan, 500 otherwise', () => {
    expect([PAID_PAGES_PER_CHECK, FREE_PAGES_PER_CHECK, DEFAULT_PAGE_CAP]).toEqual([
      2000, 500, 500,
    ]);
    expect([GATES.pro.pagesPerCheck, GATES.agency.pagesPerCheck]).toEqual([2000, 2000]);
  });

  it.each<[string, EntitlementClock, number]>([
    ['Free', clock({}), 500],
    ['Pro', clock({ state: 'pro', tier: 'pro' }), 2000],
    ['Agency', clock({ state: 'agency', tier: 'agency' }), 2000],
    [
      'a no-card Pro trial',
      clock({
        state: 'pro_trial',
        tier: 'pro',
        trialVariant: 'no_card',
        trialEndsAt: new Date(NOW.getTime() + 3 * DAY),
      }),
      2000,
    ],
    [
      'a no-card Pro trial that has ended',
      clock({
        state: 'pro_trial',
        tier: 'pro',
        trialVariant: 'no_card',
        trialEndsAt: new Date(NOW.getTime() - DAY),
      }),
      500,
    ],
    [
      'past due within its grace',
      clock({
        state: 'past_due',
        tier: 'free',
        pastDueTier: 'pro',
        pastDueSince: new Date(NOW.getTime() - 2 * DAY),
      }),
      2000,
    ],
    [
      'past due beyond its grace',
      clock({
        state: 'past_due',
        tier: 'free',
        pastDueTier: 'pro',
        pastDueSince: new Date(NOW.getTime() - 30 * DAY),
      }),
      500,
    ],
  ])('gives %s its plan’s page cap', (_, account, pages) => {
    expect(pageCapFor(account, NOW, SHOWN)).toBe(pages);
  });

  it('gives a site no account keeps the default', () => {
    expect(pageCapFor(null, NOW, SHOWN)).toBe(500);
  });

  it('gives every plan the default while the switch hides 2,000 pages', () => {
    expect(pageCapFor(clock({ state: 'pro', tier: 'pro' }), NOW, HIDDEN)).toBe(500);
    expect(pageCapFor(clock({ state: 'agency', tier: 'agency' }), NOW, HIDDEN)).toBe(500);
  });
});
