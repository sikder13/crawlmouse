import { AccountSchema } from '@crawlmouse/types/v2';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  GATES,
  PAID_PAGES_PER_CHECK,
  PAST_DUE_GRACE_DAYS,
  contractLimits,
  effectiveTier,
  gatesFor,
  limitsFor,
  type EntitlementClock,
} from './entitlement-v2';

/**
 * Each gate is asserted once per tier against the value written in ARCH-2 §3.1 (or, for checks per
 * site per day, DECISION-LOG J9), typed here by hand. The test does not read GATES to decide what to
 * expect, so a changed value in GATES fails the matching line below.
 */
describe('GATES, one assertion per gate per tier (ARCH-2 §3.1)', () => {
  it('sites', () => {
    expect(GATES.free.sites).toBe(1);
    expect(GATES.pro.sites).toBe(5);
    expect(GATES.agency.sites).toBe(25);
  });

  it('sites ceiling with paid extras', () => {
    expect(GATES.free.maxSites).toBe(1);
    expect(GATES.pro.maxSites).toBe(5);
    expect(GATES.agency.maxSites).toBe(50);
  });

  it('seats', () => {
    expect(GATES.free.seats).toBe(1);
    expect(GATES.pro.seats).toBe(2);
    expect(GATES.agency.seats).toBe(5);
  });

  it('schedule', () => {
    expect(GATES.free.schedule).toBe('monthly_first_site_only');
    expect(GATES.pro.schedule).toBe('weekly');
    expect(GATES.agency.schedule).toBe('weekly');
  });

  it('fixes visible', () => {
    expect(GATES.free.fixesVisible).toBe(3);
    expect(GATES.pro.fixesVisible).toBe('all');
    expect(GATES.agency.fixesVisible).toBe('all');
  });

  it('packets', () => {
    expect(GATES.free.packets).toBe('visible_fixes_only');
    expect(GATES.pro.packets).toBe('all');
    expect(GATES.agency.packets).toBe('all');
  });

  it('competitors per site', () => {
    expect(GATES.free.competitorsPerSite).toBe(0);
    expect(GATES.pro.competitorsPerSite).toBe(1);
    expect(GATES.agency.competitorsPerSite).toBe(3);
  });

  it('exports (PDF, CSV, JSON)', () => {
    expect(GATES.free.exports).toBe(false);
    expect(GATES.pro.exports).toBe(true);
    expect(GATES.agency.exports).toBe(true);
  });

  it('Slack', () => {
    expect(GATES.free.slack).toBe(false);
    expect(GATES.pro.slack).toBe(true);
    expect(GATES.agency.slack).toBe(true);
  });

  it('staging and deploy hooks', () => {
    expect(GATES.free.stagingAndDeployHooks).toBe(false);
    expect(GATES.pro.stagingAndDeployHooks).toBe(true);
    expect(GATES.agency.stagingAndDeployHooks).toBe(true);
  });

  it('brand, sender domain, portal and scheduled client reports', () => {
    expect(GATES.free.agencyBranding).toBe(false);
    expect(GATES.pro.agencyBranding).toBe(false);
    expect(GATES.agency.agencyBranding).toBe(true);
  });

  it('pages per check', () => {
    expect(GATES.free.pagesPerCheck).toBe(500);
    expect(GATES.pro.pagesPerCheck).toBe(2000);
    expect(GATES.agency.pagesPerCheck).toBe(2000);
    expect(PAID_PAGES_PER_CHECK).toBe(2000);
  });

  it('full renders per month', () => {
    expect(GATES.free.fullRendersPerMonth).toBe(0);
    expect(GATES.pro.fullRendersPerMonth).toBe(10);
    expect(GATES.agency.fullRendersPerMonth).toBe(30);
  });

  it('read-only API', () => {
    expect(GATES.free.readOnlyApi).toBe(false);
    expect(GATES.pro.readOnlyApi).toBe(true);
    expect(GATES.agency.readOnlyApi).toBe(true);
  });

  it('Search Console overlay', () => {
    expect(GATES.free.searchConsole).toBe(false);
    expect(GATES.pro.searchConsole).toBe(true);
    expect(GATES.agency.searchConsole).toBe(true);
  });

  it('observed crawler activity', () => {
    expect(GATES.free.observedCrawlerActivity).toBe(false);
    expect(GATES.pro.observedCrawlerActivity).toBe(true);
    expect(GATES.agency.observedCrawlerActivity).toBe(true);
  });

  it('checks per site per day (DECISION-LOG J9)', () => {
    expect(GATES.free.checksPerSiteDay).toBe(3);
    expect(GATES.pro.checksPerSiteDay).toBe(12);
    expect(GATES.agency.checksPerSiteDay).toBe(12);
  });

  it('has no gate this file does not assert', () => {
    // A gate added to GATES without a line above would otherwise go untested.
    expect(Object.keys(GATES.free).sort()).toEqual(
      [
        'agencyBranding',
        'checksPerSiteDay',
        'competitorsPerSite',
        'exports',
        'fixesVisible',
        'fullRendersPerMonth',
        'maxSites',
        'observedCrawlerActivity',
        'packets',
        'pagesPerCheck',
        'readOnlyApi',
        'schedule',
        'searchConsole',
        'seats',
        'sites',
        'slack',
        'stagingAndDeployHooks',
      ].sort(),
    );
    expect(Object.keys(GATES).sort()).toEqual(['agency', 'free', 'pro']);
  });
});

