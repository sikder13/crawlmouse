// Consent gating for non-essential analytics (PostHog). In regions where ePrivacy/PECR require
// prior opt-in for non-essential cookies, we hold PostHog capture + error-replay until the visitor
// agrees; elsewhere analytics load by default with an opt-out. Shared by the middleware (sets the
// region cookie from geo), instrumentation-client (opts out by default for those regions), and the
// CookieConsent banner (lets the visitor opt in/out).

/** Non-httpOnly cookie set by middleware: '1' when the visitor's region requires prior consent. */
export const CONSENT_REQUIRED_COOKIE = 'cm_consent_required';

/** localStorage key holding the visitor's decision: 'granted' | 'denied'. */
export const CONSENT_DECISION_STORAGE_KEY = 'cm_consent';

/**
 * First-party cookie holding the same decision, so the server can read it: the banner writes it
 * beside localStorage. Readable by script, like the region cookie.
 */
export const CONSENT_DECISION_COOKIE = 'cm_consent';

export type ConsentDecision = 'granted' | 'denied';

const ONE_YEAR_S = 365 * 24 * 60 * 60;

/** The `document.cookie` assignment that records `decision` for one year. */
export function consentDecisionCookie(decision: ConsentDecision): string {
  return `${CONSENT_DECISION_COOKIE}=${decision}; Max-Age=${ONE_YEAR_S}; Path=/; SameSite=Lax`;
}

/**
 * Window event that re-opens the consent banner so a visitor can change or withdraw a prior
 * decision (GDPR Art. 7(3): withdrawal as easy as giving). Dispatched by the footer "Cookie
 * settings" control; listened for by the CookieConsent banner.
 */
export const CONSENT_OPEN_EVENT = 'cm:open-consent';

// EU-27 + EEA (Iceland, Liechtenstein, Norway) + United Kingdom. ISO 3166-1 alpha-2 codes, matching
// what Vercel's `x-vercel-ip-country` header returns. (Greece is GR in ISO, not the EU's "EL".)
const CONSENT_REQUIRED_COUNTRIES: ReadonlySet<string> = new Set([
  // EU-27
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
  // EEA (non-EU)
  'IS',
  'LI',
  'NO',
  // United Kingdom
  'GB',
]);

/**
 * Whether a visitor's country requires prior opt-in consent for non-essential analytics.
 * Missing/unknown country resolves to `false` (US-first default; Vercel reliably provides the
 * country header in production).
 */
export function isConsentRequiredCountry(country?: string | null): boolean {
  if (!country) return false;
  return CONSENT_REQUIRED_COUNTRIES.has(country.trim().toUpperCase());
}

/** Parse the middleware-set consent-required flag from a `document.cookie` string (exact match). */
export function consentRequiredFromCookie(cookieString?: string | null): boolean {
  if (!cookieString) return false;
  return cookieString.split(';').some((c) => c.trim() === `${CONSENT_REQUIRED_COOKIE}=1`);
}

/**
 * Whether to show the consent banner: the visitor's region requires prior consent AND no decision
 * (granted or denied) has been recorded yet.
 */
export function shouldShowConsentBanner(
  cookieString?: string | null,
  decision?: string | null,
): boolean {
  return consentRequiredFromCookie(cookieString) && decision !== 'granted' && decision !== 'denied';
}

/** The decision the `cm_consent` cookie holds in a `Cookie` header or `document.cookie` string. */
export function consentDecisionFromCookie(cookieString?: string | null): ConsentDecision | null {
  if (!cookieString) return null;
  for (const part of cookieString.split(';')) {
    const pair = part.trim();
    if (pair === `${CONSENT_DECISION_COOKIE}=granted`) return 'granted';
    if (pair === `${CONSENT_DECISION_COOKIE}=denied`) return 'denied';
  }
  return null;
}

/**
 * Whether the server may send a product event for the request with this `Cookie` header: yes when
 * the visitor granted consent; no when they denied it; with no decision, yes unless their region
 * needs prior consent.
 */
export function serverCaptureAllowed(cookieHeader?: string | null): boolean {
  const decision = consentDecisionFromCookie(cookieHeader);
  if (decision !== null) return decision === 'granted';
  return !consentRequiredFromCookie(cookieHeader);
}
