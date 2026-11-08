/**
 * Every route handler in the app: who may call it, and how the route establishes that.
 *
 * __tests__/security/route-policy.test.ts holds this list to the route files on disk (one row per
 * file, the exported methods) and to each route's source; __tests__/security/route-anonymous.test.ts
 * calls each signed-in route without a session. middleware.ts reads `sameOrigin` for the API rows.
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
  /** Refuse a state-changing request that does not come from our own pages (API routes). */
  readonly sameOrigin: boolean;
}

export const ROUTE_POLICIES: readonly RoutePolicy[] = [
  {
    route: 'api/admin/takedown/process',
    methods: ['POST'],
    class: 'service',
    verifier: 'timingSafeEqual',
    sameOrigin: false,
  },
  {
    route: 'api/audits/[id]/cancel',
    methods: ['POST'],
    class: 'public',
    reason:
      "the owner's session or the anonymous session cookie that started the audit (authorizeCancel)",
    session: 'optional',
    sameOrigin: true,
  },
  { route: 'api/audits/[id]/export', methods: ['GET'], class: 'user', sameOrigin: false },
  { route: 'api/audits/[id]/llms-txt', methods: ['GET'], class: 'user', sameOrigin: false },
  {
    route: 'api/audits/[id]/notify',
    methods: ['POST'],
    class: 'public',
    reason:
      'capability URL (the audit id); per-IP and per-email caps; writes only the notify address of a running audit',
    sameOrigin: false,
  },
  { route: 'api/audits/[id]/reaudit', methods: ['POST'], class: 'user', sameOrigin: true },
  {
    route: 'api/audits/[id]/stream',
    methods: ['GET'],
    class: 'public',
    reason: 'capability URL (the audit id): the progress stream of the audit it names',
    session: 'optional',
    sameOrigin: false,
  },
  {
    route: 'api/audits/start',
    methods: ['POST'],
    class: 'public',
    reason: 'anonymous audits by design; Turnstile and per-IP, per-domain and global limits',
    session: 'optional',
    sameOrigin: false,
  },
  {
    route: 'api/auth/logout',
    methods: ['POST'],
    class: 'public',
    reason: "clears the caller's own session cookies; there is nothing to authorise",
    sameOrigin: true,
  },
  {
    route: 'api/auth/magic-link',
    methods: ['POST'],
    class: 'public',
    reason: 'the sign-in request itself; Turnstile and per-IP and per-email limits',
    sameOrigin: false,
  },
  { route: 'api/billing/checkout', methods: ['POST'], class: 'user', sameOrigin: true },
  { route: 'api/billing/portal', methods: ['POST'], class: 'user', sameOrigin: true },
  { route: 'api/billing/status', methods: ['GET'], class: 'user', sameOrigin: false },
  { route: 'api/checks/[id]/claim', methods: ['POST'], class: 'user', sameOrigin: true },
  {
    route: 'api/developers',
    methods: ['POST'],
    class: 'public',
    reason: 'the developer waitlist form; Turnstile and a per-IP limit',
    sameOrigin: false,
  },
  {
    route: 'api/health',
    methods: ['GET'],
    class: 'public',
    reason: 'liveness probe; reads nothing',
    sameOrigin: false,
  },
  {
    route: 'api/reports/hide',
    methods: ['POST'],
    class: 'public',
    reason: 'capability (the audit id), symmetric with mint; a per-IP limit',
    sameOrigin: false,
  },
  {
    route: 'api/reports/mint',
    methods: ['POST'],
    class: 'public',
    reason: 'capability (a completed audit id); per-user and per-IP caps, Turnstile once exhausted',
    session: 'optional',
    sameOrigin: false,
  },
  { route: 'api/reports/[slug]/claim', methods: ['POST'], class: 'user', sameOrigin: true },
  { route: 'api/reports/[slug]/logo', methods: ['POST'], class: 'user', sameOrigin: true },
  { route: 'api/reports/[slug]/mine', methods: ['GET'], class: 'user', sameOrigin: false },
  { route: 'api/reports/[slug]/visibility', methods: ['POST'], class: 'user', sameOrigin: true },
  { route: 'api/reports/[slug]/white-label', methods: ['POST'], class: 'user', sameOrigin: true },
  {
    route: 'api/takedown',
    methods: ['POST'],
    class: 'public',
    reason: 'the public takedown form; Turnstile when sent, per-IP and per-domain limits',
    sameOrigin: false,
  },
  {
    route: 'api/trpc/[trpc]',
    methods: ['GET', 'POST'],
    class: 'public',
    reason:
      "every procedure reads through the caller's own client under RLS (listMine requires a session); the router has no mutation",
    sameOrigin: false,
  },
  { route: 'api/verify/check/[id]', methods: ['POST'], class: 'user', sameOrigin: true },
  { route: 'api/verify/start', methods: ['POST'], class: 'user', sameOrigin: true },
  {
    route: 'api/webhooks/inngest',
    methods: ['GET', 'POST', 'PUT'],
    class: 'webhook',
    verifier: 'serve',
    sameOrigin: false,
  },
  {
    route: 'api/webhooks/resend',
    methods: ['POST'],
    class: 'webhook',
    verifier: 'verify',
    sameOrigin: false,
  },
  {
    route: 'api/webhooks/stripe',
    methods: ['POST'],
    class: 'webhook',
    verifier: 'constructEvent',
    sameOrigin: false,
  },
  // Outside /api. The middleware's origin guard reads API rows only; /login/verify checks its own.
  { route: 'billing', methods: ['GET'], class: 'user', sameOrigin: false },
  {
    route: 'embed/[domain]',
    methods: ['GET'],
    class: 'public',
    reason: 'the embeddable grade badge; counts a view for a claimed report',
    sameOrigin: false,
  },
  {
    route: 'llms.txt',
    methods: ['GET'],
    class: 'public',
    reason: 'a static text file for crawlers',
    sameOrigin: false,
  },
  {
    route: 'login/verify',
    methods: ['GET', 'POST'],
    class: 'public',
    reason:
      'the sign-in landing: the link token is the credential; its POST checks its own origin (CC-25)',
    sameOrigin: false,
  },
  {
    route: 'robots.txt',
    methods: ['GET'],
    class: 'public',
    reason: 'a static text file for crawlers',
    sameOrigin: false,
  },
];

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** True for any method but GET, HEAD and OPTIONS: an unknown method is treated as a state change. */
export function isStateChanging(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

function patternFor(route: string): RegExp {
  const segments = route
    .split('/')
    .filter((s) => !/^\(.*\)$/.test(s)) // a route group adds no URL segment
    .map((s) => (/^\[[^\]]+\]$/.test(s) ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  return new RegExp(`^/${segments.join('/')}$`);
}

const COMPILED = ROUTE_POLICIES.map((policy) => ({ policy, pattern: patternFor(policy.route) }));

/**
 * A request path percent-decoded, with repeated slashes collapsed and a trailing slash dropped, so
 * the spellings that can reach one route handler find the same row. Undefined when it does not decode.
 */
export function normalizePath(pathname: string): string | undefined {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  path = path.replace(/\/{2,}/g, '/');
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/** The policy of the route a request path reaches, or undefined. */
export function policyForPath(pathname: string): RoutePolicy | undefined {
  const path = normalizePath(pathname);
  return path === undefined ? undefined : COMPILED.find((c) => c.pattern.test(path))?.policy;
}
