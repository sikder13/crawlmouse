import { describe, it, expect } from 'vitest';
import {
  analyticsMayStart,
  clearAnalyticsStorage,
  isConsentRequiredCountry,
  consentDecisionCookie,
  consentDecisionFromCookie,
  consentRequiredFromCookie,
  serverCaptureAllowed,
  shouldShowConsentBanner,
  CONSENT_REQUIRED_COOKIE,
  CONSENT_DECISION_STORAGE_KEY,
  CONSENT_OPEN_EVENT,
  surveysOffAtStart,
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

describe('the consent decision cookie', () => {
  it('is written for one year, for the whole site, SameSite=Lax, readable by script', () => {
    expect(consentDecisionCookie('granted')).toBe(
      'cm_consent=granted; Max-Age=31536000; Path=/; SameSite=Lax',
    );
    expect(consentDecisionCookie('denied')).toBe(
      'cm_consent=denied; Max-Age=31536000; Path=/; SameSite=Lax',
    );
  });

  it('is read back from a cookie string, by exact name and value', () => {
    expect(consentDecisionFromCookie('a=1; cm_consent=granted')).toBe('granted');
    expect(consentDecisionFromCookie('cm_consent=denied; b=2')).toBe('denied');
    expect(consentDecisionFromCookie('cm_consent=yes')).toBeNull();
    expect(consentDecisionFromCookie('cm_consent_required=1')).toBeNull();
    expect(consentDecisionFromCookie('xcm_consent=granted')).toBeNull();
    expect(consentDecisionFromCookie(null)).toBeNull();
  });
});

describe('serverCaptureAllowed', () => {
  // The four combinations of region and decision, and the two with no decision.
  it.each([
    ['cm_consent_required=1; cm_consent=granted', true],
    ['cm_consent_required=1; cm_consent=denied', false],
    ['cm_consent_required=0; cm_consent=granted', true],
    ['cm_consent_required=0; cm_consent=denied', false],
    ['cm_consent_required=1', false],
    ['cm_consent_required=0', true],
  ])('%s → %s', (cookie, allowed) => {
    expect(serverCaptureAllowed(cookie)).toBe(allowed);
  });

  it('allows a request with no cookie header, as the region default does', () => {
    expect(serverCaptureAllowed(null)).toBe(true);
    expect(serverCaptureAllowed('')).toBe(true);
  });
});

describe('surveysOffAtStart', () => {
  it.each([
    [false, null, false],
    [false, 'granted', false],
    [false, 'denied', true],
    [true, null, true],
    [true, 'granted', false],
    [true, 'denied', true],
  ] as const)('consent required %s, decision %s → off %s', (required, decision, off) => {
    expect(surveysOffAtStart(required, decision)).toBe(off);
  });
});

describe('analyticsMayStart (F-048)', () => {
  it.each([
    // cookies, stored decision, may start
    ['cm_consent_required=0', null, true],
    ['cm_consent_required=1', null, false],
    ['', null, false],
    [null, null, false],
    ['other=1', null, false],
    ['cm_consent_required=00', null, false],
    ['xcm_consent_required=0', null, false],
    ['cm_consent_required=1', 'granted', true],
    ['cm_consent_required=0', 'denied', false],
    ['', 'granted', true],
    ['', 'denied', false],
    ['cm_consent_required=1; cm_consent=granted', null, true],
    ['cm_consent_required=0; cm_consent=denied', null, false],
    // What the banner stored wins over a cookie that disagrees with it.
    ['cm_consent_required=0; cm_consent=granted', 'denied', false],
    ['cm_consent_required=1; cm_consent=denied', 'granted', true],
    // A stored value that is not a decision is no decision.
    ['cm_consent_required=1', 'maybe', false],
    ['cm_consent_required=0', 'maybe', true],
  ] as const)('%s with %s stored: %s', (cookies, stored, expected) => {
    expect(analyticsMayStart(cookies, stored)).toBe(expected);
  });
});

describe('clearAnalyticsStorage', () => {
  /** A `Storage` whose own enumerable keys are its entries, as a browser's is. */
  function store(entries: Record<string, string>): Storage {
    const m = { ...entries };
    Object.defineProperty(m, 'removeItem', {
      enumerable: false,
      value: (k: string) => delete m[k],
    });
    return m as unknown as Storage;
  }

  it('removes PostHog’s keys and cookies, on the host and its parent domain, and nothing else', () => {
    const written: string[] = [];
    const doc = {
      get cookie() {
        return 'ph_phc_x_posthog=1; cm_consent=denied; __ph_opt_in_out_phc_x=0; graph_x=1';
      },
      set cookie(v: string) {
        written.push(v);
      },
      location: { hostname: 'www.crawlmouse.com' },
    } as unknown as Document;
    const local = store({
      ph_phc_x_posthog: '{}',
      __ph_opt_in_out_phc_x: '0',
      cm_consent: 'denied',
    });
    clearAnalyticsStorage(doc, [local]);
    expect(written).toEqual([
      'ph_phc_x_posthog=; Max-Age=0; Path=/; SameSite=Lax',
      'ph_phc_x_posthog=; Max-Age=0; Path=/; Domain=.crawlmouse.com; SameSite=Lax',
      '__ph_opt_in_out_phc_x=; Max-Age=0; Path=/; SameSite=Lax',
      '__ph_opt_in_out_phc_x=; Max-Age=0; Path=/; Domain=.crawlmouse.com; SameSite=Lax',
    ]);
    expect(Object.keys(local)).toEqual(['cm_consent']);
  });

  it('a store that throws does not stop the others', () => {
    const bad = {
      get length(): number {
        throw new Error('denied');
      },
    } as unknown as Storage;
    const throwing = new Proxy(bad, {
      ownKeys() {
        throw new Error('denied');
      },
    });
    const good = store({ ph_phc_x_posthog: '{}' });
    const doc = { cookie: '', location: { hostname: 'crawlmouse.com' } } as unknown as Document;
    expect(() => clearAnalyticsStorage(doc, [throwing, good])).not.toThrow();
    expect(Object.keys(good)).toEqual([]);
  });
});
