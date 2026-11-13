/**
 * The go-live check's one way out. `guardedFetch` sends a request only when `refusal` returns null,
 * and `refusal` returns null only for a request that matches one entry of `ROUTES`: that host, that
 * method, a path matching that pattern in full, and query parameter names (as `URLSearchParams`
 * decodes them) from that entry's list. Any other request is refused before the inner fetch is
 * called. Vercel's variable listing takes no parameter but `teamId`, so a `decrypt` parameter,
 * spelled or percent-encoded, is refused, and the single-variable path (`/v1/projects/<id>/env/<envId>`,
 * which answers a decrypted value) matches no route. http.test.ts sends each probe's real URL and
 * these refusals through `refusal`.
 *
 * A token is tied to its host (`TOKEN_HOST`): a request whose URL or a header carries a token is
 * refused unless it goes to that token's host, and an `authorization` header is refused unless it
 * carries the token of the host it goes to.
 *
 * Every string in a JSON response body is handed to `onValue` (the CLI registers them with its
 * redactor); a body that is not JSON is handed over whole.
 */
import { PRODUCTION_REF } from '../db/target';
import { VERCEL_PROJECT_ID } from './probes/vercel-env';
import { WORKER_APP } from './probes/worker';
import type { TOKEN_ENV } from './redact';

export interface Route {
  host: string;
  method: 'GET' | 'POST';
  path: RegExp;
  params: readonly string[];
}

/** The requests the probes send. */
export const ROUTES: readonly Route[] = [
  {
    host: 'api.vercel.com',
    method: 'GET',
    path: new RegExp(`^/v10/projects/${VERCEL_PROJECT_ID}/env$`),
    params: ['teamId'],
  },
  {
    host: 'api.vercel.com',
    method: 'GET',
    path: new RegExp(`^/v9/projects/${VERCEL_PROJECT_ID}$`),
    params: ['teamId'],
  },
  {
    host: 'api.supabase.com',
    method: 'POST',
    path: new RegExp(`^/v1/projects/${PRODUCTION_REF}/database/query/read-only$`),
    params: [],
  },
  { host: `${WORKER_APP}.fly.dev`, method: 'GET', path: /^\/healthz$/, params: [] },
  {
    host: 'api.machines.dev',
    method: 'GET',
    path: new RegExp(`^/v1/apps/${WORKER_APP}/machines$`),
    params: [],
  },
  {
    host: 'api.stripe.com',
    method: 'GET',
    path: /^\/v1\/prices$/,
    params: ['lookup_keys[]', 'limit'],
  },
  { host: 'api.resend.com', method: 'GET', path: /^\/domains$/, params: [] },
];

/** The hosts `ROUTES` names. */
export const ALLOWED_HOSTS: readonly string[] = [...new Set(ROUTES.map((r) => r.host))];

export type TokenName = (typeof TOKEN_ENV)[number];

/** The one host each token may be sent to. */
export const TOKEN_HOST: Readonly<Record<TokenName, string>> = {
  VERCEL_TOKEN: 'api.vercel.com',
  SUPABASE_ACCESS_TOKEN: 'api.supabase.com',
  FLY_READ_TOKEN: 'api.machines.dev',
  STRIPE_LIVE_READ_KEY: 'api.stripe.com',
  RESEND_API_KEY: 'api.resend.com',
};

export type Tokens = Readonly<Partial<Record<TokenName, string | undefined>>>;

const tokenEntries = Object.entries(TOKEN_HOST) as [TokenName, string][];

export class RefusedRequest extends Error {
  constructor(reason: string) {
    super(`refused: ${reason}`);
    this.name = 'RefusedRequest';
  }
}

/** Why the request is refused, or null when it is allowed. */
export function refusal(
  input: string,
  method: string,
  headers: Headers = new Headers(),
  tokens: Tokens = {},
): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return 'not an absolute URL';
  }
  if (url.protocol !== 'https:') return 'not https';
  if (url.username || url.password) return 'credentials in the URL';
  if (url.port !== '') return 'a non-default port';
  const m = method.toUpperCase();
  const route = ROUTES.find(
    (r) => r.host === url.hostname && r.method === m && r.path.test(url.pathname),
  );
  if (!route) return `${m} to that path on ${url.hostname} is not a request the check sends`;
  for (const name of url.searchParams.keys()) {
    if (!route.params.includes(name)) return `query parameter ${name} is not allowed there`;
  }
  for (const [name, host] of tokenEntries) {
    const token = tokens[name];
    if (!token || host === url.hostname) continue;
    if (url.href.includes(token)) return `${name} in a URL to ${url.hostname}`;
    for (const [, v] of headers) {
      if (v.includes(token)) return `${name} in a header to ${url.hostname}`;
    }
  }
  const auth = headers.get('authorization');
  if (auth !== null) {
    const own = tokenEntries.find(([, host]) => host === url.hostname);
    const token = own ? tokens[own[0]] : undefined;
    if (!token || !auth.includes(token))
      return `an authorization header to ${url.hostname} that does not carry its token`;
  }
  return null;
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

export function guardedFetch(
  inner: typeof fetch,
  onValue: (value: string) => void,
  tokens: Tokens = {},
): typeof fetch {
  return async (input, init) => {
    const url = urlOf(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    for (const [k, v] of new Headers(init?.headers)) headers.set(k, v);
    const why = refusal(url, method, headers, tokens);
    if (why) throw new RefusedRequest(why);
    const res = await inner(url, { ...init, method, headers, redirect: 'error' });
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
