import { describe, it, expect, vi } from 'vitest';
import { NextRequest, NextResponse, type NextFetchEvent } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { config, handleEdge, middleware } from './middleware';
import { CONSENT_REQUIRED_COOKIE } from '@/lib/consent';
import { ROUTE_POLICIES, isStateChanging, type RoutePolicy } from '@/lib/security/route-policy';
import type { Refusal } from '@/lib/security/refusal-event';

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
    const event = { waitUntil: vi.fn() } as unknown as NextFetchEvent;
    const res = await middleware(new NextRequest(new Request('https://crawlmouse.com/')), event);
    expect(res).toBeDefined();
    expect(res.cookies.get(CONSENT_REQUIRED_COOKIE)).toBeDefined();
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
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0]![0]).toBeInstanceOf(Promise);
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
  it('guards exactly the twelve strict routes, named here', () => {
    expect(guarded.map((p) => p.route).sort()).toEqual([
      'api/audits/[id]/cancel',
      'api/audits/[id]/reaudit',
      'api/auth/logout',
      'api/billing/checkout',
      'api/billing/portal',
      'api/checks/[id]/claim',
      'api/reports/[slug]/claim',
      'api/reports/[slug]/logo',
      'api/reports/[slug]/visibility',
      'api/reports/[slug]/white-label',
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
