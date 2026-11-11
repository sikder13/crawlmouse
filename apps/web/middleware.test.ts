import { afterEach, describe, it, expect, vi } from 'vitest';
import { NextRequest, NextResponse, type NextFetchEvent } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { config, handleEdge, middleware } from './middleware';
import { CONSENT_REQUIRED_COOKIE } from '@/lib/consent';
import { REWRITE_HEADER, V2_REWRITES } from '@/lib/v2/rewrites';
import { ROUTE_POLICIES, isStateChanging, type RoutePolicy } from '@/lib/security/route-policy';
import type { Refusal } from '@/lib/security/refusal-event';

const AUTH_COOKIE = 'sb-ezspnfeyzwsisymytssm-auth-token';

// The exported middleware's reporter: a spy, so the wiring test can see what reaches waitUntil.
const reported = vi.hoisted(() => ({ refusals: [] as unknown[], promise: Promise.resolve() }));
vi.mock('@/lib/security/refusal-event', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/security/refusal-event')>()),
  reportRefusal: (r: unknown) => {
    reported.refusals.push(r);
    return reported.promise;
  },
}));

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

  // A-7: each report page's robots meta decides whether it is indexed (app/r/[slug]/page.tsx), so the
  // middleware sends no header that would override a claimed, indexable report. A report whose slug
  // is "opengraph-image" is a page, not the image.
  it.each([
    '/r/abc',
    '/r/abc?ref=x',
    '/r/opengraph-image',
    '/r/abc/opengraph-imagex',
    '/r/a/b/opengraph-image',
  ])('sends no X-Robots-Tag on the report path %s', async (path) => {
    const req = new NextRequest(new Request(`https://crawlmouse.com${path}`));
    const res = await handleEdge(req, refreshWithAuthCookie);
    expect(res.headers.get('X-Robots-Tag')).toBeNull();
  });

  // Owner ruling: a report's share image stays out of image search. Social previews do not read the
  // header, and the image of an unclaimed report has no robots meta of its own.
  it.each([
    '/r/abc/opengraph-image',
    '/r/abc/opengraph-image?1a2b3c',
    '/r/opengraph-image/opengraph-image',
    // skipTrailingSlashRedirect (next.config.mjs) serves the image at the slash path too.
    '/r/abc/opengraph-image/',
  ])('keeps X-Robots-Tag noindex on the report image %s', async (path) => {
    const req = new NextRequest(new Request(`https://crawlmouse.com${path}`));
    const res = await handleEdge(req, refreshWithAuthCookie);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow, noarchive');
  });

  it('keeps X-Robots-Tag noindex on /embed/ badges', async () => {
    const req = new NextRequest(new Request('https://crawlmouse.com/embed/example.com'));
    const res = await handleEdge(req, refreshWithAuthCookie);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow, noarchive');
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

describe('the v2 rewrites (owner ruling Q17)', () => {
  const at = (path: string) => new NextRequest(new Request(`https://crawlmouse.com${path}`));
  const rewriteOf = (res: NextResponse) => res.headers.get('x-middleware-rewrite');

  /** A refresh that rotated the session: a cookie on the response, no-store headers beside it. */
  function rotated(req: NextRequest) {
    req.cookies.set(AUTH_COOKIE, 'fresh-token');
    const res = NextResponse.next({ request: req });
    res.cookies.set(AUTH_COOKIE, 'fresh-token', { path: '/' });
    res.headers.set('cache-control', 'private, no-cache, no-store, must-revalidate, max-age=0');
    return Promise.resolve(res);
  }

  afterEach(() => vi.unstubAllEnvs());

  it.each(['/dashboard', '/dashboard/'])(
    'with V2_CHECKS_PUBLIC=1, %s is served by /dashboard/v2',
    async (path) => {
      vi.stubEnv('V2_CHECKS_PUBLIC', '1');
      const res = await handleEdge(at(path), rotated);
      expect(rewriteOf(res)).toBe('https://crawlmouse.com/dashboard/v2');
    },
  );

  it('keeps the query string (v1 reads ?upgraded=1)', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const res = await handleEdge(at('/dashboard?upgraded=1'), rotated);
    expect(rewriteOf(res)).toBe('https://crawlmouse.com/dashboard/v2?upgraded=1');
  });

  it('the rewrite keeps the rotated session: its cookie, its no-store header and the updated request', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const res = await handleEdge(at('/dashboard'), rotated);
    expect(res.cookies.get(AUTH_COOKIE)?.value).toBe('fresh-token');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('x-middleware-request-cookie')).toContain('fresh-token');
    expect(res.cookies.get(CONSENT_REQUIRED_COOKIE)).toBeDefined();
  });

  it.each([
    ['the flag unset', '', '/dashboard'],
    ['the flag not 1', 'true', '/dashboard'],
    ['another page', '1', '/dashboards'],
    ['the pricing page', '1', '/pricing'],
  ])('no rewrite with %s', async (_name, flag, path) => {
    vi.stubEnv('V2_CHECKS_PUBLIC', flag);
    const res = await handleEdge(at(path), rotated);
    expect(rewriteOf(res)).toBeNull();
    expect(res.status).toBe(200);
    expect(res.cookies.get(AUTH_COOKIE)?.value).toBe('fresh-token');
  });

  it('marks its own rewrite, and removes a marker a client sent with any other request', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const spoofed = (path: string) =>
      new NextRequest(
        new Request(`https://crawlmouse.com${path}`, {
          headers: { [REWRITE_HEADER]: '1' },
        }),
      );
    const rewritten = await handleEdge(spoofed('/dashboard'), rotated);
    expect(rewritten.headers.get(`x-middleware-request-${REWRITE_HEADER}`)).toBe('1');
    for (const path of ['/pricing', '/sites/x']) {
      const passed = await handleEdge(spoofed(path), rotated);
      expect(passed.headers.get(`x-middleware-request-${REWRITE_HEADER}`)).toBeNull();
      expect(passed.headers.get('x-middleware-override-headers') ?? '').not.toContain(
        REWRITE_HEADER,
      );
    }
  });

  it.each([
    ['1', '/dashboard/v2.rsc'],
    ['1', '/dashboard/%76%32'],
    ['1', '/dashboard%2Fv2'],
    ['1', '/dashboard/v2'],
    ['1', '/dashboard/v2/'],
    ['1', '/dashboard/v2/anything'],
    ['', '/dashboard/v2'],
    ['', '/dashboard/v2?upgraded=1'],
  ])(
    'with V2_CHECKS_PUBLIC=%j, a direct request for %s is a 404 and is not refreshed',
    async (flag, path) => {
      vi.stubEnv('V2_CHECKS_PUBLIC', flag);
      const refresh = vi.fn(rotated);
      const res = await handleEdge(at(path), refresh);
      expect(res.status).toBe(404);
      expect(rewriteOf(res)).toBeNull();
      expect(refresh).not.toHaveBeenCalled();
    },
  );
});

