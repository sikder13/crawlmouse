import { describe, it, expect } from 'vitest';
import { deriveTier, entitlementFor } from './entitlement';

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

describe('deriveTier (server-side; never trust a client-asserted tier)', () => {
  it('null / undefined user → free', () => {
    expect(deriveTier(null)).toBe('free');
    expect(deriveTier(undefined)).toBe('free');
  });
  it('active pro_until → pro', () => {
    expect(deriveTier({ pro_until: FUTURE })).toBe('pro');
  });
  it('expired / missing pro_until → free', () => {
    expect(deriveTier({ pro_until: PAST })).toBe('free');
    expect(deriveTier({ pro_until: null })).toBe('free');
    expect(deriveTier({})).toBe('free');
  });
  it('tier=agency → agency (the seam), overriding even an expired pro_until', () => {
    expect(deriveTier({ tier: 'agency', pro_until: PAST })).toBe('agency');
  });
  it('ignores an unknown tier string and falls back to pro_until', () => {
    expect(deriveTier({ tier: 'gold', pro_until: FUTURE })).toBe('pro');
    expect(deriveTier({ tier: 'gold', pro_until: PAST })).toBe('free');
  });
});

describe('entitlementFor (capability gates derived from tier)', () => {
  it('free → every capability gate is false', () => {
    expect(entitlementFor('free', null)).toEqual({
      tier: 'free',
      proUntil: null,
      canSeeAllPrescriptions: false,
      canUseActionPackets: false,
      canMonitor: false,
      canSeeFullSiteGrade: false,
      canWhiteLabel: false,
    });
  });
  it('pro → cure / packets / monitor / full-grade true; white-label false', () => {
    const e = entitlementFor('pro', FUTURE);
    expect(e.tier).toBe('pro');
    expect(e.proUntil).toBe(FUTURE);
    expect(e.canSeeAllPrescriptions).toBe(true);
    expect(e.canUseActionPackets).toBe(true);
    expect(e.canMonitor).toBe(true);
    expect(e.canSeeFullSiteGrade).toBe(true);
    expect(e.canWhiteLabel).toBe(false);
  });
  it('agency → all gates true, including white-label', () => {
    const e = entitlementFor('agency', null);
    expect(e.canSeeAllPrescriptions).toBe(true);
    expect(e.canMonitor).toBe(true);
    expect(e.canWhiteLabel).toBe(true);
  });
});
