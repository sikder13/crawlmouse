/**
 * The go-live check's one way out. `guardedFetch` refuses any request that is not a GET to one of
 * `ALLOWED_HOSTS`, apart from the Supabase Management API's read-only query (a POST, as
 * scripts/db/db.ts `readOnlyApi` sends it), and any URL that asks Vercel to decrypt a value. A refusal
 * throws before the inner fetch is called, so a refused request never leaves the machine.
 *
 * Every string in a JSON response body is handed to `onValue` (the CLI registers them with its
 * redactor), so a value a probe received cannot reach what the command prints.
 */

export const ALLOWED_HOSTS: readonly string[] = [
  'api.vercel.com',
  'api.supabase.com',
  'crawlmouse-worker.fly.dev',
  'api.machines.dev',
  'api.stripe.com',
  'api.resend.com',
];

/** The Management API's read-only query path, the one POST allowed. */
const SUPABASE_READ_ONLY = /^\/v1\/projects\/[a-z0-9]{20}\/database\/query\/read-only$/;

export class RefusedRequest extends Error {
  constructor(reason: string) {
    super(`refused: ${reason}`);
    this.name = 'RefusedRequest';
  }
}

/** Why the request is refused, or null when it is allowed. */
export function refusal(input: string, method: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return 'not an absolute URL';
  }
  if (url.protocol !== 'https:') return 'not https';
  if (url.username || url.password) return 'credentials in the URL';
  if (url.port !== '') return 'a non-default port';
  if (!ALLOWED_HOSTS.includes(url.hostname)) return `host ${url.hostname} is not allowed`;
  if (/decrypt/i.test(url.pathname + url.search)) return 'a decrypt request';
  const m = method.toUpperCase();
  if (m === 'GET') return null;
  if (
    m === 'POST' &&
    url.hostname === 'api.supabase.com' &&
    SUPABASE_READ_ONLY.test(url.pathname)
  ) {
    return null;
  }
  return `${m} is not allowed to ${url.hostname}`;
}

/** Every string leaf of a parsed JSON value, keys included. */
export function stringLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringLeaves(v, out);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      stringLeaves(v, out);
    }
  }
  return out;
}

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

export function guardedFetch(inner: typeof fetch, onValue: (value: string) => void): typeof fetch {
  return async (input, init) => {
    const url = urlOf(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const why = refusal(url, method);
    if (why) throw new RefusedRequest(why);
    const res = await inner(url, { ...init, method, redirect: 'error' });
    const text = await res.text();
    try {
      for (const v of stringLeaves(JSON.parse(text))) onValue(v);
    } catch {
      onValue(text);
    }
    const empty = res.status === 204 || res.status === 304;
    return new Response(empty ? null : text, { status: res.status });
  };
}
