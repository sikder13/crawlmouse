/**
 * Every route handler in the app: who may call it, and how the route establishes that.
 *
 * __tests__/security/route-policy.test.ts holds this list to the route files on disk (one row per
 * file, the exported methods) and to each route's source; __tests__/security/route-anonymous.test.ts
 * calls each signed-in route without a session. middleware.ts reads `origin` and `jsonBody` for the API
 * rows.
 *
 * Edge-safe: no Node import, because the middleware runs on the Edge runtime.
 */

export type RouteClass = 'public' | 'user' | 'member' | 'service' | 'webhook';
export type Method = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

export interface RoutePolicy {
  /** The route's folder under app/, as written on disk: `api/audits/[id]/cancel`. */
  readonly route: string;
  readonly methods: readonly Method[];
  readonly class: RouteClass;
  /** Why a `public` route needs no session. Required for that class only. */
  readonly reason?: string;
  /** A `public` route that reads the session when there is one, and serves the caller without. */
  readonly session?: 'optional';
  /** For `service` and `webhook`: the call that authenticates the request. */
  readonly verifier?: string;
  /**
   * Who may send this API route a state change (middleware.ts): `strict`, only our own pages;
   * `lenient`, anyone but another site's page (a request with no Origin passes); `any`, no check.
   */
  readonly origin: 'strict' | 'lenient' | 'any';
  /** A state change must say its body is JSON, so another site cannot send one without a preflight. */
  readonly jsonBody?: true;
}