describe('middleware (exported entrypoint)', () => {
  it('wires handleEdge → updateSession end-to-end and returns a response with the consent cookie for an anonymous request', async () => {
    const event = { waitUntil: vi.fn() } as unknown as NextFetchEvent;
    const res = await middleware(new NextRequest(new Request('https://crawlmouse.com/')), event);
    expect(res).toBeDefined();
    expect(res.cookies.get(CONSENT_REQUIRED_COOKIE)).toBeDefined();
  });

  it('through the real session refresh, a marker a client sent does not reach the page', async () => {
    const event = { waitUntil: vi.fn() } as unknown as NextFetchEvent;
    const spoofed = new NextRequest(
      new Request('https://crawlmouse.com/pricing', { headers: { [REWRITE_HEADER]: '1' } }),
    );
    const res = await middleware(spoofed, event);
    // The page sees the request as forwarded: the override list and the headers it names.
    // Without an override list Next forwards the client's own headers, marker included, so the list
    // must be there.
    const list = res.headers.get('x-middleware-override-headers');
    expect(list).not.toBeNull();
    const forwarded = list!.split(',');
    expect(forwarded).not.toContain(REWRITE_HEADER);
    expect(res.headers.get(`x-middleware-request-${REWRITE_HEADER}`)).toBeNull();
  });

  it('hands each refusal report to waitUntil, so it is sent after the response', async () => {
    const waitUntil = vi.fn();
    const res = await middleware(
      new NextRequest(
        new Request('https://crawlmouse.com/api/billing/portal', {
          method: 'POST',
          headers: { origin: 'https://evil.example' },
        }),
      ),
      { waitUntil } as unknown as NextFetchEvent,
    );
    expect(res.status).toBe(403);
    expect(reported.refusals).toEqual([
      {
        reason: 'cross_site',
        route: 'api/billing/portal',
        class: 'member',
        method: 'POST',
        status: 403,
      },
    ]);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0]![0]).toBe(reported.promise);
  });
});

