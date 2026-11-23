/**
 * The same-origin PostHog proxy behind `/ingest`. A Next rewrite forwarded the browser's request as
 * it came, `Cookie` and `Referer` included, and the SDK sends its requests with credentials, so this
 * names what may pass instead: the headers in `FORWARDED`, and in the answer those in `RETURNED`.
 * Sentry's trace headers are kept off these calls by `tracePropagationTargets`
 * (`sentryServerOptions`, lib/auth/sentry-scrub.ts).
 *
 * Check: `pnpm --filter @crawlmouse/web exec vitest run lib/analytics/ingest-proxy.test.ts`.
 */
const EVENTS_ORIGIN = 'https://us.i.posthog.com';
const ASSETS_ORIGIN = 'https://us-assets.i.posthog.com';
const PREFIX = '/ingest';

/** `x-forwarded-for` is the visitor's address, which PostHog reads a region from. */
const FORWARDED = [
  'accept',
  'content-encoding',
  'content-type',
  'if-none-match',
  'user-agent',
  'x-forwarded-for',
];
const RETURNED = ['cache-control', 'content-type', 'etag', 'last-modified'];
const UPSTREAM_TIMEOUT_MS = 10_000;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** The PostHog address for a request, or null for one that would not stay on PostHog's host. */
function targetOf(requestUrl: string): string | null {
  const { pathname, search } = new URL(requestUrl);
  if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)) return null;
  const path = pathname.slice(PREFIX.length) || '/';
  const origin = /^\/(?:static|array)\//.test(path) ? ASSETS_ORIGIN : EVENTS_ORIGIN;
  // Joined, never resolved: `new URL('//host/x', origin)` would leave the origin.
  const target = new URL(`${origin}${path}${search}`);
  return target.origin === origin ? target.toString() : null;
}

function picked(from: Headers, names: readonly string[]): Headers {
  const out = new Headers();
  for (const name of names) {
    const value = from.get(name);
    if (value !== null) out.set(name, value);
  }
  return out;
}

export async function proxyIngest(req: Request, send: Fetch = fetch): Promise<Response> {
  const target = targetOf(req.url);
  if (target === null) return new Response(null, { status: 404 });
  try {
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const upstream = await send(target, {
      method: req.method,
      headers: picked(req.headers, FORWARDED),
      ...(hasBody ? { body: await req.arrayBuffer() } : {}),
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: picked(upstream.headers, RETURNED),
    });
  } catch {
    console.error('ingest proxy: upstream call failed');
    return new Response(null, { status: 502 });
  }
}
