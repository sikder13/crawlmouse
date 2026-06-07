import { describe, it, expect } from 'vitest';
import {
  isConsentRequiredCountry,
  consentRequiredFromCookie,
  shouldShowConsentBanner,
  CONSENT_REQUIRED_COOKIE,
  CONSENT_DECISION_STORAGE_KEY,
  CONSENT_OPEN_EVENT,
} from './consent';

describe('isConsentRequiredCountry', () => {
  it('requires consent for EU member states', () => {
    for (const c of ['DE', 'FR', 'IE', 'ES', 'PL', 'SE', 'GR', 'IT']) {
      expect(isConsentRequiredCountry(c), c).toBe(true);
    }
  });

  it('requires consent for the UK and the EEA (Iceland/Liechtenstein/Norway)', () => {
    for (const c of ['GB', 'IS', 'LI', 'NO']) {
      expect(isConsentRequiredCountry(c), c).toBe(true);
    }
  });

  it('does not require consent for the US and other non-EEA countries', () => {
    for (const c of ['US', 'CA', 'AU', 'IN', 'BR', 'JP']) {
      expect(isConsentRequiredCountry(c), c).toBe(false);
    }
  });

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(isConsentRequiredCountry(' de ')).toBe(true);
    expect(isConsentRequiredCountry('gb')).toBe(true);
  });

  it('treats missing/empty country as NOT required (US-first default)', () => {
    expect(isConsentRequiredCountry(null)).toBe(false);
    expect(isConsentRequiredCountry(undefined)).toBe(false);
    expect(isConsentRequiredCountry('')).toBe(false);
  });

  it('exposes stable cookie + storage key names used across middleware/instrumentation/UI', () => {
    expect(CONSENT_REQUIRED_COOKIE).toBe('cm_consent_required');
    expect(CONSENT_DECISION_STORAGE_KEY).toBe('cm_consent');
    expect(CONSENT_OPEN_EVENT).toBe('cm:open-consent');
  });
});

describe('consentRequiredFromCookie', () => {
  it('is true only when the flag cookie is exactly =1', () => {
    expect(consentRequiredFromCookie('cm_consent_required=1')).toBe(true);
    expect(consentRequiredFromCookie('foo=bar; cm_consent_required=1; baz=2')).toBe(true);
  });

  it('is false when the flag is 0, absent, or empty', () => {
    expect(consentRequiredFromCookie('cm_consent_required=0')).toBe(false);
    expect(consentRequiredFromCookie('foo=bar')).toBe(false);
    expect(consentRequiredFromCookie('')).toBe(false);
    expect(consentRequiredFromCookie(null)).toBe(false);
    expect(consentRequiredFromCookie(undefined)).toBe(false);
  });

  it('does not match a different cookie that merely contains the name as a substring', () => {
    // exact per-segment match — a cookie like "xcm_consent_required=1" must NOT trip it
    expect(consentRequiredFromCookie('xcm_consent_required=1')).toBe(false);
    expect(consentRequiredFromCookie('cm_consent=granted')).toBe(false);
  });
});

describe('shouldShowConsentBanner', () => {
  it('shows only when the region requires consent AND no decision is recorded', () => {
    expect(shouldShowConsentBanner('cm_consent_required=1', null)).toBe(true);
    expect(shouldShowConsentBanner('cm_consent_required=1', undefined)).toBe(true);
  });

  it('does not show once a decision (granted or denied) exists', () => {
    expect(shouldShowConsentBanner('cm_consent_required=1', 'granted')).toBe(false);
    expect(shouldShowConsentBanner('cm_consent_required=1', 'denied')).toBe(false);
  });

  it('does not show in a non-consent region regardless of decision', () => {
    expect(shouldShowConsentBanner('cm_consent_required=0', null)).toBe(false);
    expect(shouldShowConsentBanner('', null)).toBe(false);
  });
});
