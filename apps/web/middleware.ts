import { NextResponse, type NextRequest } from 'next/server';
import { CONSENT_REQUIRED_COOKIE, isConsentRequiredCountry } from '@/lib/consent';

export function middleware(req: NextRequest) {
  const res = NextResponse.next();

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

// Run on page routes (so the consent cookie is set before the client loads), excluding API,
// the PostHog reverse-proxy (/ingest), Next internals, and static files. The X-Robots rule above
// still applies only to /r/ and /embed/.
export const config = {
  matcher: ['/((?!api|ingest|_next/static|_next/image|favicon.ico).*)'],
};
