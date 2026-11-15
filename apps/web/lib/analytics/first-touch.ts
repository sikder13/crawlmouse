/**
 * First-touch attribution (CC-41 D2): where a visitor first came from, held in the first-party
 * cookie `cm_ft` and written to `public.account_attribution` when their account is created
 * (lib/auth/first-login.ts).
 *
 * What it holds: utm_source, utm_medium, utm_campaign, utm_content and utm_term, the referrer's
 * hostname (never its path or query), the landing page's path as a shape (`landingShape`: never its
 * query or fragment, and a segment that could name something, such as a check's id or a site's host,
 * is written `~`), `ref`, and the first-seen time to the second, between 2020 and 2100. A field outside its bound is dropped, and the bounds
 * are the strings migration 20261120000001's CHECKs on `account_attribution` use
 * (first-touch.test.ts compares them with the migration's text and runs them in Postgres).
 *
 * When it is written: by `rememberFirstTouch`, only when there is no `cm_ft` cookie already and
 * capture is not opted out (instrumentation-client.ts after PostHog starts, and on the consent
 * banner's grant). It is never overwritten.
 *
 * When it is read on the server: at sign-in (app/login/verify), only when `serverCaptureAllowed` says
 * the visitor's consent allows a server capture (`consentedFirstTouch`).
 */
import { serverCaptureAllowed } from '../consent';

export const FIRST_TOUCH_COOKIE = 'cm_ft';

/** How long the cookie is kept: 90 days. */
export const FIRST_TOUCH_MAX_AGE_S = 90 * 24 * 60 * 60;

/** The regex each field must match, as Postgres reads it in the migration's CHECKs. */
export const FIRST_TOUCH_BOUNDS = {
  utm: '^[A-Za-z0-9 ._~+-]{1,100}$',
  referrer_host: '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$',
  landing_path: '^/[A-Za-z0-9/._~-]{0,199}$',
  ref: '^[A-Za-z0-9_-]{1,64}$',
} as const;

const MAX_HOST_LENGTH = 253;

export const UTM_FIELDS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const;

type UtmField = (typeof UTM_FIELDS)[number];

/** Every field of the record, in the order the table lists them. */
export const FIRST_TOUCH_FIELDS = [
  ...UTM_FIELDS,
  'referrer_host',
  'landing_path',
  'ref',
  'first_seen_at',
] as const;

/** How the privacy page names each field (app/privacy/page.tsx). */
export const FIRST_TOUCH_FIELD_LABELS: Record<(typeof FIRST_TOUCH_FIELDS)[number], string> = {
  utm_source: 'utm_source',
  utm_medium: 'utm_medium',
  utm_campaign: 'utm_campaign',
  utm_content: 'utm_content',
  utm_term: 'utm_term',
  referrer_host: 'the hostname of the site that sent you (not the address of its page)',
  landing_path:
    'the path of the page you landed on, with any part that names something (an id, an address) left out, and not its query',
  ref: 'a referral code (ref)',
  first_seen_at: 'the time of the visit',
};

export type FirstTouch = { [K in UtmField]?: string } & {
  referrer_host?: string;
  landing_path?: string;
  ref?: string;
  /** ISO 8601 in UTC, to the second: `2026-11-15T15:04:05Z`. */
  first_seen_at: string;
};

const UTM = new RegExp(FIRST_TOUCH_BOUNDS.utm);
const HOST = new RegExp(FIRST_TOUCH_BOUNDS.referrer_host);
const PATH = new RegExp(FIRST_TOUCH_BOUNDS.landing_path);
const REF = new RegExp(FIRST_TOUCH_BOUNDS.ref);
const SECOND = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
/** The first-seen times kept: a time outside them is no first visit, and Postgres refuses year 0. */
const EARLIEST = Date.parse('2020-01-01T00:00:00Z');
const LATEST = Date.parse('2100-01-01T00:00:00Z');

/** A path segment kept as written: a lowercase slug, like a blog post's or a page's name. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Eight or more digits in a row, or sixteen or more hex characters: an id, not a name. */
const ID_LIKE = /\d{8,}|^[0-9a-f]{16,}$/;
const MAX_SEGMENT = 64;

/**
 * The landing path as a shape: each segment that is a lowercase slug of at most MAX_SEGMENT
 * characters, and not a uuid or another id, is kept; every other segment is written `~`. So
 * `/blog/ai-crawler-access-test-2026` stays as it is, and `/audit/<check id>` reads `/audit/~` and
 * `/compare/acme.com/rival.co.uk` reads `/compare/~/~`: a check's id is the capability to read it,
 * and a host in a path is someone else's site.
 */
export function landingShape(pathname: string): string {
  const segments = pathname.split('/').slice(1);
  const shaped = segments.map((seg) =>
    seg === '' ||
    (seg.length <= MAX_SEGMENT && SLUG.test(seg) && !UUID_LIKE.test(seg) && !ID_LIKE.test(seg))
      ? seg
      : '~',
  );
  return `/${shaped.join('/')}`;
}

