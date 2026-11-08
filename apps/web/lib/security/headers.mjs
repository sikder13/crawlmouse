/**
 * The security headers every response carries, applied by next.config.mjs `headers()`. Plain ESM
 * with JSDoc types because next.config.mjs imports it at build time and cannot import TypeScript.
 * __tests__/security/headers.test.ts pins each value on each route class.
 *
 * Two route classes: `/embed/*`, the grade badge other sites frame, and everything else. The CSP is
 * split: the directives no inline script depends on are enforced; the full policy is report-only
 * until its reports show it can be enforced (CC-SEC-2). Both report to Sentry when the build has a
 * DSN. HSTS is Vercel's, not set here.
 */

const TURNSTILE = 'https://challenges.cloudflare.com';
const POSTHOG_TOOLBAR = 'https://us.posthog.com';
const STRIPE_FORM_TARGETS = 'https://checkout.stripe.com https://billing.stripe.com';

/** Every response outside `/embed/*`. */
export const DEFAULT_SOURCE = '/((?!embed/).*)';
/** The embeddable badge. */
export const EMBED_SOURCE = '/embed/:path*';
/** The sign-in landing, which keeps its stricter referrer policy. */
export const SIGN_IN_SOURCE = '/login/verify';

/**
 * Sentry's CSP report endpoint and ingest origin for a DSN
 * (`https://<key>@<host>[/<path>]/<project>`), or null when the DSN is unset or does not parse.
 *
 * @param {string | undefined} dsn
 * @returns {{ origin: string, endpoint: string } | null}
 */
export function sentryCspTarget(dsn) {
  if (!dsn) return null;
  let url;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  const segments = url.pathname.split('/').filter(Boolean);
  const project = segments.pop();
  if (!url.username || !project || !/^\d+$/.test(project)) return null;
  const prefix = segments.length ? `/${segments.join('/')}` : '';
  return {
    origin: url.origin,
    endpoint: `${url.origin}${prefix}/api/${project}/security/?sentry_key=${url.username}`,
  };
}

/**
 * The origin of an absolute http(s) URL, or null (unset, relative such as `/ingest`, or unparsable).
 *
 * @param {string | undefined} url
 * @returns {string | null}
 */
function originOf(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} frameAncestors
 * @returns {string[]}
 */
function enforcedDirectives(frameAncestors) {
  return [
    `frame-ancestors ${frameAncestors}`,
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' ${STRIPE_FORM_TARGETS}`,
  ];
}

/** @param {{ origin: string, endpoint: string } | null} sentry */
const reporting = (sentry) => (sentry ? [`report-uri ${sentry.endpoint}`, 'report-to csp'] : []);

/**
 * @param {string} frameAncestors
 * @param {{ origin: string, endpoint: string } | null} sentry
 * @param {string[]} connect the origins the browser calls besides our own
 * @param {boolean} dev
 */
function reportOnlyPolicy(frameAncestors, sentry, connect, dev) {
  return [
    "default-src 'self'",
    // 'unsafe-eval' only under next dev, whose React Refresh needs it.
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''} ${TURNSTILE}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    ["connect-src 'self'", ...connect].join(' '),
    `frame-src ${TURNSTILE}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    // The enforced directives too, so enforcing this policy later is a change of header name.
    // upgrade-insecure-requests is not among them: browsers ignore it in a report-only policy.
    ...enforcedDirectives(frameAncestors),
    ...reporting(sentry),
  ].join('; ');
}

/**
 * @param {string} frameAncestors
 * @param {{ origin: string, endpoint: string } | null} sentry
 * @param {string[]} connect
 * @param {boolean} dev
 * @returns {{ key: string, value: string }[]}
 */
function headerSet(frameAncestors, sentry, connect, dev) {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    },
    {
      key: 'Content-Security-Policy',
      value: [
        ...enforcedDirectives(frameAncestors),
        'upgrade-insecure-requests',
        ...reporting(sentry),
      ].join('; '),
    },
    {
      key: 'Content-Security-Policy-Report-Only',
      value: reportOnlyPolicy(frameAncestors, sentry, connect, dev),
    },
    ...(sentry ? [{ key: 'Reporting-Endpoints', value: `csp="${sentry.endpoint}"` }] : []),
  ];
}

/**
 * The `headers()` entries for next.config. The browser calls Sentry's ingest, Supabase (the signed-in
 * header refreshes its session) and, when `NEXT_PUBLIC_POSTHOG_HOST` names one, a PostHog host other
 * than the same-origin `/ingest` proxy; PostHog's toolbar talks to `us.posthog.com`.
 *
 * @param {{ sentryDsn?: string, supabaseUrl?: string, posthogHost?: string, dev?: boolean }} options
 * @returns {{ source: string, headers: { key: string, value: string }[] }[]}
 */
export function securityHeaders({ sentryDsn, supabaseUrl, posthogHost, dev = false }) {
  const sentry = sentryCspTarget(sentryDsn);
  const connect = [
    ...new Set(
      [sentry?.origin, originOf(supabaseUrl), originOf(posthogHost), POSTHOG_TOOLBAR].filter(
        (o) => typeof o === 'string',
      ),
    ),
  ];
  return [
    {
      source: DEFAULT_SOURCE,
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        ...headerSet("'none'", sentry, connect, dev),
      ],
    },
    // The badge is framed by the sites that show it: no X-Frame-Options, any ancestor.
    { source: EMBED_SOURCE, headers: headerSet('*', sentry, connect, dev) },
    // A next.config header replaces the one a route sets, and a later entry replaces an earlier one:
    // the sign-in landing sends no referrer off our origin (its route sets the same value).
    { source: SIGN_IN_SOURCE, headers: [{ key: 'Referrer-Policy', value: 'same-origin' }] },
  ];
}
