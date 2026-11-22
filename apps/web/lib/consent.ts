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

/**
 * Window event the CookieConsent banner dispatches once a visitor has granted consent and capture is
 * opted in: instrumentation-client.ts writes the first-touch cookie then, and IdentifyPerson
 * identifies a signed-in browser.
 */
export const CONSENT_GRANTED_EVENT = 'cm:consent-granted';

/**
 * Window event the CookieConsent banner dispatches once a visitor has declined and capture is opted
 * out: the account shell's Feedback button leaves the page then.
 */
export const CONSENT_DENIED_EVENT = 'cm:consent-denied';

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
  // EU territory with a country code of its own: Åland, and the outermost regions of France.
  'AX',
  'GF',
  'GP',
  'MF',
  'MQ',
  'RE',
  'YT',
]);

/** What a geo lookup answers when it has no country: `XX` (unknown) and `T1` (Tor). */
const UNKNOWN_COUNTRIES: ReadonlySet<string> = new Set(['XX', 'T1']);

/**
 * Whether a visitor's country requires prior opt-in consent for non-essential analytics. On a Vercel
 * deployment a visitor whose country is not known is asked, since they may be in the EU (question
 * 009). Off Vercel (local, CI) there is no geo header at all, so a missing country is "not required".
 */
export function isConsentRequiredCountry(
  country?: string | null,
  onVercel: boolean = process.env.VERCEL_ENV !== undefined,
): boolean {
  const code = country?.trim().toUpperCase();
  if (!code || UNKNOWN_COUNTRIES.has(code)) return onVercel;
  return CONSENT_REQUIRED_COUNTRIES.has(code);
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

/** What the banner stored in this browser, or null where storage is blocked. */
export function storedConsent(): string | null {
  try {
    return window.localStorage.getItem(CONSENT_DECISION_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Where the browser's PostHog sends (F-049): the same-origin proxy, whatever
 * `NEXT_PUBLIC_POSTHOG_HOST` says, except a loopback address: the launch walk's capture stub
 * (tests/e2e/run.sh), which no deployment can reach.
 */
export function posthogApiHost(envHost?: string | null): string {
  try {
    const { hostname, protocol } = new URL(envHost ?? '');
    if (protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1')) {
      return envHost!;
    }
  } catch {
    /* not an absolute URL: the proxy */
  }
  return '/ingest';
}

/** The visitor's recorded decision: what the banner stored, else the cookie it writes beside it. */
export function recordedDecision(
  cookieString?: string | null,
  stored?: string | null,
): ConsentDecision | null {
  if (stored === 'granted' || stored === 'denied') return stored;
  return consentDecisionFromCookie(cookieString);
}

/**
 * Whether PostHog may start in this browser now (F-048). A recorded decision decides. With none, it
 * may only when the middleware's region cookie says consent is not required (`0`): no cookie is
 * treated as "required", so a page the middleware did not stamp holds rather than tracks.
 */
export function analyticsMayStart(cookieString?: string | null, stored?: string | null): boolean {
  const decision = recordedDecision(cookieString, stored);
  if (decision !== null) return decision === 'granted';
  return (cookieString ?? '').split(';').some((c) => c.trim() === `${CONSENT_REQUIRED_COOKIE}=0`);
}

/**
 * A cookie or storage key that analytics wrote: PostHog's own (`ph_<key>_posthog`,
 * `__ph_opt_in_out_<key>`), its survey state (the prefixes in posthog-js's `survey-utils`), and the
 * first-touch cookie, which is set under the same consent.
 */
const ANALYTICS_NAME =
  /^(?:(?:__)?ph_|seenSurvey_|inProgressSurvey_|abandonedSurvey_|lastSeenSurveyDate$|cm_ft$)/;

/** The host and each parent domain a cookie could have been set on, down to two labels. */
function cookieDomains(hostname: string): string[] {
  const domains: string[] = [];
  for (let host = hostname; host.includes('.'); host = host.replace(/^[^.]*\./, '')) {
    domains.push(`.${host}`);
  }
  return domains;
}

/**
 * Removes the cookies and storage keys `ANALYTICS_NAME` matches, and no others. Run when analytics
 * may not start, and on a decline. Each store is passed as a getter, because reading
 * `window.localStorage` itself throws where storage is blocked; such a store is skipped.
 */
export function clearAnalyticsStorage(doc: Document, stores: readonly (() => Storage)[]): void {
  for (const pair of doc.cookie.split(';')) {
    const name = pair.split('=')[0]!.trim();
    if (!ANALYTICS_NAME.test(name)) continue;
    doc.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
    for (const domain of cookieDomains(doc.location?.hostname ?? '')) {
      doc.cookie = `${name}=; Max-Age=0; Path=/; Domain=${domain}; SameSite=Lax`;
    }
  }
  for (const read of stores) {
    try {
      const store = read();
      for (const key of Object.keys(store)) if (ANALYTICS_NAME.test(key)) store.removeItem(key);
    } catch {
      /* a store this browser refuses holds nothing we wrote */
    }
  }
}

/**
 * Whether PostHog starts with surveys off (CC-41 D8): when capture starts opted out (a region that
 * needs prior consent, with no grant), and whenever the visitor's recorded decision is a decline,
 * in any region. posthog-js skips surveys for an opted-out visitor only in its cookieless mode, so
 * this is what keeps a declined visitor's later pages free of surveys.
 */
export function surveysOffAtStart(consentRequired: boolean, decision: string | null): boolean {
  return (consentRequired && decision !== 'granted') || decision === 'denied';
}