const FIELD_TESTS: Record<Exclude<keyof FirstTouch, 'first_seen_at'>, (v: string) => boolean> = {
  utm_source: (v) => UTM.test(v),
  utm_medium: (v) => UTM.test(v),
  utm_campaign: (v) => UTM.test(v),
  utm_content: (v) => UTM.test(v),
  utm_term: (v) => UTM.test(v),
  referrer_host: (v) => v.length <= MAX_HOST_LENGTH && HOST.test(v),
  landing_path: (v) => PATH.test(v) && landingShape(v) === v,
  ref: (v) => REF.test(v),
};

function parseUrl(s: string): URL | null {
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

const bare = (host: string) => host.replace(/^www\./, '');

function toSecond(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export interface Landing {
  /** The page's full address (`location.href`). */
  href: string;
  /** `document.referrer`; empty when there is none. */
  referrer: string;
  /** Our own hostname (`location.hostname`): a referrer on it, or its `www.`, is not a source. */
  ownHost: string;
}

/** The bounded record of this landing: every field that passes its bound, and the time. */
export function readFirstTouch(landing: Landing, now: Date): FirstTouch {
  const out: Record<string, string> = {};
  const page = parseUrl(landing.href);
  if (page !== null) {
    for (const field of UTM_FIELDS) out[field] = page.searchParams.get(field) ?? '';
    out.ref = page.searchParams.get('ref') ?? '';
    out.landing_path = landingShape(page.pathname);
  }
  const from = parseUrl(landing.referrer);
  if (
    from !== null &&
    (from.protocol === 'https:' || from.protocol === 'http:') &&
    bare(from.hostname.toLowerCase()) !== bare(landing.ownHost.toLowerCase())
  ) {
    out.referrer_host = from.hostname.toLowerCase();
  }
  return { ...kept(out), first_seen_at: toSecond(now) };
}

/** The fields of `raw` that pass their bounds, and nothing else. */
function kept(raw: Record<string, unknown>): Omit<FirstTouch, 'first_seen_at'> {
  const out: Record<string, string> = {};
  for (const [field, passes] of Object.entries(FIELD_TESTS)) {
    const v = raw[field];
    if (typeof v === 'string' && passes(v)) out[field] = v;
  }
  return out;
}

/** The `document.cookie` assignment that stores `record` for FIRST_TOUCH_MAX_AGE_S. */
export function firstTouchCookie(record: FirstTouch): string {
  const value = encodeURIComponent(JSON.stringify(record));
  return `${FIRST_TOUCH_COOKIE}=${value}; Max-Age=${FIRST_TOUCH_MAX_AGE_S}; Path=/; SameSite=Lax`;
}

/** The raw `cm_ft` value in a `document.cookie` string or `Cookie` header, or null. */
function rawFirstTouch(cookies: string): string | null {
  const name = `${FIRST_TOUCH_COOKIE}=`;
  const pair = cookies
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(name));
  return pair === undefined ? null : pair.slice(name.length);
}

/**
 * A `cm_ft` value read back, every field re-checked against its bound, or null when it is not one.
 * Takes the value encoded, as the browser stores it, or already decoded, as a server framework may
 * hand it over: a value that passes the bounds holds no `%`, so decoding it twice changes nothing.
 */
export function parseFirstTouch(raw: string): FirstTouch | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const seen = obj.first_seen_at;
  if (typeof seen !== 'string' || !SECOND.test(seen)) return null;
  const time = new Date(seen);
  if (Number.isNaN(time.getTime()) || toSecond(time) !== seen) return null;
  if (time.getTime() < EARLIEST || time.getTime() >= LATEST) return null;
  return { ...kept(obj), first_seen_at: seen };
}

/** The `cm_ft` record in a `document.cookie` string or `Cookie` header, or null. */
export function firstTouchFromCookies(cookies: string | null | undefined): FirstTouch | null {
  const raw = cookies ? rawFirstTouch(cookies) : null;
  return raw === null ? null : parseFirstTouch(raw);
}

/** The `cm_ft` record in a `Cookie` header, or null when there is none or consent stops its use. */
export function consentedFirstTouch(cookieHeader: string | null): FirstTouch | null {
  return serverCaptureAllowed(cookieHeader) ? firstTouchFromCookies(cookieHeader) : null;
}

export interface RememberDeps {
  document: { cookie: string };
  /** Whether PostHog capture is opted out for this visitor right now. */
  optedOut(): boolean;
  page: Landing;
  now(): Date;
}

/**
 * Writes the `cm_ft` cookie for this landing, unless capture is opted out or a `cm_ft` cookie is
 * already there (readable or not: it is never overwritten).
 */
export function rememberFirstTouch(deps: RememberDeps): void {
  if (deps.optedOut()) return;
  if (rawFirstTouch(deps.document.cookie) !== null) return;
  deps.document.cookie = firstTouchCookie(readFirstTouch(deps.page, deps.now()));
}
