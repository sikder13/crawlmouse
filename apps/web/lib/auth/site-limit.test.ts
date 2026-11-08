import { describe, expect, it } from 'vitest';
import { GATES, PAST_DUE_GRACE_DAYS } from '../entitlement-v2';
import { siteLimitAt } from './site-limit';

const NOW = new Date('2026-11-05T12:00:00Z');
const DAY = 86_400_000;
const base = {
  state: 'free' as const,
  tier: 'free' as const,
  pastDueTier: null,
  pastDueSince: null,
  trialVariant: null,
  trialEndsAt: null,
  siteLimit: 1,
};

describe('siteLimitAt', () => {
  it('is the stored limit while the tier now allows it', () => {
    expect(siteLimitAt({ ...base, state: 'pro', tier: 'pro', siteLimit: 5 }, NOW)).toBe(5);
  });

  it('a no-card trial past its end counts as Free', () => {
    const lapsed = {
      ...base,
      state: 'pro_trial' as const,
      tier: 'pro' as const,
      trialVariant: 'no_card' as const,
      trialEndsAt: new Date(NOW.getTime() - DAY),
      siteLimit: 5,
    };
    expect(siteLimitAt(lapsed, NOW)).toBe(GATES.free.maxSites);
  });

  it('past_due keeps its tier through the grace period, and is Free after it', () => {
    const pastDue = (daysAgo: number) => ({
      ...base,
      state: 'past_due' as const,
      tier: 'agency' as const,
      pastDueTier: 'agency' as const,
      pastDueSince: new Date(NOW.getTime() - daysAgo * DAY),
      siteLimit: 25,
    });
    expect(siteLimitAt(pastDue(PAST_DUE_GRACE_DAYS - 1), NOW)).toBe(25);
    expect(siteLimitAt(pastDue(PAST_DUE_GRACE_DAYS + 1), NOW)).toBe(GATES.free.maxSites);
  });
});
