/**
 * Vercel Deployment Protection. A protected preview answers a stranger with a redirect to Vercel's sign-in
 * (or a 401/403) instead of the app. The suite then needs the Protection Bypass for Automation secret,
 * VERCEL_AUTOMATION_BYPASS_SECRET, sent as `x-vercel-protection-bypass`.
 *
 * The secret is sent by `bypassCookies` and `global-setup.ts`, each on a request that does not follow
 * redirects.
 * Vercel answers with a cookie, and the browser and API contexts carry that cookie instead. A header
 * set on a context would go to every host a page loads, and on to the target of any redirect (measured:
 * `route.continue({ headers })` and `extraHTTPHeaders` both delivered it to a second origin after a 302).
 */
export const BYPASS_HEADER = 'x-vercel-protection-bypass';

export function bypassSecret(env: Readonly<Record<string, string | undefined>>): string | null {
  const s = env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  return s ? s : null;
}

/** The headers for requests to the deployment's own origin: the bypass, when there is a secret. */
export function originHeaders(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const s = bypassSecret(env);
  return s ? { [BYPASS_HEADER]: s } : {};
}

export const SET_COOKIE_HEADER = 'x-vercel-set-bypass-cookie';
export const BYPASS_COOKIE = '_vercel_jwt';

/**
 * null unless Playwright would record this run. A trace holds request headers and URLs, so a run with a
 * bypass cookie or a sign-in link must not keep one, and `--trace=on` overrides the config's `off`.
 */
let resolvedTrace: unknown;
/** `step()` records Playwright's resolved `trace` option here: `project.use` misses a spec's `test.use`. */
export const noteTrace = (mode: unknown): void => {
  resolvedTrace = mode;
};
/** Fails closed: outside a step nothing has recorded the mode, and `traceRefusal` refuses this value. */
export const currentTrace = (): unknown => resolvedTrace ?? 'not recorded';

export function traceRefusal(mode: unknown): string | null {
  const m = typeof mode === 'object' && mode !== null ? (mode as { mode?: unknown }).mode : mode;
  if (m === undefined || m === 'off') return null;
  return `tracing is ${String(m)}: a run holding a bypass cookie or a sign-in link keeps no trace`;
}

export interface BypassCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Lax';
}

type Fetch = (url: URL, init: RequestInit) => Promise<Response>;

/** A Set-Cookie line that clears its cookie: a zero or negative Max-Age, or an Expires in the past. */
function isExpired(line: string): boolean {
  const age = /;\s*max-age=\s*(-?\d+)/i.exec(line);
  if (age) return Number(age[1]) <= 0;
  const expires = /;\s*expires=([^;]+)/i.exec(line);
  return expires ? Date.parse(expires[1]!) <= Date.now() : false;
}
const cached = new Map<string, BypassCookie[]>();

/**
 * The cookies that let this origin's requests through, or [] when no secret is set. Throws when a secret
 * is set and the deployment gives no cookie. Each cookie is scoped to the origin's host.
 */
export async function bypassCookies(
  originUrl: string,
  env: Readonly<Record<string, string | undefined>>,
  doFetch: Fetch = fetch,
): Promise<BypassCookie[]> {
  const headers = originHeaders(env);
  if (Object.keys(headers).length === 0) return [];
  const origin = new URL(originUrl);
  const cacheKey = `${origin.origin}\n${headers[BYPASS_HEADER]}`;
  const known = cached.get(cacheKey);
  if (known) return known;
  const res = await doFetch(new URL('/api/health', origin), {
    headers: { ...headers, [SET_COOKIE_HEADER]: 'true' },
    redirect: 'manual',
  });
  const cookies = res.headers
    .getSetCookie()
    // Only Vercel's bypass cookie (measured: `_vercel_jwt`), and not one that clears it.
    .filter((line) => !isExpired(line))
    .map((line) => /^([^=;\s]+)=([^;]*)/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null && m[1] === BYPASS_COOKIE && m[2] !== '')
    .map((m) => ({
      name: m[1]!,
      value: m[2]!,
      domain: origin.hostname,
      path: '/',
      expires: -1,
      httpOnly: true,
      secure: origin.protocol === 'https:',
      sameSite: 'Lax' as const,
    }));
  if (cookies.length === 0) {
    throw new Error(`the deployment gave no bypass cookie (${res.status})`);
  }
  cached.set(cacheKey, cookies);
  return cookies;
}

/**
 * null when a probe of the deployment reached the app; otherwise why the run cannot go on. A 401 or 403
 * from Vercel's own edge is Deployment Protection: without a secret the run stops with that reason, and
 * with one it means the secret was refused.
 */
/** A Location on Vercel's own sign-in, under any spelling of the host. A relative one is the app's. */
function isVercelSignIn(location: string | undefined): boolean {
  if (!location || !/^https:\/\//i.test(location)) return false;
  try {
    const url = new URL(location);
    return (
      url.hostname.toLowerCase().replace(/\.+$/, '') === 'vercel.com' &&
      /^\/(sso|login)(\/|-|$)/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function protectionRefusal(
  status: number,
  headers: Readonly<Record<string, string>>,
  hasSecret: boolean,
): string | null {
  const vercel =
    /vercel/i.test(headers['server'] ?? '') ||
    Object.keys(headers).some((k) => k.startsWith('x-vercel'));
  // Vercel Authentication answers a stranger with a redirect to its sign-in (measured 2026-11-22: 302 to
  // https://vercel.com/sso-api?...), or with 401/403.
  const toSignIn = status >= 300 && status < 400 && isVercelSignIn(headers['location']);
  if (!vercel || !(status === 401 || status === 403 || toSignIn)) return null;
  return hasSecret
    ? `the deployment refused the bypass secret (${status}): VERCEL_AUTOMATION_BYPASS_SECRET is wrong for this project`
    : `the deployment is behind Vercel Deployment Protection (${status}): set VERCEL_AUTOMATION_BYPASS_SECRET`;
}
