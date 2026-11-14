import { unstable_getResponseFromNextConfig } from 'next/experimental/testing/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nextConfig from '../../next.config.mjs';
import { sentryCspTarget } from '../../lib/security/headers.mjs';

// Every header on every route class, read through Next's own matcher for next.config `headers()`.
// The expected values are written out here rather than imported, so a change to the module is a
// change to this file too.

const DSN = 'https://abc123@o42.ingest.us.sentry.io/4507';
const SENTRY_ORIGIN = 'https://o42.ingest.us.sentry.io';
const REPORT_URL = 'https://o42.ingest.us.sentry.io/api/4507/security/?sentry_key=abc123';

const SUPABASE = 'https://abcdefgh.supabase.co';
const STRIPE = 'https://checkout.stripe.com https://billing.stripe.com';
const enforced = (fa: string, withSentry: boolean) =>
  `frame-ancestors ${fa}; object-src 'none'; base-uri 'self'; form-action 'self' ${STRIPE}; upgrade-insecure-requests` +
  (withSentry ? `; report-uri ${REPORT_URL}; report-to csp` : '');
const reportOnly = (fa: string, withSentry: boolean) =>
  [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://us-assets.i.posthog.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    withSentry
      ? `connect-src 'self' ${SENTRY_ORIGIN} ${SUPABASE} https://us.posthog.com`
      : `connect-src 'self' ${SUPABASE} https://us.posthog.com`,
    'frame-src https://challenges.cloudflare.com',
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    `frame-ancestors ${fa}`,
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' ${STRIPE}`,
    ...(withSentry ? [`report-uri ${REPORT_URL}`, 'report-to csp'] : []),
  ].join('; ');

const COMMON = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

const CLASSES = [
  ['page', '/'],
  ['page', '/pricing'],
  ['page', '/r/some-report'],
  ['API', '/api/health'],
  ['API', '/api/billing/checkout'],
  ['PostHog proxy', '/ingest/static/array.js'],
  ['PostHog proxy', '/ingest/e/'],
  ['static', '/_next/static/chunks/main.js'],
  ['static', '/favicon.ico'],
  ['static', '/robots.txt'],
] as const;

async function headersFor(path: string): Promise<Record<string, string | null>> {
  const res = await unstable_getResponseFromNextConfig({
    url: `https://crawlmouse.com${path}`,
    nextConfig,
  });
  const read = (k: string) => res.headers.get(k);
  return Object.fromEntries(
    [
      'x-content-type-options',
      'referrer-policy',
      'permissions-policy',
      'x-frame-options',
      'content-security-policy',
      'content-security-policy-report-only',
      'reporting-endpoints',
    ].map((k) => [k, read(k)]),
  );
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', `${SUPABASE}/`);
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', '');
});
afterEach(() => vi.unstubAllEnvs());

describe.each([
  ['with a Sentry DSN', DSN],
  ['without a Sentry DSN', ''],
])('security headers %s', (_, dsn) => {
  const withSentry = dsn !== '';

  it.each(CLASSES)(
    '%s %s: every header, X-Frame-Options DENY, frame-ancestors none',
    async (_, path) => {
      vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', dsn);
      expect(await headersFor(path)).toEqual({
        ...COMMON,
        'x-frame-options': 'DENY',
        'content-security-policy': enforced("'none'", withSentry),
        'content-security-policy-report-only': reportOnly("'none'", withSentry),
        'reporting-endpoints': withSentry ? `csp="${REPORT_URL}"` : null,
      });
    },
  );

  it.each(['/embed/example.com', '/embed/sub.example.co.uk'])(
    'embed %s: no X-Frame-Options, any ancestor may frame it, the rest unchanged',
    async (path) => {
      vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', dsn);
      expect(await headersFor(path)).toEqual({
        ...COMMON,
        'x-frame-options': null,
        'content-security-policy': enforced('*', withSentry),
        'content-security-policy-report-only': reportOnly('*', withSentry),
        'reporting-endpoints': withSentry ? `csp="${REPORT_URL}"` : null,
      });
    },
  );
});

describe('the sign-in landing keeps its stricter referrer policy', () => {
  it('/login/verify: Referrer-Policy same-origin, every other header as on a page', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
    expect(await headersFor('/login/verify')).toEqual({
      ...COMMON,
      'referrer-policy': 'same-origin',
      'x-frame-options': 'DENY',
      'content-security-policy': enforced("'none'", false),
      'content-security-policy-report-only': reportOnly("'none'", false),
      'reporting-endpoints': null,
    });
  });

  it('only that path: /login and /login/verify/x keep the default', async () => {
    for (const path of ['/login', '/login/verify/x']) {
      expect((await headersFor(path))['referrer-policy'], path).toBe(
        'strict-origin-when-cross-origin',
      );
    }
  });
});