// ─── Cross-site refusal on the API (D4) ─────────────────────────────────────────────────────────────

const SITE = 'https://crawlmouse.com';

/** A concrete path for a registry row: each [param] becomes a sample segment. */
const samplePath = (p: RoutePolicy) =>
  `/${p.route.replace(/\[[^\]]+\]/g, (m) => (m === '[id]' ? '6f1c2a8e-0000-4000-8000-000000000000' : 'sample'))}`;

function apiRequest(path: string, method: string, headers: Record<string, string>) {
  return new NextRequest(new Request(`${SITE}${path}`, { method, headers }));
}

async function run(path: string, method: string, headers: Record<string, string>) {
  const refresh = vi.fn((r: NextRequest) => Promise.resolve(NextResponse.next({ request: r })));
  const refusals: Refusal[] = [];
  const res = await handleEdge(apiRequest(path, method, headers), refresh, (r) => refusals.push(r));
  return { res, refresh, refusals };
}

const guarded = ROUTE_POLICIES.filter((p) => p.origin === 'strict');
const lenient = ROUTE_POLICIES.filter((p) => p.origin === 'lenient');
const passes = (res: NextResponse) => res.headers.get('x-middleware-next') === '1';

describe('a state-changing API request from another site is refused before the route runs', () => {
  it('guards exactly the twenty-two strict routes, named here', () => {
    expect(guarded.map((p) => p.route).sort()).toEqual([
      'api/audits/[id]/cancel',
      'api/audits/[id]/reaudit',
      'api/auth/logout',
      'api/billing/agency-trial',
      'api/billing/cancel',
      'api/billing/checkout',
      'api/billing/portal',
      'api/billing/pro-trial/start',
      'api/checks/[id]/cancel',
      'api/checks/[id]/claim',
      'api/fixes/[id]/done',
      'api/fixes/[id]/email-developer',
      'api/me',
      'api/reports/[slug]/claim',
      'api/reports/[slug]/logo',
      'api/reports/[slug]/visibility',
      'api/reports/[slug]/white-label',
      'api/sites',
      'api/sites/[id]',
      'api/sites/[id]/checks',
      'api/verify/check/[id]',
      'api/verify/start',
    ]);
  });

  it.each(
    guarded.flatMap((p) =>
      p.methods.filter(isStateChanging).map((m) => [samplePath(p), m, p] as const),
    ),
  )('%s %s: a foreign Origin gets 403, with one refusal event', async (path, method, policy) => {
    const { res, refresh, refusals } = await run(path, method, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Cross-site request refused', code: 'cross_site' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(passes(res)).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
    expect(refusals).toEqual([
      { reason: 'cross_site', route: policy.route, class: policy.class, method, status: 403 },
    ]);
  });

  it.each(guarded.map((p) => [samplePath(p), p.methods.find(isStateChanging)!] as const))(
    '%s %s: our own pages pass (Origin ours, or none with Sec-Fetch-Site: same-origin)',
    async (path, method) => {
      const ownPages: Record<string, string>[] = [
        { origin: SITE },
        { 'sec-fetch-site': 'same-origin' },
        { origin: 'null', 'sec-fetch-site': 'same-origin' },
      ];
      for (const headers of ownPages) {
        const { res, refusals } = await run(path, method, headers);
        expect(passes(res), JSON.stringify(headers)).toBe(true);
        expect(refusals).toEqual([]);
      }
    },
  );

  it.each([
    ['no Origin and no Sec-Fetch-Site', {}],
    ['no Origin and Sec-Fetch-Site: cross-site', { 'sec-fetch-site': 'cross-site' }],
    [
      'Origin null and Sec-Fetch-Site: same-site',
      { origin: 'null', 'sec-fetch-site': 'same-site' },
    ],
    ['a sibling subdomain', { origin: 'https://www.crawlmouse.com' }],
    ['our host over http', { origin: 'http://crawlmouse.com' }],
  ])('refuses %s', async (_, headers) => {
    const { res } = await run('/api/billing/portal', 'POST', headers);
    expect(res.status).toBe(403);
  });

  it.each([
    '/api/billing/portal/',
    '/api//billing/portal',
    '/api/billing/%70ortal',
    '/%61pi/billing/portal',
    '/api/reports/a%2Fb/claim',
    '/api/audits/6f1c2a8e%2Fx/cancel',
    // Vercel serves a dynamic route in any case.
    '/API/reports/s/logo',
    '/Api/audits/6f1c2a8e-0000-4000-8000-000000000000/cancel',
    '/api/REPORTS/s/VISIBILITY',
  ])('refuses a cross-site POST to another spelling of the route: %s', async (path) => {
    const { res } = await run(path, 'POST', { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });

  it.each(['/api/no/such/route', '/api/audits/%ZZ/cancel', '/%61pi/nothing'])(
    'a state change to %s, which reaches no registered route, gets 404 here',
    async (path) => {
      const { res, refusals } = await run(path, 'POST', {
        origin: SITE,
        'content-type': 'application/json',
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Not found', code: 'not_found' });
      expect(refusals).toEqual([
        { reason: 'no_route', route: '(none)', class: 'none', method: 'POST', status: 404 },
      ]);
    },
  );

  it('a read of an unregistered API path passes through, for the router to answer', async () => {
    const { res } = await run('/api/no/such/route', 'GET', {});
    expect(passes(res)).toBe(true);
  });

  it('a text/plain POST to an upper-case spelling of a JSON route gets 415', async () => {
    const { res } = await run('/API/audits/6f1c2a8e-0000-4000-8000-000000000000/notify', 'POST', {
      'content-type': 'text/plain',
    });
    expect(res.status).toBe(415);
  });

  it('an upper-case spelling of a signed webhook still passes untouched', async () => {
    const { res, refresh } = await run('/API/webhooks/stripe', 'POST', {
      origin: 'https://evil.example',
    });
    expect(passes(res)).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a method token outside HTTP is refused and reported as OTHER', async () => {
    const { res, refusals } = await run('/api/billing/portal', 'X'.repeat(40), {
      origin: 'https://evil.example',
    });
    expect(res.status).toBe(403);
    expect(refusals.map((r) => r.method)).toEqual(['OTHER']);
  });

  it('a cross-site GET to a guarded route passes: reads are not state changes', async () => {
    const { res } = await run('/api/billing/portal', 'GET', { origin: 'https://evil.example' });
    expect(passes(res)).toBe(true);
  });

  it.each(
    ROUTE_POLICIES.filter((p) => p.origin === 'any' && p.route.startsWith('api/')).map(
      (p) => [samplePath(p), p.methods.find(isStateChanging) ?? p.methods[0]!] as const,
    ),
  )(
    '%s %s: a route without the requirement passes a cross-site request, and the session is not refreshed',
    async (path, method) => {
      const { res, refresh, refusals } = await run(path, method, {
        origin: 'https://evil.example',
      });
      expect(passes(res)).toBe(true);
      expect(refresh).not.toHaveBeenCalled();
      expect(refusals).toEqual([]);
      expect(res.cookies.get(CONSENT_REQUIRED_COOKIE)).toBeUndefined();
    },
  );
});

describe('a public route that reads JSON refuses another site and a body not declared JSON', () => {
  const JSON_TYPE = { 'content-type': 'application/json' };

  it('covers the public JSON routes (anti-vacuity)', () => {
    expect(lenient.map((p) => p.route).sort()).toEqual([
      'api/audits/[id]/notify',
      'api/audits/start',
      'api/auth/magic-link',
      'api/checks',
      'api/checks/[id]/notify',
      'api/developers',
      'api/reports/hide',
      'api/reports/mint',
      'api/takedown',
    ]);
    expect(lenient.every((p) => p.jsonBody)).toBe(true);
  });

  it.each(lenient.map((p) => [samplePath(p)] as const))('%s', async (path) => {
    // Another site's page, by Origin or by Sec-Fetch-Site: 403, whatever the body says it is.
    for (const headers of [
      { origin: 'https://evil.example', ...JSON_TYPE },
      { origin: 'null', ...JSON_TYPE },
      { 'sec-fetch-site': 'cross-site', ...JSON_TYPE },
      { origin: 'https://evil.example', 'content-type': 'text/plain' },
    ] as Record<string, string>[]) {
      const { res, refusals } = await run(path, 'POST', headers);
      expect(res.status, JSON.stringify(headers)).toBe(403);
      expect(refusals.map((r) => r.reason)).toEqual(['cross_site']);
    }
    // Our page, or a script with no Origin, sending anything but JSON: 415.
    for (const headers of [
      { origin: SITE, 'content-type': 'text/plain;charset=UTF-8' },
      { 'content-type': 'application/x-www-form-urlencoded' },
      { 'content-type': 'multipart/form-data; boundary=x' },
      { 'content-type': 'application/json-patch+json' },
      {},
    ] as Record<string, string>[]) {
      const { res, refusals } = await run(path, 'POST', headers);
      expect(res.status, JSON.stringify(headers)).toBe(415);
      expect(await res.json()).toEqual({
        error: 'Send the request body as JSON',
        code: 'unsupported_media_type',
      });
      expect(refusals).toMatchObject([{ reason: 'not_json', status: 415 }]);
    }
    // JSON from our page, from a script with no Origin, or same-site: through to the route.
    for (const headers of [
      { origin: SITE, ...JSON_TYPE },
      { 'content-type': 'application/json; charset=utf-8' },
      { 'sec-fetch-site': 'same-origin', 'content-type': 'Application/JSON' },
    ] as Record<string, string>[]) {
      const { res, refusals } = await run(path, 'POST', headers);
      expect(passes(res), JSON.stringify(headers)).toBe(true);
      expect(refusals).toEqual([]);
    }
  });
});

describe('the matcher sends every guarded route through the middleware', () => {
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config, nextConfig: {}, url });

  it.each([...guarded, ...lenient].map((p) => samplePath(p)))('%s', (path) => {
    expect(matches(path)).toBe(true);
    expect(matches(`${path}/`)).toBe(true);
  });

  it('pages still match; the webhooks, /ingest and Next internals do not', () => {
    for (const url of ['/', '/dashboard', '/r/abc', '/embed/example.com'])
      expect(matches(url), url).toBe(true);
    for (const url of [
      '/api/webhooks/stripe',
      '/api/webhooks/inngest',
      '/ingest/e/',
      '/_next/static/chunks/a.js',
      '/favicon.ico',
    ]) {
      expect(matches(url), url).toBe(false);
    }
  });
});

describe('the / row of the v2 rewrite table (CC-22b, carried onto lib/v2/rewrites.ts)', () => {
  const HOME = V2_REWRITES.find((r) => r.from === '/')!;
  const at = (path: string) => new NextRequest(new Request(`https://crawlmouse.com${path}`));
  /** The path a response is rewritten to, with its query string; null for no rewrite. */
  const rewrittenTo = (res: NextResponse) => {
    const to = res.headers.get('x-middleware-rewrite');
    return to === null ? null : new URL(to).pathname + new URL(to).search;
  };
  /** A refresh that rotated the auth cookie and marked its response as not to be stored. */
  function refreshNoStore(req: NextRequest) {
    const res = NextResponse.next({ request: req });
    res.cookies.set(AUTH_COOKIE, 'fresh-token', { path: '/' });
    res.headers.set('cache-control', 'private, no-store');
    res.headers.set('expires', '0');
    res.headers.set('pragma', 'no-cache');
    return Promise.resolve(res);
  }
  const flag = (on: boolean) => vi.stubEnv('V2_CHECKS_PUBLIC', on ? '1' : '');
  afterEach(() => vi.unstubAllEnvs());

  it('has the home row, and each target is a path of its own', () => {
    expect(HOME.to).toBe('/v2-home');
    for (const row of V2_REWRITES) expect(row.to).toMatch(/^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/);
    expect(new Set(V2_REWRITES.map((r) => r.to)).size).toBe(V2_REWRITES.length);
  });

  it.each(['/', '/?ref=abc'])('with the flag off, %s is not rewritten', async (path) => {
    flag(false);
    const res = await handleEdge(at(path), refreshNoStore);
    expect(rewrittenTo(res)).toBeNull();
    expect(res.cookies.get(AUTH_COOKIE)?.value).toBe('fresh-token');
  });

  it.each(['0', 'true', ' 0 '])('a flag value of "%s" is off', async (value) => {
    vi.stubEnv('V2_CHECKS_PUBLIC', value);
    expect(rewrittenTo(await handleEdge(at('/'), refreshNoStore))).toBeNull();
  });

  it('with the flag on, / is rewritten to its target, with the query string', async () => {
    flag(true);
    expect(rewrittenTo(await handleEdge(at('/'), refreshNoStore))).toBe(HOME.to);
    expect(rewrittenTo(await handleEdge(at('/?ref=abc&x=1'), refreshNoStore))).toBe(
      `${HOME.to}?ref=abc&x=1`,
    );
  });

  it('the rewrite carries the refreshed cookies, its cache headers and the consent cookie', async () => {
    flag(true);
    const res = await handleEdge(at('/'), refreshNoStore);
    expect(res.cookies.get(AUTH_COOKIE)?.value).toBe('fresh-token');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('expires')).toBe('0');
    expect(res.headers.get('pragma')).toBe('no-cache');
    expect(res.cookies.get(CONSENT_REQUIRED_COOKIE)).toBeDefined();
  });

  it('the rewrite passes the request headers on to the page', async () => {
    flag(true);
    const req = new NextRequest(
      new Request('https://crawlmouse.com/', { headers: { 'x-from-test': 'kept' } }),
    );
    const res = await handleEdge(req, refreshNoStore);
    expect(res.headers.get('x-middleware-request-x-from-test')).toBe('kept');
  });

  it.each(['/pricing', '/blog', '/dashboards', '/audit/abc', '//', '/index'])(
    'with the flag on, %s is not rewritten: a row matches its own path only',
    async (path) => {
      flag(true);
      expect(rewrittenTo(await handleEdge(at(path), refreshNoStore))).toBeNull();
    },
  );

  describe.each([true, false])('with the flag on: %s', (on) => {
    it.each(['', '/', '?x=1', '/?x=1', '/anything', '/a/b'].map((rest) => `${HOME.to}${rest}`))(
      'a direct request for %s is answered as not found, never as the page',
      async (path) => {
        flag(on);
        const refresh = vi.fn(refreshNoStore);
        const res = await handleEdge(at(path), refresh);
        expect(res.status).toBe(404);
        expect(rewrittenTo(res)).toBeNull();
        expect(refresh).not.toHaveBeenCalled();
      },
    );

    it.each([`${HOME.to}-extra`, `${HOME.to}x/y`, `/x${HOME.to}`, '/v2', '/v2-hom'])(
      '%s, which only resembles the target, is left alone',
      async (path) => {
        flag(on);
        const res = await handleEdge(at(path), refreshNoStore);
        expect(rewrittenTo(res)).toBeNull();
        expect(res.status).toBe(200);
      },
    );
  });

  it('the matcher sends / and each target through the middleware', () => {
    const matches = (url: string) => unstable_doesMiddlewareMatch({ config, nextConfig: {}, url });
    for (const row of V2_REWRITES) {
      expect(matches(row.from), row.from).toBe(true);
      expect(matches(row.to), row.to).toBe(true);
      expect(matches(`${row.to}/`), row.to).toBe(true);
    }
  });
});
