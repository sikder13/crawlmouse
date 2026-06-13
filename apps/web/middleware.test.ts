import { describe, it, expect } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { handleEdge, middleware } from './middleware';
import { CONSENT_REQUIRED_COOKIE } from '@/lib/consent';

const AUTH_COOKIE = 'sb-ezspnfeyzwsisymytssm-auth-token';

/** A fake session refresh returning a response that already carries a rotated auth cookie,
 *  so we can prove the consent/robots layer is purely additive and never clobbers it. */
function refreshWithAuthCookie(req: NextRequest) {
  const res = NextResponse.next({ request: req });
  res.cookies.set(AUTH_COOKIE, 'fresh-token', { path: '/' });
  return Promise.resolve(res);
}

describe('handleEdge', () => {
  it('sets the consent cookie without clobbering the refreshed auth cookie', async () => {
    const req = new NextRequest(new Request('https://crawlmouse.com/dashboard'));
    const res = await handleEdge(req, refreshWithAuthCookie);
    expect(res.cookies.get(AUTH_COOKIE)?.value).toBe('fresh-token');
    expect(res.cookies.get(CONSENT_REQUIRED_COOKIE)).toBeDefined();
  });

  it('adds X-Robots-Tag noindex on /r/ report pages', async () => {
    const req = new NextRequest(new Request('https://crawlmouse.com/r/abc'));
    const res = await handleEdge(req, refreshWithAuthCookie);
    expect(res.headers.get('X-Robots-Tag')).toContain('noindex');
  });

  it('does not add X-Robots-Tag on app pages', async () => {
    const req = new NextRequest(new Request('https://crawlmouse.com/dashboard'));
    const res = await handleEdge(req, refreshWithAuthCookie);
    expect(res.headers.get('X-Robots-Tag')).toBeNull();
  });

  it('sets the consent cookie for anonymous visitors (refresh returns a bare response, no auth cookie)', async () => {
    const req = new NextRequest(new Request('https://crawlmouse.com/'));
    const res = await handleEdge(req, (r) => Promise.resolve(NextResponse.next({ request: r })));
    expect(res.cookies.get(CONSENT_REQUIRED_COOKIE)).toBeDefined();
    expect(res.cookies.get(AUTH_COOKIE)).toBeUndefined();
  });
});

describe('middleware (exported entrypoint)', () => {
  it('wires handleEdge → updateSession end-to-end and returns a response with the consent cookie for an anonymous request', async () => {
    const res = await middleware(new NextRequest(new Request('https://crawlmouse.com/')));
    expect(res).toBeDefined();
    expect(res.cookies.get(CONSENT_REQUIRED_COOKIE)).toBeDefined();
  });
});
