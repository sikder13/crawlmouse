import { describe, it, expect } from 'vitest';
import { planCardModel } from './plan-card';

describe('planCardModel', () => {
  const now = new Date('2026-06-01T00:00:00.000Z');

  it('Pro: a future proUntil → pro variant linking to /billing, with the date to render', () => {
    expect(planCardModel({ proUntil: '2026-07-01T00:00:00.000Z' }, now)).toEqual({
      variant: 'pro',
      statusLabel: 'Pro',
      ctaLabel: 'Manage subscription',
      ctaHref: '/billing',
      proUntilIso: '2026-07-01T00:00:00.000Z',
    });
  });

  it('Free: an expired proUntil → free variant linking to /pricing, no date (relies on isProActive)', () => {
    expect(planCardModel({ proUntil: '2026-05-01T00:00:00.000Z' }, now)).toEqual({
      variant: 'free',
      statusLabel: 'Free plan',
      ctaLabel: 'Upgrade',
      ctaHref: '/pricing',
      proUntilIso: null,
    });
  });

  it('Free: null and undefined proUntil → free', () => {
    expect(planCardModel({ proUntil: null }, now).variant).toBe('free');
    expect(planCardModel({ proUntil: undefined }, now).variant).toBe('free');
  });

  it('Free: a malformed date string → free, no throw', () => {
    expect(() => planCardModel({ proUntil: 'not-a-date' }, now)).not.toThrow();
    expect(planCardModel({ proUntil: 'not-a-date' }, now).variant).toBe('free');
  });

  it('Free: the exact-now boundary is not active (strict >)', () => {
    expect(planCardModel({ proUntil: now.toISOString() }, now).variant).toBe('free');
  });
});
