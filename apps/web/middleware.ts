import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { CONSENT_REQUIRED_COOKIE, isConsentRequiredCountry } from '@/lib/consent';
import { reportRefusal, type Refusal } from '@/lib/security/refusal-event';
import { isStateChanging, normalizePath, policyForPath } from '@/lib/security/route-policy';
import { isCrossSite, isJsonBody, isSameOrigin } from '@/lib/security/same-origin';
import { updateSession } from '@/lib/supabase/middleware';

/**
 * API requests: a state change to a route the registry guards (lib/security/route-policy.ts) is
 * refused here, before the route runs, when its origin fails the route's rule (403) or, for a route
 * that reads JSON, when the body is not declared JSON (415). Every other API request passes through
 * untouched: no session refresh, no cookie.
 */
export function guardApi(req: NextRequest, report: (r: Refusal) => void): NextResponse {
  const policy = policyForPath(req.nextUrl.pathname);
  if (!policy || !isStateChanging(req.method)) return NextResponse.next();
  const refuse = (reason: Refusal['reason'], status: Refusal['status'], body: object) => {
    report({ reason, route: policy.route, class: policy.class, method: req.method, status });
    return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  };
  const origin = req.nextUrl.origin;
  if (
    (policy.origin === 'strict' && !isSameOrigin(req, origin)) ||
    (policy.origin === 'lenient' && isCrossSite(req, origin))
  ) {
    return refuse('cross_site', 403, { error: 'Cross-site request refused', code: 'cross_site' });
  }
  if (policy.jsonBody && !isJsonBody(req)) {
    return refuse('not_json', 415, {
      error: 'Send the request body as JSON',
      code: 'unsupported_media_type',
    });
  }
  return NextResponse.next();
}

/**
 * Edge request handler. API paths go to guardApi only. For pages, order matters: refresh the
 * Supabase session FIRST (middleware is a write-allowed context, so a logged-in visitor's rotated
 * tokens are persisted here — the durable half of the CRAWLMOUSE-7/-8 /dashboard fix), THEN layer the
 * consent cookie + the X-Robots rule onto the SAME response. Those layers are purely additive, so
 * they never clobber the refreshed auth cookies. `refresh` and `report` are injected in tests.
 */
export async function handleEdge(
  req: NextRequest,
  refresh: (req: NextRequest) => Promise<NextResponse> = updateSession,
  report: (r: Refusal) => void = (r) => void reportRefusal(r),
): Promise<NextResponse> {
  if (normalizePath(req.nextUrl.pathname)?.startsWith('/api/')) return guardApi(req, report);

  const res = await refresh(req);

  if (req.nextUrl.pathname.startsWith('/r/') || req.nextUrl.pathname.startsWith('/embed/')) {
    res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }

  // Geo-gate non-essential analytics: tell the client whether this visitor's region (EU/EEA/UK)
  // requires prior opt-in consent before PostHog loads. Vercel sets x-vercel-ip-country in prod;
  // absent locally/off-Vercel -> '0' (US-first default). Non-httpOnly so the client can read it.
  const country = req.headers.get('x-vercel-ip-country');
  res.cookies.set(CONSENT_REQUIRED_COOKIE, isConsentRequiredCountry(country) ? '1' : '0', {
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
    maxAge: 60 * 60 * 24,
  });

  return res;
}

export function middleware(req: NextRequest, event: NextFetchEvent): Promise<NextResponse> {
  return handleEdge(req, updateSession, (r) => event.waitUntil(reportRefusal(r)));
}

// Every path but the PostHog reverse proxy (/ingest), the signed webhooks, Next internals and the
// favicon: pages for the session refresh and the consent cookie, the other API routes for guardApi,
// which /ingest and the webhooks do not need. The X-Robots rule above still applies only to /r/ and
// /embed/.
export const config = {
  matcher: ['/((?!ingest|api/webhooks/|_next/static|_next/image|favicon.ico).*)'],
};