export const ROUTE_POLICIES: readonly RoutePolicy[] = [
  {
    route: 'api/account',
    methods: ['DELETE', 'PATCH', 'POST'],
    class: 'member',
    origin: 'strict',
  },
  { route: 'api/account/email', methods: ['POST'], class: 'member', origin: 'strict' },
  {
    route: 'api/account/email/confirm',
    methods: ['POST'],
    class: 'public',
    reason:
      "the confirmation link's token, read from its cookie, is the credential; the confirming browser need not be signed in (CC-27b D3)",
    session: 'optional',
    origin: 'strict',
  },
  {
    route: 'api/account/email/undo',
    methods: ['POST'],
    class: 'public',
    reason:
      "the undo link's token, read from its cookie, is the credential; the person may have no session left (CC-27b D3)",
    origin: 'strict',
  },
  {
    route: 'api/admin/takedown/process',
    methods: ['POST'],
    class: 'service',
    verifier: 'timingSafeEqual',
    origin: 'any',
  },
  { route: 'api/alert-rules', methods: ['POST', 'PUT'], class: 'member', origin: 'strict' },
  {
    route: 'api/audits/[id]/cancel',
    methods: ['POST'],
    class: 'public',
    reason:
      "the owner's session or the anonymous session cookie that started the audit (authorizeCancel)",
    session: 'optional',
    origin: 'strict',
  },
  { route: 'api/audits/[id]/export', methods: ['GET'], class: 'user', origin: 'any' },
  { route: 'api/audits/[id]/llms-txt', methods: ['GET'], class: 'user', origin: 'any' },
  {
    route: 'api/audits/[id]/notify',
    methods: ['POST'],
    class: 'public',
    reason:
      'capability URL (the audit id); per-IP and per-email caps; writes only the notify address of a running audit',
    origin: 'lenient',
    jsonBody: true,
  },
  { route: 'api/audits/[id]/reaudit', methods: ['POST'], class: 'user', origin: 'strict' },
  {
    route: 'api/audits/[id]/stream',
    methods: ['GET'],
    class: 'public',
    reason: 'capability URL (the audit id): the progress stream of the audit it names',
    session: 'optional',
    origin: 'any',
  },
  {
    route: 'api/audits/start',
    methods: ['POST'],
    class: 'public',
    reason: 'anonymous audits by design; Turnstile and per-IP, per-domain and global limits',
    session: 'optional',
    origin: 'lenient',
    jsonBody: true,
  },
  {
    route: 'api/auth/logout',
    methods: ['POST'],
    class: 'public',
    reason: "clears the caller's own session cookies; there is nothing to authorise",
    origin: 'strict',
  },
  {
    route: 'api/auth/magic-link',
    methods: ['POST'],
    class: 'public',
    reason: 'the sign-in request itself; Turnstile and per-IP and per-email limits',
    origin: 'lenient',
    jsonBody: true,
  },
  {
    route: 'api/billing/agency-trial',
    methods: ['POST'],
    class: 'member',
    origin: 'strict',
  },
  { route: 'api/billing/cancel', methods: ['POST'], class: 'member', origin: 'strict' },
  { route: 'api/billing/checkout', methods: ['POST'], class: 'member', origin: 'strict' },
  { route: 'api/billing/portal', methods: ['POST'], class: 'member', origin: 'strict' },
  {
    route: 'api/billing/pro-trial/start',
    methods: ['POST'],
    class: 'member',
    origin: 'strict',
  },
  { route: 'api/billing/status', methods: ['GET'], class: 'user', origin: 'any' },
  {
    route: 'api/checks/[id]/cancel',
    methods: ['POST'],
    class: 'public',
    reason: 'capability URL (the check id) or a member session: cancels the check it names',
    session: 'optional',
    origin: 'strict',
  },
  { route: 'api/checks/[id]/claim', methods: ['POST'], class: 'user', origin: 'strict' },
  { route: 'api/me', methods: ['PATCH', 'POST'], class: 'user', origin: 'strict' },
  { route: 'api/fixes/[id]/done', methods: ['POST'], class: 'member', origin: 'strict' },
  {
    route: 'api/fixes/[id]/email-developer',
    methods: ['POST'],
    class: 'member',
    origin: 'strict',
  },
  { route: 'api/fixes/[id]/packet', methods: ['GET'], class: 'member', origin: 'any' },
  {
    route: 'api/checks/[id]/notify',
    methods: ['POST'],
    class: 'public',
    reason:
      'capability URL (the check id): stores where to send the result; per-IP and per-address limits',
    session: 'optional',
    origin: 'lenient',
    jsonBody: true,
  },
  {
    route: 'api/checks/[id]/stream',
    methods: ['GET'],
    class: 'public',
    reason:
      'capability URL (the check id) or a member session: the progress stream of the check it names',
    session: 'optional',
    origin: 'any',
  },
  {
    route: 'api/checks',
    methods: ['POST'],
    class: 'public',
    reason: 'anonymous checks by design; Turnstile and per-IP, per-domain and global limits',
    session: 'optional',
    origin: 'lenient',
    jsonBody: true,
  },
  {
    route: 'api/developers',
    methods: ['POST'],
    class: 'public',
    reason: 'the developer waitlist form; Turnstile and a per-IP limit',
    origin: 'lenient',
    jsonBody: true,
  },
  {
    route: 'api/health',
    methods: ['GET'],
    class: 'public',
    reason: 'liveness probe; reads nothing',
    origin: 'any',
  },
  {
    route: 'api/reports/hide',
    methods: ['POST'],
    class: 'public',
    reason: 'capability (the audit id), symmetric with mint; a per-IP limit',
    origin: 'lenient',
    jsonBody: true,
  },
  {
    route: 'api/reports/mint',
    methods: ['POST'],
    class: 'public',
    reason: 'capability (a completed audit id); per-user and per-IP caps, Turnstile once exhausted',
    session: 'optional',
    origin: 'lenient',
    jsonBody: true,
  },
  { route: 'api/reports/[slug]/claim', methods: ['POST'], class: 'user', origin: 'strict' },
  { route: 'api/reports/[slug]/logo', methods: ['POST'], class: 'user', origin: 'strict' },
  { route: 'api/reports/[slug]/mine', methods: ['GET'], class: 'user', origin: 'any' },
  { route: 'api/reports/[slug]/visibility', methods: ['POST'], class: 'user', origin: 'strict' },
  { route: 'api/reports/[slug]/white-label', methods: ['POST'], class: 'user', origin: 'strict' },
  { route: 'api/sites', methods: ['POST'], class: 'member', origin: 'strict' },
  {
    route: 'api/sites/[id]',
    methods: ['DELETE', 'PATCH', 'POST'],
    class: 'member',
    origin: 'strict',
  },
  { route: 'api/sites/[id]/checks', methods: ['POST'], class: 'member', origin: 'strict' },
  {
    route: 'api/takedown',
    methods: ['POST'],
    class: 'public',
    reason: 'the public takedown form; Turnstile when sent, per-IP and per-domain limits',
    origin: 'lenient',
    jsonBody: true,
  },
  {
    route: 'api/trpc/[trpc]',
    methods: ['GET', 'POST'],
    class: 'public',
    reason:
      "every procedure reads through the caller's own client under RLS (listMine requires a session); the router has no mutation",
    origin: 'any',
  },
  { route: 'api/verify/check/[id]', methods: ['POST'], class: 'user', origin: 'strict' },
  { route: 'api/verify/start', methods: ['POST'], class: 'user', origin: 'strict' },
  {
    route: 'api/webhooks/inngest',
    methods: ['GET', 'POST', 'PUT'],
    class: 'webhook',
    verifier: 'serve',
    origin: 'any',
  },
  {
    route: 'api/webhooks/resend',
    methods: ['POST'],
    class: 'webhook',
    verifier: 'verify',
    origin: 'any',
  },
  {
    route: 'api/webhooks/stripe',
    methods: ['POST'],
    class: 'webhook',
    verifier: 'constructEvent',
    origin: 'any',
  },
  {
    route: 'api/webhooks/stripe-account',
    methods: ['POST'],
    class: 'webhook',
    verifier: 'constructEvent',
    origin: 'any',
  },
  // Outside /api. The middleware's origin guard reads API rows only; /login/verify checks its own.
  {
    route: '(account)/account/email/[token]',
    methods: ['GET'],
    class: 'public',
    reason: "the emailed link's token, moved into a cookie; it changes nothing (CC-27b D3)",
    origin: 'any',
  },
  {
    route: '(account)/account/email-undo/[token]',
    methods: ['GET'],
    class: 'public',
    reason: "the emailed link's token, moved into a cookie; it changes nothing (CC-27b D3)",
    origin: 'any',
  },
  { route: 'billing', methods: ['GET'], class: 'user', origin: 'any' },
  {
    route: 'embed/[domain]',
    methods: ['GET'],
    class: 'public',
    reason: 'the embeddable grade badge; counts a view for a claimed report',
    origin: 'any',
  },
  {
    route: 'llms.txt',
    methods: ['GET'],
    class: 'public',
    reason: 'a static text file for crawlers',
    origin: 'any',
  },
  {
    route: 'login/verify',
    methods: ['GET', 'POST'],
    class: 'public',
    reason:
      'the sign-in landing: the link token is the credential; its POST checks its own origin (CC-25)',
    session: 'optional',
    origin: 'any',
  },
  {
    route: 'robots.txt',
    methods: ['GET'],
    class: 'public',
    reason: 'a static text file for crawlers',
    origin: 'any',
  },
  // CC-27b workstream B: the deletion's links (D4). The token in the link, then in its cookie, is the
  // credential; the person may not be able to sign in (a confirmed deletion bans them).
  {
    route: '(account)/account/delete/[token]',
    methods: ['GET'],
    class: 'public',
    reason: 'an emailed link: moves its token into a cookie and redirects; changes nothing',
    origin: 'any',
  },
  {
    route: '(account)/account/restore/[token]',
    methods: ['GET'],
    class: 'public',
    reason: 'an emailed link: moves its token into a cookie and redirects; changes nothing',
    origin: 'any',
  },
  {
    route: 'api/account/delete/confirm',
    methods: ['POST'],
    class: 'public',
    reason: "the confirmation link's token, from its HttpOnly cookie, is the credential (D4)",
    origin: 'strict',
  },
  {
    route: 'api/account/restore',
    methods: ['POST'],
    class: 'public',
    reason: "the restore link's token, from its HttpOnly cookie, is the credential (D4)",
    origin: 'strict',
  },
  // CC-31 workstream A: seats and invitations (D3). A seat's own routes sit under `id/`, so no path
  // here matches two rows (`api/seats/accept` would also match a seat id directly under `seats`).
  { route: 'api/seats', methods: ['POST'], class: 'member', origin: 'strict' },
  {
    route: 'api/seats/id/[id]',
    methods: ['DELETE', 'PATCH', 'POST'],
    class: 'member',
    origin: 'strict',
  },
  { route: 'api/seats/id/[id]/resend', methods: ['POST'], class: 'member', origin: 'strict' },
  // The caller is signed in and holds no seat yet: the invitation's token, read from its cookie,
  // names the seat, and accept_seat_invite accepts it only for the user whose address was invited.
  { route: 'api/seats/accept', methods: ['POST'], class: 'user', origin: 'strict' },
  {
    route: 'invite/[token]',
    methods: ['GET'],
    class: 'public',
    reason: 'an emailed link: moves its token into a cookie and redirects; changes nothing',
    origin: 'any',
  },
];

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** True for any method but GET, HEAD and OPTIONS: an unknown method is treated as a state change. */
export function isStateChanging(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

/** A route's URL segments, as written on disk: a route group adds none. */
const routeSegments = (route: string) => route.split('/').filter((s) => !/^\(.*\)$/.test(s));

/**
 * Whether a route's segments match a request's. Catch-alls are always the last route segment. A static
 * segment matches in any case: Vercel's router serves a dynamic route at `/API/...` or `/api/REPORTS/...`
 * (measured on production, 2026-11-08), though `next start` does not.
 */
function matches(route: readonly string[], path: readonly string[]): boolean {
  const [head, ...rest] = route;
  if (head === undefined) return path.length === 0;
  if (/^\[\[\.\.\.[^\]]+\]\]$/.test(head)) return true;
  if (/^\[\.\.\.[^\]]+\]$/.test(head)) return path.length > 0;
  if (path.length === 0) return false;
  if (head.toLowerCase() !== path[0]!.toLowerCase() && !/^\[[^\]]+\]$/.test(head)) return false;
  return matches(rest, path.slice(1));
}