describe('limitsFor: the plan limits plus Agency extras', () => {
  it('adds $12 seats and $3 sites to Agency only, capped at 50 sites', () => {
    expect(limitsFor('agency', { seats: 0, sites: 0 })).toEqual({
      seats: 5,
      sites: 25,
      competitorsPerSite: 3,
    });
    expect(limitsFor('agency', { seats: 4, sites: 25 })).toEqual({
      seats: 9,
      sites: 50,
      competitorsPerSite: 3,
    });
    expect(limitsFor('pro', { seats: 0, sites: 0 })).toEqual({
      seats: 2,
      sites: 5,
      competitorsPerSite: 1,
    });
    expect(limitsFor('free', { seats: 0, sites: 0 })).toEqual({
      seats: 1,
      sites: 1,
      competitorsPerSite: 0,
    });
  });

  it('refuses extras the plan does not sell', () => {
    expect(() => limitsFor('pro', { seats: 1, sites: 0 })).toThrow(RangeError);
    expect(() => limitsFor('free', { seats: 0, sites: 1 })).toThrow(RangeError);
    expect(() => limitsFor('agency', { seats: 0, sites: 26 })).toThrow(RangeError);
    expect(() => limitsFor('agency', { seats: -1, sites: 0 })).toThrow(RangeError);
    expect(() => limitsFor('agency', { seats: 1.5, sites: 0 })).toThrow(RangeError);
  });

  it('produces limits the contract accepts, for every tier', () => {
    const schema = AccountSchema.shape.limits;
    for (const tier of ['free', 'pro', 'agency'] as const) {
      expect(schema.safeParse(contractLimits(tier, { seats: 0, sites: 0 })).success, tier).toBe(
        true,
      );
    }
    expect(contractLimits('pro', { seats: 0, sites: 0 })).toEqual({
      sites: 5,
      seats: 2,
      pages_per_audit: 2000,
      competitors_per_site: 1,
      full_renders_per_month: 10,
    });
  });
});

const NO_TRIAL = { trialVariant: null, trialEndsAt: null } as const;

describe('effectiveTier: the past_due grace clock', () => {
  const since = new Date('2026-11-01T12:00:00.000Z');
  const pastDue = (tier: 'pro' | 'agency'): EntitlementClock => ({
    state: 'past_due',
    tier,
    pastDueTier: tier,
    pastDueSince: since,
    ...NO_TRIAL,
  });
  const at = (ms: number) => new Date(since.getTime() + ms);
  const DAY = 86_400_000;

  it('keeps the paid tier until 7 days have passed, then is free', () => {
    expect(PAST_DUE_GRACE_DAYS).toBe(7);
    expect(effectiveTier(pastDue('agency'), at(0))).toBe('agency');
    expect(effectiveTier(pastDue('agency'), at(7 * DAY - 1))).toBe('agency');
    expect(effectiveTier(pastDue('agency'), at(7 * DAY))).toBe('free');
    expect(effectiveTier(pastDue('pro'), at(30 * DAY))).toBe('free');
  });

  it('holds for any moment and either paid tier (property)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('pro' as const, 'agency' as const),
        fc.integer({ min: 0, max: 60 * DAY }),
        (tier, ms) => {
          const expected = ms < 7 * DAY ? tier : 'free';
          expect(effectiveTier(pastDue(tier), at(ms))).toBe(expected);
          expect(gatesFor(pastDue(tier), at(ms))).toBe(GATES[expected]);
        },
      ),
    );
  });

  it('reads the tier column for every other state', () => {
    const now = at(365 * DAY);
    expect(
      effectiveTier(
        { state: 'pro', tier: 'pro', pastDueTier: null, pastDueSince: null, ...NO_TRIAL },
        now,
      ),
    ).toBe('pro');
    expect(
      effectiveTier(
        {
          state: 'agency_trial',
          tier: 'agency',
          pastDueTier: null,
          pastDueSince: null,
          ...NO_TRIAL,
        },
        now,
      ),
    ).toBe('agency');
    expect(
      effectiveTier(
        { state: 'free', tier: 'free', pastDueTier: null, pastDueSince: null, ...NO_TRIAL },
        now,
      ),
    ).toBe('free');
  });

  it('throws on a past_due account with no clock, rather than guessing', () => {
    expect(() =>
      effectiveTier(
        { state: 'past_due', tier: 'pro', pastDueTier: 'pro', pastDueSince: null, ...NO_TRIAL },
        since,
      ),
    ).toThrow();
  });
});

describe('effectiveTier: the no-card trial ends on its own clock', () => {
  const ends = new Date('2026-11-15T00:00:00.000Z');
  const trial = (variant: 'no_card' | 'card_required'): EntitlementClock => ({
    state: 'pro_trial',
    tier: 'pro',
    pastDueTier: null,
    pastDueSince: null,
    trialVariant: variant,
    trialEndsAt: ends,
  });
  const at = (ms: number) => new Date(ends.getTime() + ms);

  it('is Pro until trial_ends_at and Free from then, without the expiry event', () => {
    expect(effectiveTier(trial('no_card'), at(-1))).toBe('pro');
    expect(effectiveTier(trial('no_card'), at(0))).toBe('free');
    expect(gatesFor(trial('no_card'), at(365 * 86_400_000))).toBe(GATES.free);
  });

  it('leaves a trial on Stripe’s clock to Stripe’s event', () => {
    expect(effectiveTier(trial('card_required'), at(1))).toBe('pro');
  });

  it('throws on a no-card trial with no end, rather than guessing', () => {
    expect(() => effectiveTier({ ...trial('no_card'), trialEndsAt: null }, at(0))).toThrow();
  });
});
