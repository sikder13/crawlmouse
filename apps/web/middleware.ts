import { type NextRequest, type NextResponse } from 'next/server';
import { CONSENT_REQUIRED_COOKIE, isConsentRequiredCountry } from '@/lib/consent';
import { updateSession } from '@/lib/supabase/middleware';

/**
 * Edge request handler. Order matters: refresh the Supabase session FIRST (middleware is a
 * write-allowed context, so a logged-in visitor's rotated tokens are persisted here — the
 * durable half of the CRAWLMOUSE-7/-8 /dashboard fix), THEN layer the consent cookie + the
 * X-Robots rule onto the SAME response. Those layers are purely additive, so they never
 * clobber the refreshed auth cookies. `refresh` is injected in tests.
 */
export async function handleEdge(
  req: NextRequest,
  refresh: (req: NextRequest) => Promise<NextResponse> = updateSession,
): Promise<NextResponse> {
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

export function middleware(req: NextRequest): Promise<NextResponse> {
  return handleEdge(req);
}

// Run on page routes (so the consent cookie is set before the client loads), excluding API,
// the PostHog reverse-proxy (/ingest), Next internals, and static files. The X-Robots rule above
// still applies only to /r/ and /embed/.
export const config = {
  matcher: ['/((?!api|ingest|_next/static|_next/image|favicon.ico).*)'],
};