const COMPILED = ROUTE_POLICIES.map((policy) => ({
  policy,
  segments: routeSegments(policy.route),
}));

/**
 * A request path's segments: split on `/` with empty segments dropped (a repeated or trailing slash),
 * then each segment percent-decoded on its own, the way Next decodes a dynamic segment's value, so an
 * encoded slash stays inside its segment. A static segment is decoded too, which can only make more
 * spellings match a row. Undefined when a segment does not decode.
 */
export function pathSegments(pathname: string): string[] | undefined {
  const segments: string[] = [];
  for (const raw of pathname.split('/')) {
    if (raw === '') continue;
    try {
      segments.push(decodeURIComponent(raw));
    } catch {
      return undefined;
    }
  }
  return segments;
}

/**
 * Whether a path is under /api, in any case, decoded or not: a path that does not decode counts if it
 * starts so.
 */
export function isApiPath(pathname: string): boolean {
  const segments = pathSegments(pathname);
  return segments === undefined ? /^\/api\//i.test(pathname) : segments[0]?.toLowerCase() === 'api';
}

/**
 * Every row a request path matches. No two rows overlap (route-policy.test.ts holds each row's own path
 * to that row alone), so there is no precedence to decide between them.
 */
export function policiesForPath(pathname: string): RoutePolicy[] {
  const path = pathSegments(pathname);
  if (path === undefined) return [];
  return COMPILED.filter((c) => matches(c.segments, path)).map((c) => c.policy);
}

/** The policy of the route a request path reaches, or undefined (no such route, or it does not decode). */
export function policyForPath(pathname: string): RoutePolicy | undefined {
  return policiesForPath(pathname)[0];
}
