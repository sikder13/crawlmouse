import { expect, test, type APIResponse } from '@playwright/test';
import { ROUTE_POLICIES, isStateChanging } from '../../../lib/security/route-policy';
import { BUILD_ENV, CSP_REPORT_URL, SENTRY_ORIGIN } from './build-env';

// The headers and the cross-site refusal as the built app serves them. The unit tests read the
// config and the middleware; this reads what `next start` sends, so a matcher that misses a path or
// a route header that wins over the config shows up here.

test.beforeAll(() => {
  for (const [key, value] of Object.entries(BUILD_ENV)) {
    expect(process.env[key], `${key}: this check expects the build's placeholder`).toBe(value);
  }
});

const STRIPE = 'https://checkout.stripe.com https://billing.stripe.com';
const enforced = (fa: string) =>
  `frame-ancestors ${fa}; object-src 'none'; base-uri 'self'; form-action 'self' ${STRIPE}; upgrade-insecure-requests`;
const reportOnly = (fa: string) =>
  [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    `connect-src 'self' ${SENTRY_ORIGIN} https://us.posthog.com`,
    'frame-src https://challenges.cloudflare.com',
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    `frame-ancestors ${fa}`,
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' ${STRIPE}`,
    `report-uri ${CSP_REPORT_URL}`,
    'report-to csp',
  ].join('; ');

function securityHeaders(res: APIResponse) {
  const h = res.headers();
  return {
    'x-content-type-options': h['x-content-type-options'],
    'referrer-policy': h['referrer-policy'],
    'permissions-policy': h['permissions-policy'],
    'x-frame-options': h['x-frame-options'],
    'content-security-policy': h['content-security-policy'],
    'content-security-policy-report-only': h['content-security-policy-report-only'],
    'reporting-endpoints': h['reporting-endpoints'],
  };
}

const page = (referrer = 'strict-origin-when-cross-origin') => ({
  'x-content-type-options': 'nosniff',
  'referrer-policy': referrer,
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'x-frame-options': 'DENY',
  'content-security-policy': enforced("'none'"),
  'content-security-policy-report-only': reportOnly("'none'"),
  'reporting-endpoints': `csp="${CSP_REPORT_URL}"`,
});

test.describe('every route class carries the security headers', () => {
  for (const path of [
    '/',
    '/pricing',
    '/login',
    '/api/health',
    '/robots.txt',
    '/25963aa57f7e77dc602baef07f6f89bb.txt',
  ]) {
    test(path, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(securityHeaders(res)).toEqual(page());
    });
  }

  test('a static chunk the home page loads', async ({ request }) => {
    const html = await (await request.get('/')).text();
    const chunk = html.match(/\/_next\/static\/[^"']+\.js/)?.[0];
    expect(chunk, 'a /_next/static script in the home page').toBeTruthy();
    expect(securityHeaders(await request.get(chunk!))).toEqual(page());
  });

  test('the embed badge: no X-Frame-Options, any ancestor', async ({ request }) => {
    const res = await request.get('/embed/example.com');
    expect(securityHeaders(res)).toEqual({
      ...page(),
      'x-frame-options': undefined,
      'content-security-policy': enforced('*'),
      'content-security-policy-report-only': reportOnly('*'),
    });
  });

  test('the sign-in landing keeps Referrer-Policy: same-origin', async ({ request }) => {
    const res = await request.get('/login/verify', { maxRedirects: 0 });
    expect(securityHeaders(res)).toEqual(page('same-origin'));
  });

  test("the middleware's own 403 carries them too", async ({ request, baseURL }) => {
    const res = await request.post('/api/billing/portal', {
      headers: { origin: 'https://evil.example' },
      data: {},
    });
    expect(res.status()).toBe(403);
    expect(securityHeaders(res)).toEqual(page());
    expect(baseURL).toBeTruthy();
  });
});

const ID = '6f1c2a8e-0000-4000-8000-000000000000';
const sample = (route: string) => `/${route.replace('[id]', ID).replace(/\[[^\]]+\]/g, 'sample')}`;
const guarded = ROUTE_POLICIES.filter((p) => p.origin === 'strict');

test.describe('the built app refuses a cross-site state change before the route runs', () => {
  test('guards the routes the registry marks (anti-vacuity)', () => {
    expect(guarded.length).toBeGreaterThanOrEqual(12);
  });

  for (const policy of guarded) {
    const method = policy.methods.find(isStateChanging)!;
    test(`${method} ${sample(policy.route)}`, async ({ request }) => {
      const res = await request.fetch(sample(policy.route), {
        method,
        headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
        data: '{}',
        maxRedirects: 0,
      });
      expect(res.status()).toBe(403);
      expect(await res.json()).toEqual({ error: 'Cross-site request refused', code: 'cross_site' });
    });
  }

  for (const path of [
    '/api/billing/portal/',
    '/api/billing/%70ortal',
    '/api//billing/portal',
    '/api/billing/portal.json',
  ]) {
    test(`another spelling never reaches the route: ${path}`, async ({ request }) => {
      const res = await request.post(path, {
        headers: { origin: 'https://evil.example' },
        data: {},
        maxRedirects: 0,
      });
      // Refused here, or not a route at all (Next redirects a doubled slash and 404s the rest).
      expect([403, 308, 404], `${path} → ${res.status()}`).toContain(res.status());
      expect(await res.text()).not.toContain('auth_required');
    });
  }

  test('an unknown method from another site is refused too', async ({ request }) => {
    const res = await request.fetch('/api/billing/portal', {
      method: 'PROPFIND',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.status()).toBe(403);
  });

  test('a text/plain POST to audits/start gets 415; the same JSON with no Origin reaches the route', async ({
    request,
  }) => {
    const body = JSON.stringify({ url: 'https://example.com' });
    const plain = await request.post('/api/audits/start', {
      headers: { 'content-type': 'text/plain' },
      data: body,
    });
    expect(plain.status()).toBe(415);
    const json = await request.post('/api/audits/start', {
      headers: { 'content-type': 'application/json' },
      data: body,
    });
    // CI has no database: the route answers from its fail-closed global bucket, or its URL check.
    expect([400, 503], `→ ${json.status()}`).toContain(json.status());
  });

  test('another site posting JSON to audits/start is refused', async ({ request }) => {
    const res = await request.post('/api/audits/start', {
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      data: '{}',
    });
    expect(res.status()).toBe(403);
  });

  test('our own page passes through to the route, which then wants a session', async ({
    request,
    baseURL,
  }) => {
    const res = await request.post('/api/billing/portal', {
      headers: { origin: baseURL! },
      data: {},
    });
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ error: 'auth_required' });
  });
});
