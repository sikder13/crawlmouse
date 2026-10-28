import type { FetchOutcome } from '../fetch/fetcher.js';
import { siteKeyOf } from '../politeness/site-key.js';

/**
 * What one response was, read headers first.
 *
 * A challenge is recognised from a mitigation header or from a redirect to a known challenge
 * endpoint. The body is read only as a tiebreak, and only on a 403 or 503 the headers did not
 * explain, so a 200 page that mentions a challenge is still a page that was served.
 */

export type ResponseClass =
  | 'served'
  | 'refused'
  | 'gone'
  | 'challenged'
  | 'rate_limited'
  | 'payment'
  | 'redirected_away'
  | 'error';

export type ChallengeEvidence = 'mitigation_header' | 'challenge_redirect' | 'body_signature';

export interface ResponseReading {
  class: ResponseClass;
  /** How a challenge was recognised; null unless class is `challenged`. */
  challenge: ChallengeEvidence | null;
  /** The body carries Cloudflare's firewall-rule error code 1020. */
  cloudflare1020: boolean;
}

/** Header name and the value fragment that marks a challenge, lower case. */
export const MITIGATION_HEADERS: ReadonlyArray<readonly [header: string, contains: string]> = [
  ['cf-mitigated', 'challenge'],
  ['x-vercel-mitigated', 'challenge'],
];

/** URL fragments of challenge interstitials a redirect can land on. */
export const CHALLENGE_URL_MARKERS: readonly string[] = [
  '/cdn-cgi/challenge-platform/',
  'captcha-delivery.com/',
  '/_incapsula_resource',
  '/.well-known/sgcaptcha',
  '/_sec/cp_challenge',
];

/** Body fragments read only on a 403 or 503 the headers did not explain. */
export const CHALLENGE_BODY_MARKERS: readonly string[] = [
  'just a moment...',
  '/cdn-cgi/challenge-platform/',
  'captcha-delivery.com',
  'px-captcha',
  'incapsula incident id',
  '/.well-known/sgcaptcha',
];

/** How much of the body the tiebreak reads. */
export const BODY_TIEBREAK_BYTES = 8192;

export function headerValue(headers: FetchOutcome['headers'], name: string): string {
  const v = headers[name];
  return (Array.isArray(v) ? v.join(', ') : (v ?? '')).toLowerCase();
}

const bodyHead = (f: FetchOutcome): string => f.body.slice(0, BODY_TIEBREAK_BYTES).toLowerCase();

/** How a response shows it is a challenge, checked in the order the evidence is trusted; null if none. */
export function challengeOf(f: FetchOutcome): ChallengeEvidence | null {
  if (MITIGATION_HEADERS.some(([h, v]) => headerValue(f.headers, h).includes(v))) {
    return 'mitigation_header';
  }
  const visited = [...f.hops.map((h) => h.location), f.finalUrl ?? ''].map((u) => u.toLowerCase());
  if (visited.some((u) => CHALLENGE_URL_MARKERS.some((m) => u.includes(m)))) {
    return 'challenge_redirect';
  }
  if (
    (f.status === 403 || f.status === 503) &&
    CHALLENGE_BODY_MARKERS.some((m) => bodyHead(f).includes(m))
  ) {
    return 'body_signature';
  }
  return null;
}

export function readResponse(f: FetchOutcome): ResponseReading {
  const reading = (cls: ResponseClass, challenge: ChallengeEvidence | null = null) => ({
    class: cls,
    challenge,
    cloudflare1020: f.status !== null && bodyHead(f).includes('error code: 1020'),
  });
  if (f.error !== null || f.status === null || f.finalUrl === null) return reading('error');

  const challenge = challengeOf(f);
  if (challenge) return reading('challenged', challenge);
  if (siteKeyOf(f.finalUrl) !== siteKeyOf(f.url)) return reading('redirected_away');

  const s = f.status;
  if (s >= 200 && s < 300) return reading('served');
  if (s === 402) return reading('payment');
  if (s === 429) return reading('rate_limited');
  if (s === 404 || s === 410) return reading('gone');
  if ((s >= 400 && s < 500) || s === 999) return reading('refused');
  return reading('error');
}