describe('share links and the pages they lead to send no referrer', () => {
  it.each([
    '/s/kJ8sT2mQ9x_p4VnR7bWc-A',
    '/s/view/6f1c2a8e-0000-4000-8000-000000000000',
    '/s/pause',
    '/s/decline',
    '/s',
  ])('%s: Referrer-Policy no-referrer, every other header as on a page', async (path) => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
    expect(await headersFor(path)).toEqual({
      ...COMMON,
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
      'content-security-policy': enforced("'none'", false),
      'content-security-policy-report-only': reportOnly("'none'", false),
      'reporting-endpoints': null,
    });
  });

  it('only under /s: a path that starts with those letters keeps the default', async () => {
    for (const path of ['/sites', '/seats', '/settings', '/reports/s/x']) {
      expect((await headersFor(path))['referrer-policy'], path).toBe(
        'strict-origin-when-cross-origin',
      );
    }
  });
});

describe('connect-src names the origins the browser calls', () => {
  const connectSrc = async () =>
    (await headersFor('/'))
      ['content-security-policy-report-only']!.split('; ')
      .find((d) => d.startsWith('connect-src'));

  it('a PostHog host other than the /ingest proxy is added; the relative proxy path is not', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://eu.i.posthog.com');
    expect(await connectSrc()).toBe(
      `connect-src 'self' ${SUPABASE} https://eu.i.posthog.com https://us.posthog.com`,
    );
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', '/ingest');
    expect(await connectSrc()).toBe(`connect-src 'self' ${SUPABASE} https://us.posthog.com`);
  });

  it('without a Supabase URL only our origin and the toolbar remain', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect(await connectSrc()).toBe("connect-src 'self' https://us.posthog.com");
  });
});

describe('only the badge is frameable: /embed/<domain>', () => {
  const framing = async (path: string) => {
    const h = await headersFor(path);
    return {
      xfo: h['x-frame-options'],
      ancestors: h['content-security-policy']!.split('; ').find((d) =>
        d.startsWith('frame-ancestors'),
      ),
    };
  };

  it.each(['/embed/example.com', '/embed/example.com/'])(
    '%s may be framed by any site',
    async (path) => {
      expect(await framing(path)).toEqual({ xfo: null, ancestors: 'frame-ancestors *' });
    },
  );

  it.each(['/embed', '/embed/', '/embed/a/b', '/embedded', '/x/embed/a'])(
    '%s may not be framed',
    async (path) => {
      expect(await framing(path)).toEqual({ xfo: 'DENY', ancestors: "frame-ancestors 'none'" });
    },
  );
});

// CC-37 F5: PostHog lazy-loads scripts such as surveys.js from its assets host (Sentry CRAWLMOUSE-M).
describe("PostHog's assets host in script-src", () => {
  const directive = (policy: string | null | undefined, name: string) =>
    (policy ?? '').split('; ').find((d) => d.split(' ')[0] === name) ?? null;

  it.each(['/', '/embed/example.com'])(
    'the report-only script-src on %s lists https://us-assets.i.posthog.com',
    async (path) => {
      const ro = (await headersFor(path))['content-security-policy-report-only'];
      expect(directive(ro, 'script-src')?.split(' ')).toContain('https://us-assets.i.posthog.com');
    },
  );

  it.each(['/', '/embed/example.com'])(
    'the enforced policy on %s lists no script sources (no script-src, script-src-elem or default-src)',
    async (path) => {
      const enforcedCsp = (await headersFor(path))['content-security-policy'];
      expect(enforcedCsp).not.toBeNull();
      for (const name of ['script-src', 'script-src-elem', 'script-src-attr', 'default-src']) {
        expect(directive(enforcedCsp, name)).toBeNull();
      }
      expect(enforcedCsp).not.toContain('posthog');
    },
  );
});

describe('next.config sends no X-Powered-By header', () => {
  it('poweredByHeader is off', () => {
    expect((nextConfig as { poweredByHeader?: boolean }).poweredByHeader).toBe(false);
  });
});

describe('next dev allows eval for React Refresh, and only next dev', () => {
  it("'unsafe-eval' is in the report-only script-src under development and absent otherwise", async () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect((await headersFor('/'))['content-security-policy-report-only']).toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://us-assets.i.posthog.com",
    );
    vi.stubEnv('NODE_ENV', 'production');
    expect((await headersFor('/'))['content-security-policy-report-only']).not.toContain(
      'unsafe-eval',
    );
  });
});

describe("Sentry's CSP endpoint is read from the DSN", () => {
  it.each([
    [DSN, { origin: SENTRY_ORIGIN, endpoint: REPORT_URL }],
    [
      'https://k@sentry.example.com/relay/12',
      {
        origin: 'https://sentry.example.com',
        endpoint: 'https://sentry.example.com/relay/api/12/security/?sentry_key=k',
      },
    ],
  ])('%s', (dsn, target) => {
    expect(sentryCspTarget(dsn)).toEqual(target);
  });

  it.each([
    undefined,
    '',
    'not a url',
    'https://o42.ingest.us.sentry.io/4507',
    'https://k@o42.ingest.us.sentry.io/',
  ])('no target for %s', (dsn) => {
    expect(sentryCspTarget(dsn)).toBeNull();
  });
});
